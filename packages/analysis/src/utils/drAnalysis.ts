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

import { spellClassMap } from "../data/drCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import { specToString } from "./cooldowns";
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
 * re-derive their own epoch.
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
  return epochMs >= DR_RESET_CUTOVER_EPOCH_MS
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
  map["107079"] = "Stun"; // Quaking Palm (Pandaren racial)

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
  "77505", // Shockwave (Warrior)
  "119381", // Leg Sweep (Monk)
  "20549", // War Stomp (Tauren racial)
  "99", // Incapacitating Roar (Druid Bear)
  "30283", // Shadowfury (Warlock) — small AoE on impact
  "255941", // Bursting Shot (Hunter) — disorients group
  "207685", // Sigil of Misery (Demon Hunter) — AoE incapacitate
]);

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

/** True iff `cc`'s DR category is stun. Conservative on missing/unknown data (no
 * `drInfo`, or a category outside the known set): treated as NOT stun, the same
 * false-accusation-averse direction the rest of this CC-gating logic uses. */
export function isStunCcInstance(cc: {
  drInfo?: { category: string } | null;
}): boolean {
  return cc.drInfo?.category === STUN_DR_CATEGORY;
}

interface CCEntry {
  applyMs: number;
  removeMs: number;
  spellId: string;
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

// ── Core DR computation ───────────────────────────────────────────────────────

/**
 * History of CC instances of a given DR category taken by one unit
 * (apply->removal pairing; unpaired ones are skipped -- conservative: fewer
 * instances biases toward Full). This is the single-source predicate feeding
 * getDRLevelAtTime: dispelAnalysis's drChainRisk gate and ccBreakAnalysis's
 * remaining-duration discount both consume it, and writing the pairing loop
 * twice would be a breeding ground for drift. srcUnitIds is normally the set
 * of enemy ids (count only enemy-applied CC).
 */
export function buildCcCategoryHistory(
  unit: ICombatUnit,
  category: string,
  srcUnitIds: ReadonlySet<string>,
  matchStartMs: number,
): Array<{
  atSeconds: number;
  durationSeconds: number;
  drInfo: IDRInfo | null;
}> {
  const appliesBySpell = new Map<string, number[]>();
  const removesBySpell = new Map<string, number[]>();
  for (const aura of unit.auraEvents) {
    const sid = aura.spellId;
    if (!sid || !srcUnitIds.has(aura.srcUnitId)) continue;
    if (getDRCategory(sid) !== category) continue;
    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      const b = appliesBySpell.get(sid) ?? [];
      appliesBySpell.set(sid, [...b, aura.timestamp]);
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const b = removesBySpell.get(sid) ?? [];
      removesBySpell.set(sid, [...b, aura.timestamp]);
    }
  }
  const instances: Array<{
    atSeconds: number;
    durationSeconds: number;
    drInfo: IDRInfo | null;
  }> = [];
  for (const [sid, sApplies] of appliesBySpell) {
    const sRemoves = removesBySpell.get(sid) ?? [];
    for (const ts of sApplies) {
      const removalTs = sRemoves.find((r) => r >= ts);
      if (removalTs === undefined) continue;
      instances.push({
        atSeconds: (ts - matchStartMs) / 1000,
        durationSeconds: (removalTs - ts) / 1000,
        // getDRLevelAtTime only reads drInfo.category; level/sequenceIndex
        // are placeholders.
        drInfo: { category, level: "Full", sequenceIndex: 0 },
      });
    }
  }
  instances.sort((a, b) => a.atSeconds - b.atSeconds);
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
 * CC casts whose logged CAST id is not the debuff aura the log applies for
 * it. `DR_CATEGORY_MAP` is keyed by aura id on purpose (drCategories.ts), so
 * looking one of these casts up directly lands on the `spell:<castId>`
 * self-DR fallback, and a consumer that filters the target's CC auras by that
 * key finds none — DR read Full forever (GH #111: `[PEEL OPTION]` and
 * `[CC BOOKMARK]` offered Shockwave at Full DR right after a stun).
 *
 * Measured 2026-09-25 (new-season archive, every 300th file): the CC aura the
 * same caster (or its totem) applied within 3 s of the cast — Shockwave →
 * 132168 on 316 of 355 casts, Capacitor Totem → 118905 on 258 / 319, Fear →
 * 118699 on 382 / 480 (the rest are other CCs of the same caster). Registered
 * in `curatedIdRegistry.ts`; `test/drCategoryIds.test.ts` fails when a CC id
 * with a known mechanic resolves to no DR category and is not a declared
 * self-DR spell. Infernal Awakening 22703 is NOT here: its cast and aura id
 * are the same, and drShareScan shows it shares no DR family (5d6347e3).
 */
export const CC_CAST_EFFECT_AURA: Readonly<Record<string, string>> = {
  "46968": "132168", // Shockwave → stun aura
  "192058": "118905", // Capacitor Totem → Static Charge
  "5782": "118699", // Fear → Fear debuff
  // Reliability round 2 W1g (2026-09-25): the control cooldowns the roster now
  // lists by their CAST id. Same method, every 40th file of the 08-28
  // new-season manifest; traps / Binding Shot / Ring of Frost / Sigil of Misery
  // measured over 30 s (they fire when stepped on), Snowdrift 10 s.
  "187650": "3355", // Freezing Trap → Freezing Trap (962 / 1,271)
  "109248": "117526", // Binding Shot → stun (635 / 771)
  "19577": "24394", // Intimidation → stun (543 / 579)
  "474421": "24394", // Intimidation (12.x id) → stun (231 / 262)
  "115750": "105421", // Blinding Light → disorient (462 / 488)
  "113724": "82691", // Ring of Frost → incapacitate (284 / 373)
  "207684": "207685", // Sigil of Misery → fear (119 / 174)
  "22570": "203123", // Maim → stun (446 / 476)
  "305483": "305485", // Lightning Lasso → stun (196 / 220)
  "198898": "198909", // Song of Chi-Ji → disorient (132 / 155)
  "389794": "389831", // Snowdrift → stun (41 / 54)
};

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
export function drCategoryKnown(castSpellId: string): boolean {
  const cat = drCategoryOfCast(castSpellId);
  return !cat.startsWith("spell:") || SELF_DR_SPELL_IDS.has(castSpellId);
}

/** The DR category of the CC a CAST applies — the single source for any
 * consumer that starts from a spell the player can press (a cooldown, a kit
 * entry) rather than from an aura in the log. */
export function drCategoryOfCast(castSpellId: string): string {
  return getDRCategory(CC_CAST_EFFECT_AURA[castSpellId] ?? castSpellId);
}

/**
 * Given the history of previous CC applications (same category, same target),
 * compute the DR level AND sequence index for a new application at `newApplyMs`.
 *
 * Both values are derived from the same backward-walking chain algorithm so they
 * are always mathematically consistent. Callers must NOT compute sequenceIndex
 * independently (e.g. via a flat 18s window filter) — that diverges for long chains.
 *
 * Note on 'Immune': this function can return Immune mathematically (≥3 prior in chain),
 * but in practice WoW does not create an aura event for immune casts. Callers working
 * from auraEvents will never receive an Immune result in the outgoing-CC path.
 * The type is kept for correctness in the incoming-CC path (duration already recorded).
 */
export function getDRLevel(
  history: CCEntry[],
  newApplyMs: number,
): { level: DRLevel; sequenceIndex: number } {
  let chainLength = 0;
  let checkTime = newApplyMs;
  // newApplyMs is a wall-clock epoch (callers add matchStartMs), so the era
  // is derivable from the timestamp itself — no signature change needed.
  const resetMs = drResetMsAt(newApplyMs);

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    // Only a CC applied BEFORE this one can diminish it (reliability audit
    // B3iv, 2026-09-25): the outgoing path used to feed entries in REMOVAL
    // order, so a later-applied, earlier-removed CC counted as a predecessor.
    if (entry.applyMs > newApplyMs) continue;
    if (entry.removeMs > newApplyMs) {
      // CC was still active when the new one was applied — still counts toward DR
      chainLength++;
      checkTime = entry.applyMs;
    } else if (checkTime - entry.removeMs < resetMs) {
      // Within reset window — part of the chain
      chainLength++;
      checkTime = entry.applyMs;
    } else {
      break; // DR chain reset
    }
  }

