/**
 * drAnalysis.ts — F15: Diminishing Returns Chain Tracking
 *
 * Tracks DR state per target per category so Claude can assess:
 *   - Why a CC had shorter than expected duration (incoming: hit at 50% DR)
 *   - Whether friendly CC chains were wasted by hitting DR (outgoing)
 *
 * DR mechanics (WoW 12.0+):
 *   - CC spells are grouped into DR categories that share diminishing returns
 *   - First application on target: Full duration
 *   - Second within the reset window of previous removal: 50%
 *   - Third within the window: Immune (0%) — 25% tier removed in 12.0
 *   - The reset timer starts from REMOVAL of the previous CC in the sequence
 *   - Reset window is era-dependent: 16s before 12.1, 20s from 12.1 on
 *     (official 12.1 notes: "Diminishing return categories will reset after
 *     20 seconds (was 16 seconds)."). Tier structure is unchanged in 12.1.
 */

import {
  CombatUnitType,
  IArenaMatch,
  ICombatUnit,
  IShuffleRound,
  LogEvent,
} from "@gladlog/parser-compat";

import { castsOfEffectAura, effectAurasOfCast } from "../data/castEffectAuras";
import { spellClassMap } from "../data/drCategories";
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import {
  AURA_REBROADCAST_GAP_MS,
  dropAuraRebroadcasts,
  officialDurationS,
  supersededAuraBreaks,
} from "./auraIntervals";
import { CAST_ROW_LAG_MAX_MS } from "./castRowLag";
import { ccFullDurationForCaster } from "./ccDuration";
import { specToString } from "./cooldowns";
import { logIsFrom } from "./logEra";
import { roundEndMs, stillOnAtRoundEnd } from "./roundEnd";
import { ccMechanicOf, STUNNED_MECHANIC } from "./spellMechanics";
import { summonOwnerById } from "./summonOwner";

// ── DR category constants ─────────────────────────────────────────────────────

/** DR reset window before 12.1. */
export const DR_RESET_MS_PRE_121 = 16_000;
/** DR reset window from 12.1 ("Curse of Ula'tek") on. */
export const DR_RESET_MS_121 = 20_000;
/**
 * 12.1 go-live: 2026-08-11 22:00 UTC (end of the US deploy maintenance).
 * A match cannot straddle the boundary (servers were down across it), so
 * gating on the match's wall-clock epoch is exact for US logs. Caveat: logs
 * from regions that deployed later (EU ~Aug 12) are misclassified as 20s for
 * up to a day — accepted tail; adjust here if corpus evidence contradicts.
 *
 * Single source for "is this match 12.1-era" (shared-predicate rule): the DR
 * reset cutover below and dispelAnalysis's Stellar Protection gate are both
 * aliases of this one moment — patch-mechanic gates must import it, never
 * re-derive their own epoch, and ask it through `logIsFrom` (logEra.ts: the
 * one comparison of a log timestamp with a dated game change).
 */
export const PATCH_121_GOLIVE_EPOCH_MS = Date.UTC(2026, 7, 11, 22, 0, 0);
/** Alias — the DR reset window flips exactly at 12.1 go-live. */
export const DR_RESET_CUTOVER_EPOCH_MS = PATCH_121_GOLIVE_EPOCH_MS;

/**
 * Single-source predicate for the DR reset window (era split — CLAUDE.md
 * shared-predicate rule). `epochMs` is any wall-clock timestamp inside the
 * match (log event timestamp or match start); pre-12.1 fixtures with small
 * synthetic epochs land in the 16s era by construction.
 */
export function drResetMsAt(epochMs: number): number {
  return logIsFrom(epochMs, DR_RESET_CUTOVER_EPOCH_MS)
    ? DR_RESET_MS_121
    : DR_RESET_MS_PRE_121;
}

// spellClassMap DR categories to import, mapped to display names.
// 'taunt' and 'root' are excluded — not relevant for PvP CC analysis.
const SCM_CATEGORY_LABELS: Record<string, string> = {
  stun: "Stun",
  knockback: "Knockback",
  incapacitate: "Incapacitate",
  disorient: "Disorient",
  silence: "Silence",
  disarm: "Disarm",
};

/**
 * Maps spell ID → DR category name.
 * Generated from spellClassMap.json (DB2 DiminishType data) plus a manual supplement
 * for spells absent from DB2: racials/pets not resolvable to player specs, silences
 * missing the DB2 flag, and DR categories that don't exist in DB2 (Cyclone, Horror).
 *
 * DB2 overrides are applied last to correct known Blizzard data errors:
 *   - Cyclone (33786): DB2 groups with Disorient; WoW gives it its own DR category
 *   - Incapacitating Roar (99): DB2 groups with Incapacitate; WoW treats as Disorient
 *
 * To update after a patch: re-run `generateSpellClassMap` (packages/tools), then verify
 * the supplement below is still accurate.
 */
export const DR_CATEGORY_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};

  const dr = spellClassMap.diminishingReturns as Record<
    string,
    { spellId: string }[]
  >;
  for (const [cat, entries] of Object.entries(dr)) {
    const label = SCM_CATEGORY_LABELS[cat];
    if (!label) continue;
    for (const entry of entries) {
      map[entry.spellId] = label;
    }
  }

  // 2026-08-21 S2 corpus scan (10,682 matches): removed Psychic Horror 64044, Mesmerize 115268, Intimidating Shout 316593/316595 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
  // Supplement: racials and pet abilities not resolvable to player specs in DB2
  map["20549"] = "Stun"; // War Stomp (Tauren racial)
  map["24394"] = "Stun"; // Intimidation (Hunter pet)
  // No entry for 107079 Quaking Palm: DB2 files it under Incapacitate
  // (mechanic 14) and the loop above has already read that. This block said
  // "Stun" until 2026-10-13 and overrode it (codex review 45-FT-102): the
  // only entry of the 1,271 in this map that contradicted
  // `DR_CATEGORIES_GENERATED`, and it let the two stun-only readers
  // (`wasLockedOutByStunOnly`, `stunLetsPress`) press a Pain Suppression
  // through an incapacitate. The log agrees with DB2 (`drShareScan.ts
  // --spells 107079`, 6,045 archive files): Quaking Palm after an
  // Incapacitate lands full 6 % (n=32, 20 half, 8 immune) against 58 % with
  // no predecessor and 61 % after a Stun (n=44); an Incapacitate after
  // Quaking Palm 0 % (n=21). test/drCategoryIds.test.ts refuses a hand entry
  // that contradicts DB2.

  // Supplement: AoE CC rank variants sharing DR with their base spell
  map["6358"] = "Disorient"; // Seduction (Warlock pet)

  // Supplement: silences missing DB2 DiminishType flag
  map["47476"] = "Silence"; // Strangulate (Death Knight)
  map["81261"] = "Silence"; // Solar Beam (Druid) — zone silence
  map["204490"] = "Silence"; // Sigil of Silence (Demon Hunter)

  // Supplement: DR categories absent from DB2 DiminishType system
  map["323467"] = "Horror"; // Sin and Punishment (Shadow Priest)
  map["376077"] = "Stun"; // Champion's Spear (Warrior/Evoker-adjacent)
  map["30283"] = "Stun"; // Shadowfury (Warlock) — missing DiminishType; shares Stun DR
  // Ursol's Vortex (102793, Druid) is a knockback/displacement with no tracked DR family
  // ('Root' is not a real DR category — see SCM_CATEGORY_LABELS). It falls back to self-DR.
  map["217832"] = "Incapacitate"; // Imprison (Demon Hunter)
  map["118381"] = "Incapacitate"; // Polymorph: Turtle
  map["161353"] = "Incapacitate"; // Polymorph: Polar Bear
  map["161354"] = "Incapacitate"; // Polymorph: Monkey
  map["161355"] = "Incapacitate"; // Polymorph: Penguin
  map["61305"] = "Incapacitate"; // Polymorph: Black Cat
  map["61721"] = "Incapacitate"; // Polymorph: Rabbit
  map["61780"] = "Incapacitate"; // Polymorph: Turkey
  map["12826"] = "Incapacitate"; // Polymorph: Polymorph
  map["28272"] = "Incapacitate"; // Polymorph: Pig
  map["28271"] = "Incapacitate"; // Polymorph: Turtle (Old)
  map["22570"] = "Stun"; // Maim (should be Stun per DB2, but often missing)

  // No override for 33786 Cyclone or 99 Incapacitating Roar: DB2 files them
  // under Disorient and Incapacitate, and the log agrees (reliability audit
  // C5, user ruling 2026-09-24 "follow DB2 after a corpus scan";
  // `packages/eval/scripts/drShareScan.ts`, 605 files). Cyclone after a
  // Disorient-category CC lands full 19 % (n=93, 31 half, 16 immune) against
  // 69 % with no predecessor and 71–76 % after Incapacitate / Stun; Roar after
  // Incapacitate 9 % full (n=35, 20 half) against 53 % after Disorient. The
  // removed overrides ("Cyclone has its own category", "Roar is Disorient")
  // produced false [DR: …] labels and [DR CLASH] lines blaming a teammate.

  // Sigil of Misery (DH) — Disorient DR. Missing from the generated map, so
  // the timeline rendered the raw-id fallback "[DR: spell:207685 …]"
  // (Gemini adversarial review, 2026-07-15).
  map["207685"] = "Disorient";

  return map;
})();

/**
 * Every spell id the product files under one DR category label ("Stun",
 * "Disorient", "Incapacitate", "Horror", …) — the inverse view of
 * `DR_CATEGORY_MAP`, override layer included. The single source for any
 * consumer that needs a per-category id SET rather than a per-id lookup:
 * eval's `uwcCorpusScan --category` used to read `DR_CATEGORIES_GENERATED`
 * directly and therefore disagreed with the product on 33786 Cyclone (own
 * category, not Disorient) and 99 Incapacitating Roar (Disorient, not
 * Incapacitate) — predicate-index "not yet unified" entry, closed 2026-08-27
 * (GH #33). Those two overrides were themselves wrong and are gone (C5,
 * 2026-09-25), so today the override layer only fills ids DB2 leaves blank.
 */
export function drCategoryIds(label: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [id, cat] of Object.entries(DR_CATEGORY_MAP))
    if (cat === label) out.add(id);
  return out;
}

/**
 * Spell IDs whose single cast can apply CC to multiple enemy targets simultaneously.
 * Used to group SPELL_AURA_APPLIED events from analyzeOutgoingCCChains into per-cast AoE events.
 */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Intimidating Shout rank variants 316593/316595 (old ids; base 5246 kept) — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const AOE_CC_SPELL_IDS = new Set<string>([
  "8122", // Psychic Scream (Priest)
  "5246", // Intimidating Shout (Warrior)
  "5484", // Howl of Terror (Warlock)
  "77505", // Earthquake's knockdown (Shaman) — this line said "Shockwave (Warrior)" until 2026-10-09; Shockwave casts 46968 and is NOT in this list
  "119381", // Leg Sweep (Monk)
  "20549", // War Stomp (Tauren racial)
  "99", // Incapacitating Roar (Druid Bear)
  "30283", // Shadowfury (Warlock) — small AoE on impact
  "255941", // Wake of Ashes' stun (Paladin) — this line said "Bursting Shot (Hunter)" until 2026-10-09; Bursting Shot is NOT in this list
  "207685", // Sigil of Misery (Demon Hunter) — AoE incapacitate
  // FT-T14c (2026-10-09, user approval): five more un-aimed area controls
  // whose control lands with the cast. They were in no list, so the owner's
  // cast line named no landing at all (and the owner's per-target
  // [CC ON ENEMY] rows are folded away): 1,432 bare `[YOU] [CC]` lines of
  // the 605-file capture — 14055cb2's four Dragon's Breaths read alike while
  // the log has one, two, one and one players hit. Aura ids, as the rest.
  "31661", // Dragon's Breath (Mage)
  "132168", // Shockwave's stun (Warrior; the cast is 46968)
  "179057", // Chaos Nova (Demon Hunter)
  "207167", // Blinding Sleet (Death Knight)
  "1234195", // Void Nova (Demon Hunter, Devourer)
  "118905", // Capacitor Totem's Static Charge (Shaman; the cast is 192058, the stun lands ~2 s later — AOE_CC_LANDING_WINDOW_S)
]);

/**
 * Area controls whose effect arrives seconds after the cast, by CAST id →
 * when the control lands, seconds after the cast (`null` = not known well
 * enough to pair a landing or to call an absence).
 *
 * Two readers: the cast-line fold of OUR casts (`findAndConsumeAoeCC`,
 * `ownerNoCcAuraTag` — reached only for a cast id in `ccSpellIds`, today
 * Capacitor Totem alone) and, since FT-T16 (user decision D14, 2026-10-10),
 * the pairing of an ENEMY cast with its landing on our player
 * (`ccLandedMatchWindowMs`): a control that landed inside its own window is
 * never printed as `[CC AVOIDED?] … did not land`.
 *
 *  - Capacitor Totem 192058 → its Static Charge stun 118905: 605 new-season
 *    files, 950 casts, 1,005 stuns on players — 1,003 of them 1.75–2.25 s
 *    after the cast, one at 2.5 s, one at 4.0 s; 232 casts stunned no player.
 *    The window is wide enough for all of them (FT board item, user ruling
 *    2026-10-09: 464 `[YOU] [CC]   Capacitor Totem` lines named no landing).
 *  - Sigil of Misery 207684 → 207685 (Game-Behaviour evidence, 2026-10-10).
 *    DB2: the cast's own duration is 2 s — the sigil arms, then triggers
 *    (`spellEffectGenerated.json`); Quickened Sigils 209281 takes 1 s off it
 *    (flat duration modifier −1000 ms whose class mask covers 207684,
 *    `talentEffectInventoryGenerated.json`). Corpus: 609 cast → aura pairs on
 *    1,814 files, median 2.07 s, 608 within 3 s (`castEffectAuraGenerated.json`);
 *    one raw log read line by line (74f541c0), five landings on players at
 *    2.011 / 2.021 / 2.047 / 2.093 / 2.113 s. The numbers agree with the DB2
 *    2 s; the window covers the talented 1 s as well.
 *    OPEN, not modelled: the PvP talent Lay In Wait 1235091 adds 88 s to that
 *    duration (DB2, mask covers 207684) — such a sigil waits up to 90 s for
 *    someone to walk in. The one pair of 609 later than 3 s may be it; no
 *    corpus split was made. A landing past the window is read as before this
 *    entry existed (an avoidance line stays), never worse.
 *  - Ring of Frost 113724 → 82691 (same date). DB2: the ring stays 10 s and
 *    freezes whoever enters it; no talent changes that duration. Corpus:
 *    1,214 pairs on 1,814 files, median 0.12 s, 1,000 within 3 s and 214
 *    later; four raw logs read (4f36fe3a, 8af36676, 1b7f19cc, 2b380381), 12
 *    freezes on players between 0.10 and 9.40 s after the cast — none past
 *    the ring's 10 s. The window is the ring's life plus 0.5 s of log slack.
 *  - Freezing Trap 187650 → 3355 and Binding Shot 109248 → 117526 (fact4
 *    D29 / D4 / D5 / D63, 2026-10-22: a trap timed at its placement printed
 *    "did not land; Bladestorm active" for the trap that caught the paladin
 *    8.2 s later). DB2: the trap is a missile (effect 32 → 187651) whose
 *    area trigger (effect 179) lasts 60 s (SpellDuration 3); Binding Shot's
 *    area trigger (effect 179, 1524) lasts 10 s (SpellDuration 1) and stuns
 *    a unit that leaves its tether. Corpus (605 new-season files, every 6th;
 *    the hunter's first 3355 / 117526 APPLIED or miss row on a player before
 *    his next cast, `runs/fact4-2026-10-22/fix/probes/trapDelay.py`): trap
 *    n 7,716, p50 0.51 s, p99 23.2 s, 7,711 within 60.5 s; Binding Shot n
 *    5,028, p50 0.98 s, p99 9.1 s, 5,011 within 10.5 s. The windows are the
 *    area's life plus 0.5 s of log slack.
 *  - Snowdrift 389794 (same date, fact4 D16): DB2 the press is a 6 s area
 *    (SpellDuration 6000, aura 395) whose pulses slow (389823) and then stun
 *    (389831) whoever stays in it; the pulse rows land 0–6 s after the press
 *    (605 files every 6th, `snowdriftRows.py`). Window: the area plus 0.5 s.
 */
/** Lay In Wait (PvP talent 1235091): +88 s on Sigil of Misery's arming
 * duration (DB2, the mask covers 207684) — see the OPEN note above. */
export const LAY_IN_WAIT_TALENT_ID = "1235091";
/**
 * The landing window of `castSpellId` for THIS caster: the table's, except
 * that a Sigil of Misery from a Lay In Wait holder may land up to 90 s later
 * — `null`, an absence that cannot be called (fact2 C10, 2026-10-20: the
 * cast id now reaches the owner's `[hit no enemy player]` test through
 * `isControlCast`, and a waiting sigil is no miss).
 */
export function aoeCcLandingWindowFor(
  castSpellId: string,
  casterPvpTalentIds: ReadonlySet<string>,
): { fromS: number; toS: number } | null | undefined {
  if (castSpellId === "207684" && casterPvpTalentIds.has(LAY_IN_WAIT_TALENT_ID))
    return null;
  return AOE_CC_LANDING_WINDOW_S[castSpellId];
}

export const AOE_CC_LANDING_WINDOW_S: Readonly<
  Record<string, { fromS: number; toS: number } | null>
> = {
  "192058": { fromS: 1.5, toS: 4.5 },
  "207684": { fromS: 0.5, toS: 3 },
  "113724": { fromS: 0, toS: 10.5 },
  "187650": { fromS: 0, toS: 60.5 },
  "109248": { fromS: 0, toS: 10.5 },
  "389794": { fromS: 0, toS: 6.5 },
};

/** What the owner's cast line says when one of these, cast un-aimed, reached
 * no enemy player: no aura, no damage and no miss row of it — its caster's
 * or its summons' — on one (FT-T14; written by `ownerNoCcAuraTag`; one that
 * reached a player and controlled nobody says `[no CC aura logged — hit …]`,
 * fact6 ruling 2). An absence the log states, not a verdict. */
export const OWNER_AOE_CC_NO_PLAYER_TAG = "[hit no enemy player]";