  // WoW 12.0: Full → 50% → Immune (25% tier removed)
  const level: DRLevel =
    chainLength === 0 ? "Full" : chainLength === 1 ? "50%" : "Immune";
  return { level, sequenceIndex: chainLength };
}

/**
 * Point-in-time DR query: given a unit's incoming CC history, returns the DR
 * level that the NEXT CC of `category` would land at if applied at `atSeconds`.
 *
 * Used by healer exposure analysis to know how much a CC would hurt at burst start.
 */
export function getDRLevelAtTime(
  ccInstances: ReadonlyArray<{
    atSeconds: number;
    durationSeconds: number;
    drInfo: IDRInfo | null;
  }>,
  category: string,
  atSeconds: number,
  // Wall-clock epoch of match start — selects the era's reset window
  // (16s pre-12.1, 20s from 12.1). Required so no caller silently defaults.
  matchStartMs: number,
): DRLevel {
  const DR_RESET_S = drResetMsAt(matchStartMs) / 1000;

  let chainLength = 0;
  let lastExpiredAt = -Infinity;

  for (const cc of ccInstances) {
    if (cc.drInfo?.category === category && cc.atSeconds < atSeconds) {
      if (cc.atSeconds - lastExpiredAt > DR_RESET_S) {
        chainLength = 0;
      }
      chainLength++;
      lastExpiredAt = cc.atSeconds + cc.durationSeconds;
    }
  }

  if (atSeconds - lastExpiredAt > DR_RESET_S) return "Full";
  return chainLength === 1 ? "50%" : "Immune";
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
): Array<IDRInfo | null> {
  // Per DR-category history: list of resolved {applyMs, removeMs}
  const history: Map<string, CCEntry[]> = new Map();

  return ccInstances.map((cc) => {
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
}

export interface IOutgoingCCChain {
  targetName: string;
  targetSpec: string;
  applications: IOutgoingCCApplication[];
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
        { applyMs: number; spellName: string; srcId: string; srcName: string }
      > = new Map();
      const applications: IOutgoingCCApplication[] = [];

      // Helper: close a pending CC entry and push it to applications + history
      const closePending = (key: string, removeMs: number) => {
        const p = pending.get(key);
        if (!p) return;
        pending.delete(key);

        const spellId = key.split(":")[0];
        if (!spellId) return;
        const durationSeconds = (removeMs - p.applyMs) / 1000;

        // DR is assigned below, in APPLY order, once every interval is closed.
        applications.push({
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
        });
      };

      for (const aura of enemy.auraEvents) {
        const { spellId } = aura;
        if (!spellId || !ccSpellIds.has(spellId)) continue;
        const event = aura.logLine.event;
        const isRemovalEvent =
          event === LogEvent.SPELL_AURA_REMOVED ||
          event === LogEvent.SPELL_AURA_BROKEN ||
          event === LogEvent.SPELL_AURA_BROKEN_SPELL;
        // The caster filter applies to apply/refresh only: removals
        // (especially BROKEN, where src = the breaker) must not be discarded
        // by src -- otherwise a broken CC never closes (the inflated-duration
        // fix).
        const caster = isRemovalEvent
          ? undefined
          : creditedCaster(aura.srcUnitId);
        if (!isRemovalEvent && !caster) continue;

        const key = `${spellId}:${aura.srcUnitId}`;

        if (event === LogEvent.SPELL_AURA_APPLIED) {
          pending.set(key, {
            applyMs: aura.timestamp,
            spellName: getEnglishSpellName(spellId, aura.spellName),
            srcId: caster!.id,
            srcName: friendlyIds.has(aura.srcUnitId)
              ? aura.srcUnitName
              : caster!.name,
          });
        } else if (event === LogEvent.SPELL_AURA_REFRESH) {
          // A refresh means the caster re-applied the CC while it was still active.
          // This immediately burns the next DR tier. Close the prior application and
          // open a new pending entry at the refresh timestamp.
          closePending(key, aura.timestamp);
          pending.set(key, {
            applyMs: aura.timestamp,
            spellName: getEnglishSpellName(spellId, aura.spellName),
            srcId: caster!.id,
            srcName: friendlyIds.has(aura.srcUnitId)
              ? aura.srcUnitName
              : caster!.name,
          });
        } else if (isRemovalEvent) {
          const matchKey = matchPendingCcKey(pending, spellId, key);
          if (matchKey) closePending(matchKey, aura.timestamp);
        }
      }

      // Close any still-pending CCs at match end
      for (const key of Array.from(pending.keys())) {
        closePending(key, combat.endTime);
      }

      applications.sort((a, b) => a.atSeconds - b.atSeconds);
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
        applications,
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
    const byCat = new Map<string, IOutgoingCCApplication[]>();
    for (const a of chain.applications) {
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
        if (a.drInfo.level !== "50%") continue;
        const prev = ordered[i - 1]!;
        // Chain semantics: the reset clock runs from the previous CC's END.
        if (a.atSeconds - (prev.atSeconds + prev.durationSeconds) > resetS) {
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