export interface IAoeCCEvent {
  casterName: string;
  spellId: string;
  spellName: string;
  atSeconds: number;
  /** Each enemy target affected, in order of first application */
  targets: Array<{ name: string; durationSeconds: number }>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type DRLevel = "Full" | "50%" | "25%" | "Immune";

/** The share of its full duration a CC lasts at a DR level: half at 50 %,
 * nothing when immune. One mapping for "how long was this CC going to last"
 * — the CC-break remaining time (`ccBreakAnalysis`) and the trinket break
 * binder's "time left" (`ccTrinketAnalysis`, enemy-def F-E15). The 25 % tier
 * left the game in 12.0 and is never assigned. */
export function drDurationFactor(level: DRLevel): number {
  return level === "50%" ? 0.5 : level === "Immune" ? 0 : 1;
}

export interface IDRInfo {
  /** DR category name (Stun / Incapacitate / Disorient / etc.) */
  category: string;
  /** DR level this application landed at */
  level: DRLevel;
  /** How many prior CCs in the same category were in this sequence */
  sequenceIndex: number;
}

/** The DR category label for stun-category CC — same string SCM_CATEGORY_LABELS.stun
 * emits into IDRInfo.category. Exported so consumers that need to ask "is this CC
 * instance a stun" import the literal instead of each hand-copying `"Stun"` (finding
 * #1, 2026-08-14 final review: USABLE_WHILE_CC_SPELL_IDS is a stunned-only table, so
 * gating a CC-locked-out wall against it requires exactly this check, done in two
 * structurally different places — deathOutcomeAnalysis.ts's windowed lockout scan and
 * candidateFindings.ts's instant-at-death check — that must not each redefine "Stun"). */
export const STUN_DR_CATEGORY = SCM_CATEGORY_LABELS.stun;

/** True iff this aura is a stun: its DR category is stun (`getDRCategory`,
 * the map a CC instance's `drInfo.category` is read from — `isStunCcInstance`
 * on an aura id), or — with no DR family at all — its official mechanic is
 * stunned (below, fact1215 C9: Infernal Awakening 22703). Despite the name it
 * answers "is this a stun", not "is this in the stun DR family": a DR-chain
 * reader wants `getDRCategory` itself. */
export function isStunDrAura(auraSpellId: string): boolean {
  return (
    getDRCategory(auraSpellId) === STUN_DR_CATEGORY ||
    // F15 / fact1215 C9 (2026-10-17): a stun with no DR family is a stun by
    // its official mechanic (Infernal Awakening 22703, mechanic 12 — the one
    // CC aura of the catalog with "stunned" and no stun DR)
    ccMechanicOf(auraSpellId) === STUNNED_MECHANIC
  );
}

/** True iff `cc` is a stun: its DR category, or its aura's official mechanic
 * (`isStunDrAura`'s rule, F15 C9). Conservative on missing/unknown data (no
 * `drInfo`, or a category outside the known set): treated as NOT stun, the same
 * false-accusation-averse direction the rest of this CC-gating logic uses. */
export function isStunCcInstance(cc: {
  drInfo?: { category: string } | null;
  spellId?: string;
}): boolean {
  return (
    cc.drInfo?.category === STUN_DR_CATEGORY ||
    (cc.spellId !== undefined && ccMechanicOf(cc.spellId) === STUNNED_MECHANIC)
  );
}

export interface CCEntry {
  applyMs: number;
  removeMs: number;
  spellId: string;
  /** the aura's source (Q1's identity test, `drLevelAtLanding`) */
  srcUnitId?: string;
  /** the opening row's place on the holder's aura stream
   * (`buildCcCategoryHistory`): of two landings on one ms, the one logged
   * later did not diminish the one logged first (codex 20-F20-28 #1) */
  applySeq?: number;
}

/**
 * fact6 F20 (D10 D29): is an aura on `holderId` from `srcUnitId` DR history
 * on the holder? Every source counts — an opponent, its pet or summon, a
 * teammate while the holder is charmed, and the holder ITSELF when the aura
 * is a control (`ccSpellIds`: its own control reflected back onto it — the
 * game DRs it like any other); only a holder-self aura that is not a control
 * does not (user default 2026-10-28). A reflected control is a DEBUFF: the
 * holder's own BUFF under a control's id is the caster's side of its own
 * channel, not a control on it (F20 residual: Illidan's Grasp 205630 is a
 * BUFF on the Demon Hunter channelling it — 321d51ac 1:48 rendered
 * `[CC ON TEAM] … ← Illidan's Grasp (reflected back)` and put the next
 * Chastise at Stun Immune for Full). The one source test of every DR
 * history: `buildCcCategoryHistory`, the outgoing chains' DR-only entries,
 * the CC summaries' history-only entries and their reflected windows.
 */
export function isDrHistorySource(
  holderId: string,
  srcUnitId: string,
  spellId: string,
  auraType: string | undefined,
): boolean {
  return (
    srcUnitId !== holderId || (ccSpellIds.has(spellId) && auraType === "DEBUFF")
  );
}

/**
 * Finds the pending key a removal event pairs with (single-source predicate,
 * fixed 2026-08-02): for BROKEN / BROKEN_SPELL the srcUnitId is the
 * **breaker**, not the caster, so the exact `${spellId}:${src}` key always
 * mismatches for a broken CC (17.5% of hard-CC windows) -> the pending entry
 * hangs until match end, the duration is inflated, and the DR chain is
 * polluted. Semantics: prefer the exact key, otherwise the earliest applyMs
 * among entries with the same spellId.
 * Consumers: analyzeOutgoingCCChains / ccTrinketAnalysis / ccBreakAnalysis.
 */
export function matchPendingCcKey(
  pending: ReadonlyMap<string, { applyMs: number }>,
  spellId: string,
  exactKey: string,
): string | undefined {
  if (pending.has(exactKey)) return exactKey;
  let best: string | undefined;
  let bestApply = Infinity;
  for (const [k, v] of pending) {
    if (k.startsWith(`${spellId}:`) && v.applyMs < bestApply) {
      bestApply = v.applyMs;
      best = k;
    }
  }
  return best;
}

/** cc-dr F-RF1 (ruling A51 = A): a CC re-applied on a holder is a new CC
 * when its source cast it in this window before the re-application (the
 * probe's 3 s, `probes/cc-dr/p14_sim_refresh.ts`). */
export const CAST_BACKED_REFRESH_MS = 3_000;
/** cc-dr F-RF1 (codex 35-CD-14): the cast that OPENED a CC window can be
 * logged a moment after its own APPLIED (Bull Rush: APPLIED 10.000, cast
 * 10.001); a cast this close after the opening is that cast, not a recast — no
 * CC can be recast inside a quarter second. */
export const OPENING_CAST_SKEW_MS = 250;

/**
 * Did one of `casters` (the aura's source, and its owner for a pet) CAST this
 * CC — its aura id or a cast whose effect aura it is (`castsOfEffectAura`) —
 * at `targetId` or untargeted, after the open application began
 * (`OPENING_CAST_SKEW_MS`) and at most `CAST_BACKED_REFRESH_MS` before `atMs`
 * — or up to `CAST_ROW_LAG_MAX_MS` after it: the press's row can be logged
 * after the aura it caused (F20 dr residual: a stealth Rake's stun REFRESH
 * 19.0498, its cast row 19.0508).
 * The one reading of "this re-application is a recast" for the CC pairings
 * (`analyzePlayerCCAndTrinket`, `analyzeOutgoingCCChains`, `analyzeCcBreaks`).
 */
export function ccRecastBetween(
  casters: ReadonlyArray<Pick<ICombatUnit, "spellCastEvents"> | undefined>,
  auraSpellId: string,
  targetId: string,
  openedAtMs: number,
  atMs: number,
): boolean {
  const castIds = new Set([auraSpellId, ...castsOfEffectAura(auraSpellId)]);
  return casters.some((u) =>
    (u?.spellCastEvents ?? []).some(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        castIds.has(e.spellId) &&
        (!e.destUnitId ||
          /^0+$/.test(e.destUnitId) ||
          e.destUnitId === targetId) &&
        e.timestamp > openedAtMs + OPENING_CAST_SKEW_MS &&
        e.timestamp <= atMs + CAST_ROW_LAG_MAX_MS &&
        e.timestamp >= atMs - CAST_BACKED_REFRESH_MS,
    ),
  );
}

/**
 * F20 dr (coordinator 2026-10-28, measured): a REFRESH of a control from the
 * source whose application is open is a NEW DR application — recast or not.
 * The game re-times the aura at the next DR tier. 605 corpus, every control
 * REFRESH on a player with no recast (`ccRecastBetween`) whose aura then
 * ended with no break, dispel or holder press logged: 29 of 32 ended at
 * REFRESH + the next tier's length ± 150 ms (Δ = REFRESH − APPLIED ≤ 50 ms:
 * 4 / 4 — Bull Rush 1.5 s → 0.75 s three times, c5ae2200 r3's double-apply
 * of its kind; > 50 ms: 25 / 28 — Bull Rush, Sap, Song of Chi-Ji, Rake,
 * Terror of the Skies; the other 3 a Sap / Song gone early with no BROKEN
 * row), 0 at the original APPLIED + its length; the next same-family
 * control within 20 s was IMMUNE 7 / 7. The
 * one reading for the shared history walk (`buildCcCategoryHistory`), the
 * outgoing chains (`analyzeOutgoingCCChains`) and the re-send split's
 * opening (`ccRecastSplitsResend`). Supersedes F06c's and c7304a60a's "a
 * bare REFRESH is the same application" for DR; the CC windows keep one
 * line across it (`refreshedAtSeconds`, the DR shown is the first landing's).
 */
export function ccRefreshIsNewApplication(spellId: string): boolean {
  return ccSpellIds.has(spellId) || DR_CATEGORY_MAP[spellId] !== undefined;
}

/**
 * fact1215 112-1 (2026-10-19): a REMOVED → APPLIED pair of a control inside
 * the re-send gap (`AURA_REBROADCAST_GAP_MS`) is a NEW application when its
 * source recast the spell for it (`ccRecastBetween`, the cast-backed REFRESH
 * rule of ruling A51) — not a re-send. 112-1 0:54: Cheap Shot 07.118 →
 * 11.131 ran its 4 s, the recast landed 11.132 and the Medallion took it at
 * 12.015; merged, the 0.9 s recast read as having run its course. The
 * `isNewApplication` every control reader of `dropAuraRebroadcasts` passes:
 * the CC windows, the DR histories, the break analysis.
 */
export function ccRecastSplitsResend<
  T extends {
    spellId?: string | null;
    srcUnitId?: string;
    timestamp: number;
    logLine: { event: string };
  },
>(
  holderId: string,
  holderAuras: readonly T[],
  casterOf: (
    id: string,
  ) => Pick<ICombatUnit, "spellCastEvents" | "ownerId"> | undefined,
): (removed: T, applied: T) => boolean {
  return (removed, applied) => {
    const sid = applied.spellId;
    if (!sid || !ccSpellIds.has(sid) || !applied.srcUnitId) return false;
    const src = casterOf(applied.srcUnitId);
    if (!src) return false;
    const owner = src.ownerId ? casterOf(src.ownerId) : undefined;
    const recast = (fromMs: number, atMs: number) =>
      ccRecastBetween([src, owner], sid, holderId, fromMs, atMs);
    // the opening of the application `removed` closes: its APPLIED, moved
    // only by a new application — an APPLIED after a real end, a re-send
    // its source recast for, or any REFRESH (`ccRefreshIsNewApplication`).
    // A re-send with no recast is the same application (codex 20-F15-35: a
    // re-send at 11.000 moved the opening past the 11.120 recast's skew
    // guard)
    let openedAtMs = -Infinity;
    let lastRemovedMs: number | undefined;
    for (const x of holderAuras) {
      if (x === removed) break;
      if (x.spellId !== sid || x.srcUnitId !== applied.srcUnitId) continue;
      const ev = x.logLine.event;
      if (ev === LogEvent.SPELL_AURA_REMOVED) lastRemovedMs = x.timestamp;
      else if (ev === LogEvent.SPELL_AURA_APPLIED) {
        // a new application: the first, or one after a real end; a re-send
        // (inside the gap) or a re-APPLIED over the open one only when
        // recast
        const afterRealEnd =
          lastRemovedMs !== undefined &&
          x.timestamp - lastRemovedMs > AURA_REBROADCAST_GAP_MS;
        if (
          openedAtMs === -Infinity ||
          afterRealEnd ||
          recast(openedAtMs, x.timestamp)
        )
          openedAtMs = x.timestamp;
        lastRemovedMs = undefined;
      } else if (
        ev === LogEvent.SPELL_AURA_REFRESH &&
        openedAtMs !== -Infinity &&
        ccRefreshIsNewApplication(sid)
      )
        openedAtMs = x.timestamp;
    }
    return recast(openedAtMs, applied.timestamp);
  };
}

/**
 * Work order 2026-10-14d #1: a SPELL_AURA_APPLIED of a CC whose application
 * from the same source is still open — no REMOVED / BROKEN in between — is
 * the SAME application, unless its source recast it (`ccRecastBetween`: a new
 * CC, as a cast-backed REFRESH is) or the open one is past its official
 * length (`officialS`; its REMOVED was never logged — the open one ends
 * there and this is a new application). The game re-sends every aura on a
 * unit in some state changes with no REMOVED: Mass Invisibility (fa5e6c66: a
 * Psychic Scream applied 13.755 re-APPLIED 15.714 with ~15 other auras), a
 * flag change on the holder (483f7433: Kidney Shot 35.594, again at 36.963
 * with no cast). Read as a new application, the start moved to the re-send
 * (`0:15 … (1s)` for a 2.85 s fear; `0:36 (4s)` beside its own 0:35 press).
 * `dropAuraRebroadcasts` only merges REMOVED → APPLIED. Unknown official
 * length → the same application (nothing says the first one ended).
 */
export function reAppliedIsSameApplication(
  openedAtMs: number,
  atMs: number,
  officialS: number | null | undefined,
  recast: boolean,
): boolean {
  if (recast) return false;
  return officialS == null || atMs < openedAtMs + officialS * 1000;
}

// ── Core DR computation ───────────────────────────────────────────────────────

/**
 * History of CC instances of a given DR category taken by one unit
 * (apply->removal pairing; unpaired ones are skipped -- conservative: fewer
 * instances biases toward Full). The single-source DR history of the
 * point queries (`drLevelAtLanding`, `drLevelNextAt`): dispelAnalysis's
 * `afterDR` / drChainRisk gate and ccBreakAnalysis's remaining-duration
 * discount consume it, and writing the pairing loop twice would be a
 * breeding ground for drift. Its sources are `isDrHistorySource`'s — every
 * source but a holder-self aura that is not a control (fact6 D29: a Sleep
 * Walk reflected back onto its caster was no history here, and `[CC BROKEN]`
 * read a 50 % Fear as Full; a pet's control was none either).
 */
export function buildCcCategoryHistory(
  unit: ICombatUnit,
  category: string,
  matchStartMs: number,
  // agy 40-FT-94 #4: the units that can have cast the CC (and their pets'
  // owners) — a re-APPLIED its source recast is a new application
  // (`ccRecastBetween`); absent → no recast test
  unitById?: ReadonlyMap<
    string,
    Pick<ICombatUnit, "spellCastEvents" | "ownerId">
  >,
): Array<
  CCEntry & {
    atSeconds: number;
    durationSeconds: number;
    drInfo: IDRInfo | null;
  }
> {
  // a REMOVED→APPLIED re-broadcast (`AURA_REBROADCAST_GAP_MS`) is one application, not two DR
  // steps (cc-dr F-RB1, ruling A50 = A: the shared `dropAuraRebroadcasts`).
  // Filter BEFORE the re-broadcast pass: this runs once per CC break / dispel
  // window, so re-keying every aura of the unit each call made it O(calls ×
  // auras) with a string build per aura (firstPaint report-heavy: ccBreakDash
  // 15 → 74 ms). Equivalent: the filter reads only spellId and srcUnitId, both
  // part of `dropAuraRebroadcasts`' pairing key, so each key group is kept or
  // dropped whole and in order.
  const relevant = unit.auraEvents.filter(
    (aura) =>
      !!aura.spellId &&
      isDrHistorySource(unit.id, aura.srcUnitId, aura.spellId, aura.auraType) &&
      getDRCategory(aura.spellId) === category,
  );
  // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08) —
  // read off the unit's whole stream, where the REMOVED is
  const notTheEnd = supersededAuraBreaks(unit.auraEvents);
  const instances: Array<
    CCEntry & {
      atSeconds: number;
      durationSeconds: number;
      drInfo: IDRInfo | null;
    }
  > = [];
  // the DR walk reads only drInfo.category; level/sequenceIndex are
  // placeholders.
  const close = (
    open: {
      applyMs: number;
      spellId: string;
      srcUnitId: string;
      applySeq: number;
    },
    removeMs: number,
  ) =>
    instances.push({
      applyMs: open.applyMs,
      removeMs,
      spellId: open.spellId,
      srcUnitId: open.srcUnitId,
      applySeq: open.applySeq,
      atSeconds: (open.applyMs - matchStartMs) / 1000,
      durationSeconds: (removeMs - open.applyMs) / 1000,
      drInfo: { category, level: "Full", sequenceIndex: 0 },
    });
  // work order 2026-10-15 Part 2 (user 「好」): the CC pairings' reading —
  // keyed by spell and source (`matchPendingCcKey` for a removal), a
  // re-APPLIED inside the official length is the same application
  // (`reAppliedIsSameApplication`; recast by its source — `unitById` — is a
  // new one, agy 40-FT-94 #4), a lost REMOVED closes at the official
  // length. It used to pair every APPLIED with the next removal of the
  // spell: a re-send was a second DR step, a lost REMOVED ran to a later
  // application's removal, an application never removed was skipped.
  const pending = new Map<
    string,
    { applyMs: number; spellId: string; srcUnitId: string; applySeq: number }
  >();
  let auraSeq = 0;
  for (const aura of dropAuraRebroadcasts(
    relevant,
    unitById
      ? ccRecastSplitsResend(unit.id, relevant, (id) => unitById.get(id))
      : undefined,
  )) {
    const seq = auraSeq++;
    const sid = aura.spellId;
    if (!sid) continue;
    if (notTheEnd.has(aura)) continue;
    const key = `${sid}:${aura.srcUnitId}`;
    const officialS = ccFullDurationSeconds(sid) ?? null;
    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      const open = pending.get(key);
      if (open !== undefined) {
        const src = unitById?.get(aura.srcUnitId);
        const owner = src?.ownerId ? unitById?.get(src.ownerId) : undefined;
        if (
          reAppliedIsSameApplication(
            open.applyMs,
            aura.timestamp,
            officialS,
            src !== undefined &&
              ccRecastBetween(
                [src, owner],
                sid,
                unit.id,
                open.applyMs,
                aura.timestamp,
              ),
          )
        )
          continue;
        close(open, Math.min(aura.timestamp, open.applyMs + officialS! * 1000));
      }
      pending.set(key, {
        applyMs: aura.timestamp,
        spellId: sid,
        srcUnitId: aura.srcUnitId,
        applySeq: seq,
      });
    } else if (aura.logLine.event === LogEvent.SPELL_AURA_REFRESH) {
      // a REFRESH is a new application and so a DR step, recast or not
      // (`ccRefreshIsNewApplication`). a400c9d8-r0 1:51: a Fear recast on a
      // target still in Fear logged only a REFRESH, ran 3.0 s (50 %), and
      // the Howl of Terror after it was logged IMMUNE — read as one Full Fear
      const open = pending.get(key);
      if (!open || !ccRefreshIsNewApplication(sid)) continue;
      close(open, aura.timestamp);
      pending.set(key, {
        applyMs: aura.timestamp,
        spellId: sid,
        srcUnitId: aura.srcUnitId,
        applySeq: seq,
      });
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const k = matchPendingCcKey(pending, sid, key);
      const open = k ? pending.get(k) : undefined;
      if (!k || !open) continue;
      pending.delete(k);
      close(open, aura.timestamp);
    }
  }
  for (const open of pending.values()) {
    const officialS = ccFullDurationSeconds(open.spellId);
    if (officialS !== undefined) close(open, open.applyMs + officialS * 1000);
  }
  instances.sort(
    (a, b) => a.atSeconds - b.atSeconds || a.applySeq! - b.applySeq!,
  );
  return instances;
}

/**
 * Returns the DR category key for a spell ID.
 * For unknown spells, falls back to the spell ID itself (self-DR only).
 */
export function getDRCategory(spellId: string): string {
  return DR_CATEGORY_MAP[spellId] ?? `spell:${spellId}`;
}

/**
 * The CC aura a CC CAST applies, when its logged cast id is not that aura's:
 * the most-applied effect aura of the cast (`castEffectAuras.ts`, the one
 * cast→effect table — DB2 nominates, the corpus verifies, ruling A10) that
 * HAS an official DR category; undefined when none does (the cast id then
 * answers for itself). `DR_CATEGORY_MAP` is keyed by aura id on purpose
 * (drCategories.ts), so looking one of these casts up directly lands on the
 * `spell:<castId>` self-DR fallback, and a consumer that filters the target's
 * CC auras by that key finds none — DR read Full forever (GH #111:
 * `[PEEL OPTION]` and `[CC BOOKMARK]` offered Shockwave at Full DR right after
 * a stun). Binding Shot's tether 117405 is in the table and has no DR
 * category; its stun 117526 does.
 *
 * Until triage G3 (2026-10-02) this was the hand list `CC_CAST_EFFECT_AURA`
 * (14 rows, single-valued, measured 2026-09-25); the generated table holds all
 * 14 (`test/castEffectAuras.test.ts`), plus Storm Bolt 107570 → 132169 and
 * Freezing Trap's Diamond Ice 203337 it could not. `test/drCategoryIds.test.ts`
 * fails when a CC id with a known mechanic resolves to no DR category and is
 * not a declared self-DR spell. Infernal Awakening 22703: its cast and aura id
 * are the same, and drShareScan shows it shares no DR family (5d6347e3).
 */
export function drEffectAuraOfCast(castSpellId: string): string | undefined {
  return drEffectAurasOfCast(castSpellId)[0];
}

/** Every effect aura of the cast that has an official DR category, most
 * applied first — the set form of `drEffectAuraOfCast` (Freezing Trap: 3355
 * and Diamond Ice's 203337). */
export function drEffectAurasOfCast(castSpellId: string): readonly string[] {
  return effectAurasOfCast(castSpellId).filter((a) => DR_CATEGORY_MAP[a]);
}

/**
 * Spells whose own id IS their DR family (no shared category) — the
 * `spell:<id>` fallback is correct for them, not a missing mapping.
 * Infernal Awakening 22703: drShareScan shows it shares no DR family
 * (5d6347e3). Single source for the completeness test and the CC samplers.
 */
export const SELF_DR_SPELL_IDS: ReadonlySet<string> = new Set(["22703"]);

/**
 * Is `castSpellId`'s DR category actually known? False for a `spell:<id>`
 * fallback that is not a declared self-DR spell — a consumer must then say
 * nothing about DR ("n/a"), never "Full" (reliability round 2 W1g: every
 * trap / totem / grip whose cast id was unmapped read "DR Full" forever).
 */
export function drCategoryKnown(
  castSpellId: string,
  casterApplied?: ReadonlySet<string>,
): boolean {
  const cat = drCategoryOfCast(castSpellId, casterApplied);
  return !cat.startsWith("spell:") || SELF_DR_SPELL_IDS.has(castSpellId);
}

/** The DR category of the CC a CAST applies — the single source for any
 * consumer that starts from a spell the player can press (a cooldown, a kit
 * entry) rather than from an aura in the log.
 *
 * When the cast's effect auras sit in DIFFERENT DR families (Holy Word:
 * Chastise 88625: the stun 200200 or, with its talent, the incapacitate
 * 200196), corpus popularity does not decide (codex 35-CD-06): the caster's
 * own applications do (`casterApplied`, `auraIdsAppliedBy`). Without evidence
 * of exactly one family the category is unknown — the `spell:<castId>`
 * fallback, which `drCategoryKnown` reports as unknown ("n/a", never "Full"),
 * what the cast read before the table existed. */
export function drCategoryOfCast(
  castSpellId: string,
  casterApplied?: ReadonlySet<string>,
): string {
  const auras = drEffectAurasOfCast(castSpellId);
  const families = new Set(auras.map(getDRCategory));
  if (families.size <= 1) return getDRCategory(auras[0] ?? castSpellId);
  const seen = new Set(
    auras.filter((a) => casterApplied?.has(a)).map(getDRCategory),
  );
  return seen.size === 1 ? [...seen][0]! : `spell:${castSpellId}`;
}

/** The aura ids `casterId` applied (APPLIED / REFRESH) on any of `units` —
 * the caster evidence `drCategoryOfCast` reads for a cast with variants in
 * different DR families. */
export function auraIdsAppliedBy(
  casterId: string,
  units: ReadonlyArray<Pick<ICombatUnit, "auraEvents">>,
): Set<string> {
  const out = new Set<string>();
  for (const u of units)
    for (const a of u.auraEvents ?? [])
      if (
        a.srcUnitId === casterId &&
        a.spellId &&
        (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH)
      )
        out.add(a.spellId);
  return out;
}

/**
 * THE DR walk (fact6 F20: one walk, two queries). Given a unit's history of
 * applications of ONE category, the DR level AND sequence index a control
 * landing at `newApplyMs` gets: the applications that landed at or before it
 * (`applyMs <= newApplyMs` — one landing on that very ms is already on; a
 * caller asking about an application in the history removes it first,
 * `drLevelAtLanding`), walked in landing order. An application joins the
 * running chain when it lands before the chain's end — the LATEST end of its
 * members (a short control inside a long one does not end the chain) — plus
 * the reset window (`drResetMsAt`; a gap of exactly the window resets); the
 * new control's level is Full / 50% / Immune for 0 / 1 / ≥ 2 members.
 *
 * Both values come from the same walk, so they are always consistent.
 * Callers must NOT compute sequenceIndex independently (e.g. via a flat
 * window filter) — that diverges for long chains.
 *
 * Note on 'Immune': this can return Immune (≥ 2 in the chain), but WoW
 * writes no aura for an immune control, so the outgoing path never sees it on
 * a landed one; it is kept for the point queries (`[CC NOT LANDED]`'s cause).
 */
export function getDRLevel(
  history: readonly CCEntry[],
  newApplyMs: number,
): { level: DRLevel; sequenceIndex: number } {
  // newApplyMs is a wall-clock epoch (callers add matchStartMs), so the era
  // is derivable from the timestamp itself — no signature change needed.
  const resetMs = drResetMsAt(newApplyMs);
  // Only a CC applied at or BEFORE this one can diminish it (reliability
  // audit B3iv, 2026-09-25: the outgoing path used to feed entries in
  // REMOVAL order, so a later-applied, earlier-removed CC counted)
  const prior = history
    .filter((e) => e.applyMs <= newApplyMs)
    .sort((x, y) => x.applyMs - y.applyMs);
  let chainLength = 0;
  let chainEnd = -Infinity;
  for (const e of prior) {
    if (chainLength > 0 && e.applyMs - chainEnd >= resetMs) chainLength = 0;
    chainEnd = chainLength === 0 ? e.removeMs : Math.max(chainEnd, e.removeMs);
    chainLength++;
  }
  if (chainLength > 0 && newApplyMs - chainEnd >= resetMs) chainLength = 0;
  // WoW 12.0: Full → 50% → Immune (25% tier removed)
  const level: DRLevel =
    chainLength === 0 ? "Full" : chainLength === 1 ? "50%" : "Immune";
  return { level, sequenceIndex: chainLength };
}

/**
 * Q1 — the DR level an application IN `history` landed at: the walk over
 * every other entry, the application itself taken out by identity (its
 * spell, its source and its landing ms; failing an exact landing, the entry
 * of that spell and source whose span holds the landing — two pairings of
 * one aura can differ by a re-send). Never by time: a control of the same
 * family landing on the same ms from another source still counts when the
 * log wrote it first (`applySeq`); one written after it does not (codex
 * 20-F20-28 #1 — the order the CC windows and the outgoing chains read).
 * Readers: `[CC BROKEN]` / `[CC REMOVED]` (`ccRemainingSeconds`), the
 * missed-cleanse `afterDR` cell and `drChainRisk` (dispelAnalysis).
 */
export function drLevelAtLanding(
  history: readonly CCEntry[],
  landing: { applyMs: number; spellId: string; srcUnitId?: string },
): DRLevel {
  const same = (e: CCEntry) =>
    e.spellId === landing.spellId &&
    (landing.srcUnitId === undefined || e.srcUnitId === landing.srcUnitId);
  const self =
    history.find((e) => same(e) && e.applyMs === landing.applyMs) ??
    history.find(
      (e) =>
        same(e) && e.applyMs <= landing.applyMs && landing.applyMs < e.removeMs,
    );
  // nor one landing on its ms that the log wrote after it (codex 20-F20-28
  // #1: a Fear then a Blind on one ms — the Fear landed Full, and its
  // remainder at its break read the Blind's 50 %)
  const after = (e: CCEntry) =>
    self?.applySeq !== undefined &&
    e.applySeq !== undefined &&
    e.applyMs === self.applyMs &&
    e.applySeq > self.applySeq;
  return getDRLevel(
    history.filter((e) => e !== self && !after(e)),
    landing.applyMs,
  ).level;
}

/**
 * Q2 — the DR level a control of `category` would land at at `atMs`:
 * every application of the family that landed at or before `atMs` (one
 * landing at that very ms is on — fact6 D10: the burst window opened on the
 * Cyclone's own ms, `[HEALER EXPOSURE]` said "already in Cyclone … the DR
 * levels count it" and printed Full DR).
 */
export function drLevelNextAt(
  history: readonly CCEntry[],
  atMs: number,
): DRLevel {
  return getDRLevel(history, atMs).level;
}

/**
 * Q2 over a CC summary's instances (`atSeconds` / `durationSeconds` /
 * `drInfo.category`): `drLevelNextAt` on the instances of `category`. Used
 * by `[HEALER EXPOSURE]` and the enemy-healer DR of `[KILL WINDOW]` /
 * `[VULNERABLE]`; pass the summary's history-only entries too
 * (`IPlayerCCTrinketSummary.drHistoryOnly`).
 */
export function getDRLevelAtTime(
  ccInstances: ReadonlyArray<{
    atSeconds: number;
    durationSeconds: number;
    drInfo: IDRInfo | null;
  }>,
  category: string,
  atSeconds: number,
  // Wall-clock epoch of match start. Required so no caller silently defaults.
  matchStartMs: number,
): DRLevel {
  const history: CCEntry[] = [];
  for (const cc of ccInstances)
    if (cc.drInfo?.category === category)
      history.push({
        applyMs: matchStartMs + cc.atSeconds * 1000,
        removeMs: matchStartMs + (cc.atSeconds + cc.durationSeconds) * 1000,
        spellId: "",
      });
  return drLevelNextAt(history, matchStartMs + atSeconds * 1000);
}

// ── Incoming CC DR annotation ─────────────────────────────────────────────────

/**
 * Computes DR info for a list of CC instances received by a single target,
 * in chronological order. Returns a parallel array of IDRInfo (or null if the
 * spell ID is not in ccSpellIds).
 */
export function computeIncomingDR(
  ccInstances: Array<{
    atSeconds: number;
    durationSeconds: number;
    spellId: string;
  }>,
  matchStartMs: number,
  /** controls that are DR history on the unit but none of its instances
   * (its own control reflected back onto it — fact4 D7), epoch ms;
   * `afterLandingAtSameMs`: one an instance's own REFRESH began, which an
   * instance landing on that same ms (the one it refreshed) does not count */
  historyOnly: ReadonlyArray<{
    applyMs: number;
    removeMs: number;
    spellId: string;
    afterLandingAtSameMs?: true;
  }> = [],
): Array<IDRInfo | null> {
  // Per DR-category history: list of resolved {applyMs, removeMs}
  const history: Map<string, CCEntry[]> = new Map();
  let nextExtra = 0;
  const extras = [...historyOnly]
    .filter((h) => ccSpellIds.has(h.spellId))
    .sort(
      (a, b) =>
        a.applyMs - b.applyMs ||
        Number(!!a.afterLandingAtSameMs) - Number(!!b.afterLandingAtSameMs),
    );

  return ccInstances.map((cc) => {
    // the history-only applications that landed at or before this one join
    // first (`getDRLevel` counts a landing on the same ms) — save one a
    // REFRESH of an instance on that ms began, which follows it
    const atMs = matchStartMs + cc.atSeconds * 1000;
    while (
      nextExtra < extras.length &&
      (extras[nextExtra]!.afterLandingAtSameMs
        ? extras[nextExtra]!.applyMs < atMs
        : extras[nextExtra]!.applyMs <= atMs)
    ) {
      const h = extras[nextExtra++]!;
      const hc = getDRCategory(h.spellId);
      const list = history.get(hc) ?? [];
      list.push({
        applyMs: h.applyMs,
        removeMs: h.removeMs,
        spellId: h.spellId,
      });
      history.set(hc, list);
    }
    if (!ccSpellIds.has(cc.spellId)) return null;

    const applyMs = matchStartMs + cc.atSeconds * 1000;
    const removeMs = applyMs + cc.durationSeconds * 1000;
    const category = getDRCategory(cc.spellId);

    const cat = history.get(category) ?? [];
    const { level, sequenceIndex } = getDRLevel(cat, applyMs);

    cat.push({ applyMs, removeMs, spellId: cc.spellId });
    history.set(category, cat);

    return { category: getDRCategory(cc.spellId), level, sequenceIndex };
  });
}

// ── Outgoing CC chain analysis ────────────────────────────────────────────────

export interface IOutgoingCCApplication {
  atSeconds: number;
  durationSeconds: number;
  spellId: string;
  spellName: string;
  casterName: string;
  casterSpec: string;
  drInfo: IDRInfo;
  /** still on at the round's end (`roundEndMs`), so cut there — what the
   * `[CC ON ENEMY]` line's `still on them when the round ended` states; its
   * `durationSeconds` stops at the round's end, so a reader cannot tell it
   * from a control that ended on that ms (F19 605 gate: a Binding Shot the
   * round ended on lost its missed-sync `endedBy=the round's end`) */
  cutByRoundEnd?: true;
}

export interface IOutgoingCCChain {
  targetName: string;
  targetSpec: string;
  applications: IOutgoingCCApplication[];
  /** every control that is DR history on the target, in landing order: the
   * applications above plus the DR-only ones (`drOnly`) — a control of the
   * target's own reflected back onto it, a control from any other source the
   * chain credits to no friendly (`isDrHistorySource`). The history the
   * point queries on this target read (`[CC NOT LANDED]`'s DR cause, the
   * `[DR CLASH]` predecessor). */
  drHistory?: Array<IOutgoingCCApplication & { drOnly?: true }>;
  // hasWastedApplications 已删除(GH #17,2026-08-20):它按 {25%, Immune}
  // 判「浪费」,而 25% 档 12.0 已从游戏移除、Immune 档按本文件 :325 的契约
  // 不该出现在 outgoing 路径 —— 实测出现的全是链窗模型与服务器 DR 窗口
  // 错位的解析伪影(带真实时长)。dr-clipped-cc 候选与 CC Chains 的
  // "hit immune" 提示随之同批退役;逐条 application 的 drInfo 照旧保留。
}

/**
 * Scans enemy aura events for CC spells cast by friendly players.
 * Returns per-enemy CC chains annotated with DR levels.
 *
 * Returns **every** enemy chain with at least one landed CC, with no filtering
 * by DR level (whether an application was diminished is recorded in its own
 * drInfo).
 * This comment once claimed "only returns chains with at least one diminished
 * application" -- that contradicts the actual filter (applications.length > 0);
 * the timeline's DR annotation on [YOU] [CC] depends on getting everything
 * back, so do not reinstate a filter on the strength of that sentence.
 */
export function analyzeOutgoingCCChains(
  friendlies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
): IOutgoingCCChain[] {
  const friendlyIds = new Set(friendlies.map((f) => f.id));
  const friendlySpecMap = new Map(
    friendlies.map((f) => [f.id, specToString(f.spec)]),
  );
  const matchStartMs = combat.startTime;
  // the round's end (`roundEndMs`): an application after it is in no round,
  // one still on then is cut there (codex R6C-06 #4: a Solo Shuffle chain ran
  // to the log's end, past the ending death)
  const roundEnd = roundEndMs(combat);

  // Target filter: Player type + belongs to the passed second-arg collection
  // (id-set membership), NOT a hardcoded `reaction === Hostile` check (#24).
  // Product callsites all pass `(friends, enemies)` where `enemies` are
  // Hostile players, so membership is equivalent to the old reaction check
  // there; but `matchExplore.ts`'s `dr` query and `archetypeInference.ts`
  // also call this reversed as `(enemies, friends)` to get the other
  // direction's CC chains, and a friendly target's reaction is `Friendly` —
  // the old Hostile-only filter silently dropped every target in that call
  // shape, making the reversed call always return `[]`.
  const targetIds = new Set(enemies.map((e) => e.id));
  // Reliability audit C6 (2026-09-25): a CC applied by a friendly SUMMON
  // (Capacitor Totem, Intimidation, a Felhunter / Succubus, Psyfiend…) is the
  // owner's CC. It used to be dropped by the caster filter below: 4ef486f5 r1
  // had 5 summon hard CCs on the enemy healer in [CC ON ENEMY] (Intimidation
  // ×3, Capacitor ×2) and 4 windows in `enemyHealerCcWindows`, none of them.
  // Credited to the owner through the same GUID lookup as every `(by X's pet)`
  // line (`summonOwnerById`); the pending key keeps the summon's own GUID so
  // its removal still closes it.
  const allUnits = Object.values(combat.units ?? {});
  const creditedCaster = (srcId: string): ICombatUnit | undefined =>
    friendlyIds.has(srcId)
      ? friendlies.find((f) => f.id === srcId)
      : summonOwnerById(allUnits, srcId, friendlies);

  return enemies
    .filter((e) => e.type === CombatUnitType.Player && targetIds.has(e.id))
    .map((enemy) => {
      const pending: Map<
        string,
        {
          applyMs: number;
          spellName: string;
          srcId: string;
          srcName: string;
          drOnly: boolean;
          /** the opening row's place on the target's aura stream: landings
           * on one ms keep the log's order (`ccTrinketAnalysis`' windows
           * read the same, F20 wide residual) */
          applySeq: number;
        }
      > = new Map();
      const applications: IOutgoingCCApplication[] = [];
      const applySeqOf = new Map<IOutgoingCCApplication, number>();
      // fact4 D7 (2742ff5d 0:59–1:05): a control of the target's own,
      // reflected back onto it (its source is the target — the Fear a Spell
      // Reflection sent back), is DR history on it but no CC of ours: it
      // feeds the DR walk below and leaves no application (the incoming
      // path's reading, ruling A52 — `reflectedOntoHolder`). fact6 F20: so is
      // a control from any other source no friendly is credited with
      // (`isDrHistorySource` — the one DR-history source test)
      const drOnly = new Set<IOutgoingCCApplication>();

      // Helper: close a pending CC entry and push it to applications + history
      const closePending = (
        key: string,
        removeMs: number,
        noRemoved?: boolean,
      ) => {
        const p = pending.get(key);
        if (!p) return;
        pending.delete(key);

        const spellId = key.split(":")[0];
        if (!spellId) return;
        if (p.applyMs >= roundEnd) return;
        const cutByRoundEnd = stillOnAtRoundEnd(removeMs, noRemoved, roundEnd);
        const durationSeconds =
          (Math.min(removeMs, roundEnd) - p.applyMs) / 1000;

        // DR is assigned below, in APPLY order, once every interval is closed.
        const app: IOutgoingCCApplication = {
          atSeconds: (p.applyMs - matchStartMs) / 1000,
          durationSeconds,
          spellId,
          spellName: p.spellName,
          casterName: p.srcName,
          casterSpec: friendlySpecMap.get(p.srcId) ?? "Unknown",
          drInfo: {
            category: DR_CATEGORY_MAP[spellId] ?? "Unknown",
            level: "Full",
            sequenceIndex: 0,
          },
          ...(cutByRoundEnd ? { cutByRoundEnd: true as const } : {}),
        };
        applications.push(app);
        applySeqOf.set(app, p.applySeq);
        if (p.drOnly) drOnly.add(app);
      };

      // cc-dr F-RB1 (ruling A50 = A): a same-ms REMOVED→APPLIED re-broadcast
      // of one cast is one application — the shared `dropAuraRebroadcasts`
      // every aura consumer filters through. Counted as two, it gave a landed
      // CC `[DR: … Immune]` and KILL ATTEMPTS an extra stun (bd790c92 R:557,
      // 4446729d R:311 `2 stuns` → `1 stun`).
      // (CC ids only, filtered first — the filter reads only spellId, part of
      // the pairing key, so the result is unchanged and the re-broadcast pass
      // keys a few CC auras instead of every aura on the enemy)
      const notTheEnd = supersededAuraBreaks(enemy.auraEvents);
      const ccAuras = enemy.auraEvents.filter(
        (a) => !!a.spellId && ccSpellIds.has(a.spellId),
      );
      let auraSeq = 0;
      for (const aura of dropAuraRebroadcasts(
        ccAuras,
        ccRecastSplitsResend(enemy.id, ccAuras, (id) =>
          allUnits.find((u) => u.id === id),
        ),
      )) {
        const seq = auraSeq++;
        const { spellId } = aura;
        if (!spellId || !ccSpellIds.has(spellId)) continue;
        // a BROKEN line its aura's own REMOVED follows is not the end
        // (FT-T08): the application closes at the REMOVED, as in
        // `buildAuraIntervals` and the CC windows on the holder
        if (notTheEnd.has(aura)) continue;
        const event = aura.logLine.event;
        const isRemovalEvent =
          event === LogEvent.SPELL_AURA_REMOVED ||
          event === LogEvent.SPELL_AURA_BROKEN ||
          event === LogEvent.SPELL_AURA_BROKEN_SPELL;
        // The caster filter applies to apply/refresh only: removals
        // (especially BROKEN, where src = the breaker) must not be discarded
        // by src -- otherwise a broken CC never closes (the inflated-duration
        // fix).
        const credited = isRemovalEvent
          ? undefined
          : creditedCaster(aura.srcUnitId);
        const caster =
          isRemovalEvent || credited
            ? credited
            : isDrHistorySource(
                  enemy.id,
                  aura.srcUnitId,
                  spellId,
                  aura.auraType,
                )
              ? aura.srcUnitId === enemy.id
                ? enemy
                : allUnits.find((u) => u.id === aura.srcUnitId)
              : undefined;
        if (!isRemovalEvent && !caster) continue;

        const key = `${spellId}:${aura.srcUnitId}`;

        const open =
          event === LogEvent.SPELL_AURA_APPLIED ? pending.get(key) : undefined;
        if (open !== undefined) {
          // work order 2026-10-14d #1: an APPLIED while this source's
          // application is still open is that application unless recast or
          // past its official length (`reAppliedIsSameApplication`). It
          // used to overwrite the open one, which then never closed: the
          // chain lost it and [CC CAST] printed the re-send (fa5e6c66 0:15)
          const src = allUnits.find((u) => u.id === aura.srcUnitId);
          const owner = src?.ownerId
            ? allUnits.find((u) => u.id === src.ownerId)
            : undefined;
          const recast = ccRecastBetween(
            [src, owner],
            spellId,
            enemy.id,
            open.applyMs,
            aura.timestamp,
          );
          // a CC whose aura length the interval table leaves open (Kidney
          // Shot: combo points) still has the control's official length
          const officialS =
            officialDurationS(spellId, caster, open.applyMs) ??
            ccFullDurationSeconds(spellId) ??
            null;
          if (
            reAppliedIsSameApplication(
              open.applyMs,
              aura.timestamp,
              officialS,
              recast,
            )
          )
            continue;
          closePending(
            key,
            // its REMOVED was never logged: never longer than its official
            // length, recast or not (the 605 preview: a Scatter Shot whose
            // removal Mass Invisibility swallowed ran 77 s to the next cast)
            officialS === null
              ? aura.timestamp
              : Math.min(aura.timestamp, open.applyMs + officialS * 1000),
          );
        }
        if (event === LogEvent.SPELL_AURA_APPLIED) {
          pending.set(key, {
            applyMs: aura.timestamp,
            spellName: getEnglishSpellName(spellId, aura.spellName),
            srcId: caster!.id,
            srcName: friendlyIds.has(aura.srcUnitId)
              ? aura.srcUnitName
              : caster!.name,
            drOnly: !credited,
            applySeq: seq,
          });
        } else if (event === LogEvent.SPELL_AURA_REFRESH) {
          // A REFRESH is a new application and burns the next DR tier,
          // recast or not — the shared history's reading
          // (`ccRefreshIsNewApplication`). c5ae2200 r3 109.852 s: a Bull
          // Rush and its REFRESH 1 ms later are two stuns, the second
          // re-timed to 0.75 s (codex F20-05 read it as one; the 605
          // corpus's Bull Rush double-applies end at REFRESH + 0.75 s, 3 / 3)
          const prior = pending.get(key);
          if (!prior || !ccRefreshIsNewApplication(spellId)) continue;
          closePending(key, aura.timestamp);
          pending.set(key, {
            applyMs: aura.timestamp,
            spellName: getEnglishSpellName(spellId, aura.spellName),
            srcId: caster!.id,
            srcName: friendlyIds.has(aura.srcUnitId)
              ? aura.srcUnitName
              : caster!.name,
            drOnly: !credited,
            applySeq: seq,
          });
        } else if (isRemovalEvent) {
          const matchKey = matchPendingCcKey(pending, spellId, key);
          if (matchKey) closePending(matchKey, aura.timestamp);
        }
      }

      // Close any still-pending CCs at match end — capped at the CC's
      // official length (crisis-external F-K5: the cap `buildAuraIntervals`
      // applies, `officialDurationS`). Closed at the round end, one Chastise
      // lasted 98.87 s and glued four stuns across 100 s into one kill
      // attempt (69546267). A capped close has no logged cause.
      for (const key of Array.from(pending.keys())) {
        const p = pending.get(key)!;
        const caster =
          friendlies.find((f) => f.id === p.srcId) ??
          allUnits.find((u) => u.id === p.srcId);
        const spellId = key.split(":")[0] ?? "";
        // …and when that length is not known (a Kidney Shot with no combo
        // points read), the [CC ON ENEMY] builder's own cap
        // (`ccFullDurationForCaster`, its `pendingEnd`) — so the two say
        // the same about the round's end (codex 20-F19-06: the log's end
        // read as the cut there, a 15 s cap here)
        const fullS =
          officialDurationS(spellId, caster, p.applyMs) ??
          ccFullDurationForCaster(spellId, caster) ??
          null;
        // closePending cuts it at the round's end, and says so — the log
        // never closed it
        closePending(
          key,
          fullS === null
            ? combat.endTime
            : Math.min(combat.endTime, p.applyMs + fullS * 1000),
          true,
        );
      }

      applications.sort(
        (a, b) =>
          a.atSeconds - b.atSeconds ||
          (applySeqOf.get(a) ?? 0) - (applySeqOf.get(b) ?? 0),
      );
      // Reliability audit B3iv (2026-09-25): DR levels in APPLY order, through
      // the same algorithm the incoming path uses (`computeIncomingDR`, which
      // walks instances in time order). They used to be computed at REMOVAL
      // time: 825ca842 Fear 51.24 (removed 55.77) and Blind 51.35 (removed
      // 53.85) came out Fear 50 % / Blind Full — inverted — and the Blind
      // [DR CLASH] was never shown; 10 of 413 applications across the five
      // audited matches were mislabelled.
      const drs = computeIncomingDR(applications, matchStartMs);
      applications.forEach((app, i) => {
        const dr = drs[i];
        if (dr)
          app.drInfo = {
            category: app.drInfo.category,
            level: dr.level,
            sequenceIndex: dr.sequenceIndex,
          };
      });

      return {
        targetName: enemy.name,
        targetSpec: specToString(enemy.spec),
        applications: applications.filter((a) => !drOnly.has(a)),
        drHistory: applications.map((a) =>
          drOnly.has(a) ? { ...a, drOnly: true as const } : a,
        ),
      };
    })
    .filter((chain) => chain.applications.length > 0);
}

export interface ITeammateDrClash {
  targetName: string;
  targetSpec: string;
  category: string;
  level: DRLevel;
  atSeconds: number;
  priorCasterName: string;
  priorCasterSpec: string;
  priorSpellId: string;
  priorSpellName: string;
  priorAtSeconds: number;
  priorDurationSeconds: number;
  diminishedCasterName: string;
  diminishedCasterSpec: string;
  diminishedSpellId: string;
  diminishedSpellName: string;
  gapSeconds: number;
}

/**
 * Detects instances where a friendly CC landed at diminished DR (50% or Immune)
 * because a DIFFERENT friendly player applied a CC in the same DR category
 * within the reset window (GH #67 S3, docs/archive/rulings-pending-2026-09-18.md).
 *
 * Attribution rule:
 * - Only within the DR reset window (drResetMsAt(matchStartMs)). Beyond that,
 *   the DR has expired and any diminishment is not caused by that prior application.
 * - Only between different friendly casters (self-inflicted DR is a cadence issue,
 *   not a team resource conflict).
 */
export function detectTeammateDrClashes(
  chains: IOutgoingCCChain[],
  matchStartMs: number,
): ITeammateDrClash[] {
  const clashes: ITeammateDrClash[] = [];
  const resetS = drResetMsAt(matchStartMs) / 1000;

  for (const chain of chains) {
    // the whole DR history: a 50 % landing's predecessor can be a DR-only
    // control (fact6 F20 — one reflected back onto the target, or from a
    // source no friendly is credited with); then no teammate put them on DR
    // and nothing is printed
    const byCat = new Map<
      string,
      Array<IOutgoingCCApplication & { drOnly?: true }>
    >();
    for (const a of chain.drHistory ?? chain.applications) {
      const c = a.drInfo?.category;
      if (!c || c === "Unknown" || c.startsWith("spell:")) continue;
      byCat.set(c, [...(byCat.get(c) ?? []), a]);
    }

    for (const [cat, list] of byCat) {
      const ordered = [...list].sort((x, y) => x.atSeconds - y.atSeconds);
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i]!;
        // Only real diminished tier in outgoing chains: 25% was removed in 12.0,
        // and Immune in outgoing chains is a reconstruction artifact (landed aura
        // events never hit true immunity; see IOutgoingCCChain comment).
        if (a.drOnly || a.drInfo.level !== "50%") continue;
        const prev = ordered[i - 1]!;
        if (prev.drOnly) continue;
        // Chain semantics: the reset clock runs from the previous CC's END.
        if (a.atSeconds - (prev.atSeconds + prev.durationSeconds) >= resetS) {
          continue;
        }
        if (prev.casterName !== a.casterName) {
          clashes.push({
            targetName: chain.targetName,
            targetSpec: chain.targetSpec,
            category: cat,
            level: a.drInfo.level,
            atSeconds: a.atSeconds,
            priorCasterName: prev.casterName,
            priorCasterSpec: prev.casterSpec,
            priorSpellId: prev.spellId,
            priorSpellName: prev.spellName,
            priorAtSeconds: prev.atSeconds,
            priorDurationSeconds: prev.durationSeconds,
            diminishedCasterName: a.casterName,
            diminishedCasterSpec: a.casterSpec,
            diminishedSpellId: a.spellId,
            diminishedSpellName: a.spellName,
            gapSeconds: Math.round((a.atSeconds - prev.atSeconds) * 10) / 10,
          });
        }
      }
    }
  }

  clashes.sort((a, b) => a.atSeconds - b.atSeconds);
  return clashes;
}

// ── Formatters ────────────────────────────────────────────────────────────────

export const DR_LEVEL_LABEL: Record<DRLevel, string> = {
  Full: "full duration",
  "50%": "50% DR",
  "25%": "25% DR",
  Immune: "IMMUNE",
};

export function formatOutgoingCCChainsForContext(
  chains: IOutgoingCCChain[],
): string[] {
  const bodyLines: string[] = [];

  for (const chain of chains) {
    // H3: only count applications whose DR category is identifiable. An 'Unknown'
    // category carries no diminishing-returns signal, and previously rendered as a
    // noisy "× Unknown" that corrupted the DR-chain breakdown the model treats as
    // ground truth. Drop them from the breakdown and the counts so the line stays
    // internally consistent; skip a chain entirely if nothing identifiable remains.
    const apps = chain.applications.filter(
      (a) =>
        a.drInfo.category !== "Unknown" &&
        !a.drInfo.category.startsWith("spell:"),
    );
    if (apps.length === 0) continue;

    const total = apps.length;
    // "N immune ⚠ hit immune — switch target" 已删除(GH #17,2026-08-20):
    // Immune 标注在 outgoing 路径全是解析伪影(见 IOutgoingCCChain 注释),
    // 向模型断言「打进免疫」是假事实。reduced(50%)照旧 —— 那是真实递减。
    const reducedCount = apps.filter(
      (a) => a.drInfo.level !== "Full" && a.drInfo.level !== "Immune",
    ).length;

    // Group by DR category for the summary
    const categoryMap = new Map<string, number>();
    for (const app of apps) {
      categoryMap.set(
        app.drInfo.category,
        (categoryMap.get(app.drInfo.category) ?? 0) + 1,
      );
    }
    const categoryStr = [...categoryMap.entries()]
      .map(([cat, count]) => `${count}× ${cat}`)
      .join(", ");

    bodyLines.push(
      `  ${chain.targetSpec} (${chain.targetName}): ${total} CC — ${categoryStr} | ${reducedCount} reduced`,
    );
  }

  if (bodyLines.length === 0) return [];
  return ["## CC Chains", ...bodyLines];
}

/**
 * Groups CC applications from outgoing CC chains into per-cast AoE events.
 *
 * Only spells in AOE_CC_SPELL_IDS are included. Applications from the same
 * (spellId, casterName) are split into separate casts whenever the gap from
 * the most recently started event exceeds 0.5s (F66b grouping fix).
 *
 * Single-target applications of whitelisted spells are emitted — they carry
 * tactical signal ("player used AoE fear, caught only 1 enemy").
 */
export function extractAoeCCEvents(chains: IOutgoingCCChain[]): IAoeCCEvent[] {
  const flat: Array<{
    casterName: string;
    spellId: string;
    spellName: string;
    atSeconds: number;
    targetName: string;
    durationSeconds: number;
  }> = [];

  for (const chain of chains) {
    for (const app of chain.applications) {
      if (!AOE_CC_SPELL_IDS.has(app.spellId)) continue;
      flat.push({
        casterName: app.casterName,
        spellId: app.spellId,
        spellName: app.spellName,
        atSeconds: app.atSeconds,
        targetName: chain.targetName,
        durationSeconds: app.durationSeconds,
      });
    }
  }

  flat.sort((a, b) => a.atSeconds - b.atSeconds);

  const GROUPING_WINDOW_S = 0.5;
  const events: IAoeCCEvent[] = [];
  // pairKey → the most recently started event for that (spellId, casterName) pair
  const currentEvent = new Map<string, IAoeCCEvent>();

  for (const app of flat) {
    const pairKey = `${app.spellId}\x00${app.casterName}`;
    const prev = currentEvent.get(pairKey);

    if (
      prev === undefined ||
      app.atSeconds - prev.atSeconds > GROUPING_WINDOW_S
    ) {
      const evt: IAoeCCEvent = {
        casterName: app.casterName,
        spellId: app.spellId,
        spellName: app.spellName,
        atSeconds: app.atSeconds,
        targets: [
          { name: app.targetName, durationSeconds: app.durationSeconds },
        ],
      };
      events.push(evt);
      currentEvent.set(pairKey, evt);
    } else {
      prev.targets.push({
        name: app.targetName,
        durationSeconds: app.durationSeconds,
      });
    }
  }

  return events.sort((a, b) => a.atSeconds - b.atSeconds);
}
