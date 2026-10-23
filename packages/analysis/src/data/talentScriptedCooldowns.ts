/**
 * Talent effects on a cooldown that DB2 carries only as a dummy aura (server
 * script) and that the corpus shows the cooldown model missing — talent
 * impact audit 2026-09-26 (eval-private reports/talent-impact-audit-2026-09-26,
 * corpus-findings.md; all-ledger impossible-cast scan, new-season archive
 * every 10th file: 225,314 presses, 752 the model called impossible).
 *
 * Two shapes, both hand tables (registered in curatedIdRegistry), both keyed
 * by the TALENT so ownership is one lookup:
 *
 *  - FREE_RECAST_WINDOWS: after a press, the same spell can be pressed again
 *    within `windowS` ignoring its cooldown. The free press neither spends nor
 *    restarts the cooldown; while the window is open and unused the spell is
 *    available.
 *  - EVENT_COOLDOWN_REDUCTIONS: every successful cast of a trigger spell takes
 *    `seconds` off the remaining cooldown of the targets. The ready instant of
 *    a press is the fixed point R = press + cd − seconds × #triggers in
 *    (press, R); `remaining(t)` is monotone and reaches 0 exactly at R, so
 *    "available at t" ⇔ R ≤ t — no event after t can change the answer at t.
 *
 * Two more below, each with its own header: ON_INTERRUPT_COOLDOWN_REDUCTIONS
 * (the press's own cooldown, when it interrupts) and IDLE_COOLDOWN_CREDITS
 * (the time a spell sat ready comes off its next cooldown).
 */
import {
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { buffFullDurationForCaster } from "../utils/buffDuration";
import { type ILogDatedNumber, logDatedNumberAt } from "../utils/logEra";
import { spellEffectData } from "./spellEffectData";
import { spellSchoolMask } from "./spellSchools";

export interface IFreeRecastWindow {
  /** the spell whose press opens the window */
  spellId: string;
  windowS: number;
  note: string;
}

export const FREE_RECAST_WINDOWS: Readonly<Record<string, IFreeRecastWindow>> =
  {
    // Escape from Reality: "After you use Transcendence: Transfer, you can use
    // Transcendence: Transfer again within 10 sec, ignoring its cooldown."
    // DB2: dummy auras only (343249). Corpus: 83 presses of 119996 inside the
    // 45 s model, gaps 2.2–3.3 s; 91.6 % of monks take it.
    "394110": {
      spellId: "119996",
      windowS: 10,
      note: "Escape from Reality — Transcendence: Transfer again within 10 s",
    },
    // Save the Day (FT board item 1 follow-up, 2026-10-10): one more Leap of
    // Faith within 6 s of a press, ignoring its cooldown (the talent-coverage
    // join's tooltip row: "+1 free cast within 6s"). DB2: one dummy aura
    // (SpellEffect 1134708, aura 4, no mask — a server script).
    // Corpus, 605 new-season files, ranks from COMBATANT_INFO: 324 holder
    // rounds, 143 recast gaps, 39 inside the modelled cooldown and all of
    // them 2.0–6.0 s after the opener; 134 non-holder rounds, 21 gaps, 0
    // inside the cooldown. The press after a pair comes ≥ 64.9 s after the
    // OPENER on a 60 s cooldown — the cooldown stays anchored on it, this
    // table's shape. (Two holder gaps of 51 / 55 s stay unexplained.)
    // The row only exists on the ledger since Leap of Faith entered it for
    // every priest spec (`ENEMY_ONLY_SAVE_IDS`); before that these presses
    // were the healer gap-filler's and carried no cooldown.
    "440669": {
      spellId: "73325",
      windowS: 6,
      note: "Save the Day — Leap of Faith again within 6 s",
    },
  };

export interface IEventCooldownReduction {
  /** spells whose remaining cooldown drops */
  targets: readonly string[];
  /** the unit's own successful casts that drop it */
  triggerCastIds: readonly string[];
  /** A talent worded "each enemy hit by X": the unit's own damage rows of
   * these ids drop it too — one trigger per enemy hit (`eventTriggerTimesMs`). */
  triggerHitIds?: readonly string[];
  /** With `triggerHitIds`: at most this many hits of one use count (the
   * talent's "up to N sec" cap ÷ `seconds`). */
  maxHitsPerUse?: number;
  /** A talent worded "when X fades": the unit's own SPELL_SUMMON rows of
   * these ids drop it, `summonFadeMs` after the summon (`eventTriggerTimesMs`). */
  triggerSummonIds?: readonly string[];
  /** With `triggerSummonIds`: how long the summon lives (its DB2 duration). */
  summonFadeMs?: number;
  /** "Interrupting a spell with X": the unit's own SPELL_INTERRUPT rows of
   * these (interrupt-effect) ids. */
  triggerInterruptIds?: readonly string[];
  /** "When X is removed": an aura of these ids the unit applied ends —
   * SPELL_AURA_REMOVED or SPELL_AURA_REFRESH (a recast over a live one)
   * sourced by the unit, wherever it sits (the copy an enemy stole too). */
  triggerOwnAuraEndIds?: readonly string[];
  /** "Entering X": the unit's own buff of these ids applied on itself. */
  triggerSelfAuraAppliedIds?: readonly string[];
  /** "Being attacked": a direct hit, a miss or a debuff applied on the unit
   * by anyone else (arena has no friendly fire) — periodic ticks excluded —
   * at most one trigger per `internalCooldownMs`, none while the unit's own
   * `notWhileSelfAuraId` buff is up (`hostileTakenTriggers`). */
  triggerHostileTaken?: {
    internalCooldownMs: number;
    notWhileSelfAuraId?: string;
  };
  /** Bonuses on every give-back of this entry, added up: `pct` while the
   * unit's own `whileSelfAuraId` buff is up (Apotheosis +200 %), `pctPerRank`
   * per purchased rank of `talentId` (Light of the Naaru +10 %). */
  creditBonus?: {
    whileSelfAura?: { auraId: string; pct: number };
    perRank?: { talentId: string; pctPerRank: number };
  };
  /** "Your Arcane abilities": the unit's own successful casts whose DB2
   * school mask (`spellSchoolMask`) shares a bit with this mask. */
  triggerCastSchoolMask?: number;
  /** With `triggerHitIds`: every logged hit row is a trigger — separate
   * projectiles of one use, not "each enemy hit" (no one-credit-per-unit, no
   * cap). */
  hitsCountEachRow?: boolean;
  /** With `triggerHitIds`: "when it strikes at least N targets" — one
   * trigger per use, at the use's first hit, when the use hit this many
   * distinct units. */
  minHitsPerUse?: number;
  /** "Every N Rage you spend": each own successful cast gives back its
   * spent power ÷ `unitsPerSecond` (`powerSpendTriggers`). */
  triggerPowerSpend?: IPowerSpendTrigger;
  /** A baseline passive of these specs, owned without a talent (Restless
   * Blades, Outlaw). */
  ownedBySpecIds?: readonly string[];
  /** "Using Sudden Death": the unit's own buff of `auraIds` removed (or a
   * dose of it) within `withinMs` of its own cast of `byCastIds` — an
   * expiry or a cast without the removal is no use. With `perStackOfAuraId`
   * the use gives `seconds` × that buff's stacks just before it (none → 0). */
  triggerAuraConsumed?: {
    auraIds: readonly string[];
    byCastIds: readonly string[];
    withinMs: number;
    perStackOfAuraId?: string;
  };
  /** What one trigger gives back. Not always one number, so no reader takes
   * it from here: `eventTriggersFor` hands every trigger out with its own
   * seconds (`eventReductionSecondsAt`). `Infinity` is a RESET: the spell is
   * back at the trigger (every charge of a charge spell). */
  seconds: number | IHolderSeconds;
  note: string;
}

export interface IPowerSpendTrigger {
  /** `CombatUnitPowerType` of the spend (Rage 1, Combo Points 4, Runic
   * Power 6) */
  powerType: number;
  /** cost units (the log's own: tenths for Rage and Runic Power, whole
   * Combo Points) per second given back, by holder spec */
  unitsPerSecond: { base: number; bySpec?: Readonly<Record<string, number>> };
  /** casts that do not count, for these specs ("on attacks": Ignore Pain) */
  exclude?: { castIds: readonly string[]; specIds: readonly string[] };
  /** The log states a cast's cost BEFORE the caster's reductions; the game
   * gives back what was spent. A reduction applies to `castIds`, while the
   * caster's `whileAuraId` buff is up and / or for a holder of `talentId`
   * (holder unknown → applied: the smaller give-back). */
  costReductions?: ReadonlyArray<{
    castIds: readonly string[];
    pct?: number;
    flat?: number;
    whileAuraId?: string;
    talentId?: string;
  }>;
}

/** Seconds the game changed on a date (`ILogDatedNumber`, utils/logEra.ts —
 * read through `logDatedNumberAt`). */
export type ILogDatedSeconds = ILogDatedNumber;

/** Seconds that are not the same for every holder: `bySpec` for a holder of
 * that spec (the unit's COMBATANT_INFO spec id), `base` for everyone else. */
export interface IHolderSeconds {
  base: number;
  bySpec: Readonly<Partial<Record<string, ILogDatedSeconds>>>;
}

/**
 * Storm Conduit's Restoration hotfix: 4 s → 2 s per cast (the entry below has
 * the evidence). The day is a community source's, the hour is not known, so
 * the instant is the start of that calendar day in UTC — the way 12.1
 * go-live is a `Date.UTC` instant (`PATCH_121_GOLIVE_EPOCH_MS`), and asked
 * the same way (`logIsFrom`, utils/logEra.ts, which also says how far a log
 * timestamp can be from the true instant). The holders' files that decide
 * the two values are dated 08-13 … 08-16 and 08-18 18:54 … 08-22 in their own
 * local time, and a log from the evening of 08-17 in the Americas already
 * reads 2 s here.
 *
 * The same instant dates the talent's other number, the interrupted-cast
 * lockout (`KICK_LOCKOUT_VICTIM_MODIFIERS`, utils/kickLockout.ts), and that
 * half places the change more exactly: the old lockout is still what the log
 * shows at 2026-08-18 18:56 in an Oceanic file (UTC+10, so 08:56 UTC), the
 * new one from 2026-08-19 04:37 UTC on. The true instant is therefore at
 * least nine hours after this one, and a log of 08-18 before the hotfix went
 * live reads the NEW numbers here — the longer lockout and the smaller
 * give-back, the side on which the model claims less. Not moved: the day is
 * the ruling's wording and the hour is still not known.
 */
export const STORM_CONDUIT_HOTFIX_EPOCH_MS = Date.UTC(2026, 7, 18, 0, 0, 0);

/** Every shaman totem is Nature school (DB2 SpellMisc.SchoolMask 8 for all
 * of these at 12.1.5.69594), so Storm Conduit's "Nature totems" is every
 * totem. Stone Bulwark 108270 and Mana Tide 16191 are Nature too but have
 * zero corpus casts (observedSpellIdsGenerated) — left out, a dead id only
 * looks authoritative (Curated-List Completeness Rule). */
const SHAMAN_TOTEM_IDS = [
  "192058", // Capacitor Totem
  "108280", // Healing Tide Totem
  "98008", // Spirit Link Totem
  "204336", // Grounding Totem
  "8143", // Tremor Totem
  "2484", // Earthbind Totem
  "51485", // Earthgrab Totem
  "192077", // Wind Rush Totem
  "5394", // Healing Stream Totem
  "383013", // Poison Cleansing Totem
  "355580", // Static Field Totem
  "444995", // Surging Totem
  "1267068", // Stormstream Totem
] as const;

export const EVENT_COOLDOWN_REDUCTIONS: Readonly<
  Record<string, IEventCooldownReduction>
> = {
  // Storm Conduit (PvP, Elemental / Restoration): "Casting Lightning Bolt or
  // Chain Lightning reduces the cooldown of Astral Shift, Gust of Wind, Wind
  // Shear and your Nature totems by 1 sec." DB2 dummy 1000 ms. Corpus
  // (holders vs non-holders, shortest recast gap): Astral Shift 68.7 vs 90,
  // Healing Tide 77.9 vs 120, Spirit Link 132.6 vs 180, Capacitor 32.6 vs
  // 34.9; Lightning Lasso / Nature's Swiftness / Hex / Ascendance unchanged
  // (not named, not totems).
  //
  // RESTORATION holders get more than the tooltip's second, and the number
  // moved once — modelled BY THE DATE OF THE LOG (user ruling 2026-10-11):
  // 4 s per cast before 2026-08-18, 2 s from then on
  // (`STORM_CONDUIT_HOTFIX_EPOCH_MS`). Every other holder keeps DB2's 1 s.
  // FLAG (Game-Behaviour Rule — this is NOT three-way evidence, and stays
  // flagged in docs/talent-coverage-gaps.md §8):
  //  - DB2 has no leg for the seconds: a dummy effect of 1000 ms run by a
  //    server script, no class mask, no label, nothing per spec. What DB2
  //    does show is that the talent was changed then — its companion aura
  //    1223529 (interrupted-cast duration) went −65 → −40 between builds
  //    12.1.0.69382 and 69404.
  //  - The day and the two values are a community wiki's hotfix note
  //    (warcraft.wiki.gg/wiki/Storm_Conduit, read as a fetched summary, not
  //    the page itself): 2026-08-18, "Restoration 4 s → 2 s".
  //  - The corpus carries the numbers. 605 new-season files (fix-FT
  //    `n6_storm_conduit_fit.py` → `n6-stormConduit-fit-605.txt`): recast
  //    pairs of Healing Tide / Capacitor / Spirit Link / Astral Shift by
  //    holders, R = press + cd − s × #casts in (press, R), "early" = the
  //    next press more than 0.5 s before R. 11 files have recast pairs (78);
  //    in 9 of them (70 pairs) some pair is shorter than the unreduced
  //    cooldown, and the rest is about those. At 1 s: 28 early. Logs dated
  //    before 08-18 (4 files, 50 pairs): at 2 s 19 early, all in the two
  //    08-14 files, which need ≥ 3.56 / 4.26 s; at 4 s 1 early, by 2.4 s —
  //    unexplained. Logs dated 08-18 or later (5 files, 20 pairs): at 2 s 0
  //    early, the tightest file needs ≥ 1.95 s.
  //    The product's own predicate on five of those files
  //    (`ledgerImpossibleCastScan`, `cdAvailableAt` at each holder's recast
  //    of a target, 59 recasts): 27 pressed while the ledger said "not
  //    ready" at 1 s → 1 with the dated value; every other ledger entry in
  //    the same files 2 of 933 → 2 of 933.
  //
  // ELEMENTAL holders stay at DB2's 1 s — measured 2026-10-11 and too thin to
  // move (Game-Behaviour Rule 7: upward on corpus evidence only). The same
  // fit on every single-cooldown target, per spec and per side of the
  // cutover (fix-FT `scl_elemental_fit.ts` → `scl-elemental-fit-605.txt`):
  // the 605 files hold ONE Elemental holder — one player, three files of one
  // evening after the hotfix, 28 recast pairs, 5 of them shorter than the
  // unreduced cooldown. Four of the five fit 1 s, the press 0.4 – 1.4 s
  // after its ready instant. The fifth, a Gust of Wind 17.8 s after the last
  // on a 20 s cooldown with one Lightning Bolt in between, comes 1.2 s
  // before it: that one pair fits 2 s a cast — and equally 1 s a cast plus
  // 1 s for each of the two Lightning Bolt Overload hits that bolt made, a
  // second TRIGGER which Restoration's fit cannot speak to. No Elemental
  // holder before the hotfix. Control: 804 pairs of Elemental non-holders,
  // none shorter than the cooldown. Enhancement cannot take the talent (the
  // PvP talent pool; 0 of 113 unit-rounds in the corpus).
  // The same run on Restoration, all targets: before the cutover 281 pairs,
  // early at 2 s 52, at 4 s 3 (two Grounding Totem pairs of one file that
  // need 6.7 s a cast — some other source, not looked into — and the 2.4 s
  // Healing Tide one); since, 124 pairs, early at 1 s 2, at 2 s 0. Wind
  // Shear, Earthgrab, Grounding and Static Field are in those counts (Wind
  // Shear before: 32 pairs, early at 2 s 4, at 4 s 0).
  // Still not measured: Healing Stream / Stormstream Totem (charges, no
  // single cooldown to fit); a log older than 08-13 in the corpus — one
  // 07-27 Restoration match read outside it fits 4 s (29 pairs, early at 2 s
  // 5, at 4 s 0).
  "1217092": {
    targets: ["108271", "192063", "57994", ...SHAMAN_TOTEM_IDS],
    triggerCastIds: ["188196", "188443"],
    seconds: {
      base: 1,
      bySpec: {
        [CombatUnitSpec.Shaman_Restoration]: {
          cutoverEpochMs: STORM_CONDUIT_HOTFIX_EPOCH_MS,
          before: 4,
          since: 2,
        },
      },
    },
    note: "Storm Conduit — Lightning Bolt / Chain Lightning −1 s; Restoration −4 s before the 2026-08-18 hotfix, −2 s since (corpus + community date, FLAG)",
  },
  // Lethal Calibration (Survival, FT F20 2026-10-11): "Each enemy hit by
  // Wildfire Bomb reduces the cooldown of Boomstick by 2.0 sec, up to 10
  // sec." DB2 12.1.5.69594: SpellEffect 1272696 (aura 42, a server proc —
  // no trigger spell, no class mask) base 2000 ms, and 1285246 dummy 5 = the
  // cap in hits; the tooltip is `$s1/1000` and `$s1/1000*$s2`.
  // Corpus, 605 new-season files (ledgerImpossibleCastScan, talents from
  // COMBATANT_INFO): 4 holders, 32 Boomstick recast gaps, 19 under the
  // modelled 45 s (shortest 29.3 s) and all 10 "impossible" presses; 30
  // non-holders, 131 gaps, none under it (shortest 44.9 s). On three
  // holders' files (fix-FT `n6_event_fit.py`), R = press + 45 − 2 ×
  // #hits in (press, R): 0 of 31 recasts come before R, the tightest 0.0 /
  // 1.0 / 1.1 / 1.3 / 1.5 s after it; at 1 s per hit 9 come early, at 3 s
  // none lands within 2 s of R, and counting bomb CASTS fits no value.
  // A hit is a SPELL_DAMAGE row of the explosion (265157), or a SPELL_MISSED
  // one a shield soaked whole (ABSORB) — without those one recast is 2.0 s
  // early. IMMUNE misses are not counted (4 rows in the three files; none
  // decides a recast).
  "1262409": {
    targets: ["1261193"],
    triggerCastIds: [],
    triggerHitIds: ["265157"],
    maxHitsPerUse: 5,
    seconds: 2,
    note: "Lethal Calibration — each enemy hit by Wildfire Bomb −2 s (≤ 5 hits a bomb)",
  },
  // Cenarius' Guidance (Restoration, GH #154, 2026-10-20): "During
  // Incarnation: Tree of Life, you summon a Grove Guardian every 10 sec. The
  // cooldown of Incarnation: Tree of Life is reduced by 5.0 sec when Grove
  // Guardians fade." DB2 12.1.5.70391: 393381 dummy −5000 (no class mask, a
  // server script), 393418 the 10 s summon pulse; a Grove Guardian (102693)
  // lives 8 s. Every guardian counts — pressed, summoned by the pulse, or by
  // Reforestation's free Tree of Life. The fade is read as summon + 8 s: a
  // killed guardian may fade sooner, never later, so the model's ready
  // instant is never before the game's. 98 % of Restoration Druids take it.
  // Corpus, 2,000 new-season files (every 3rd of the 08-28 manifest), 317
  // Tree of Life recast pairs (form re-shifts dropped): the bare 180 s holds
  // for few of them; 180 − 5 × (guardians summoned in the gap) − 15 ×
  // (holds Control of the Dream, below) holds for 307, the worst miss 9.1 s.
  "393371": {
    targets: ["33891"],
    triggerCastIds: [],
    triggerSummonIds: ["102693"],
    summonFadeMs: 8000,
    seconds: 5,
    note: "Cenarius' Guidance — Incarnation: Tree of Life −5 s as each Grove Guardian fades",
  },
  // Cooldown mastery round, 2026-10-20 (eval-private runs/cd-mastery-2026-10-20
  // research/*.md — DB2 12.1.5.70391, the 2,240-file ledger scan, raw-log
  // replays). Every row below is a dummy (server script) in DB2: the value
  // is the tooltip's, the trigger the log's.
  //
  // Offering from Beyond (Farseer, Elemental): "When an Ancestor is called,
  // they reduce the cooldown of Stormkeeper by 3 sec" — dummy −3 000 on the
  // Elemental branch (`$?a137040`; Restoration's −2 s is Riptide's, not
  // Stormkeeper's). Each Ancestor is the shaman's SPELL_SUMMON 445624.
  // Holders 706 of 927 Stormkeeper recasts under the 60 s model, non-holders
  // 0 of 79; replay (2 files, 233 summons): 30 impossible → 0 at 3 s, 12 at 2.
  "443451": {
    targets: ["191634"],
    triggerCastIds: [],
    triggerSummonIds: ["445624"],
    seconds: 3,
    note: "Offering from Beyond — Stormkeeper −3 s per Ancestor called",
  },
  // Savage Momentum (PvP, Feral): "Interrupting a spell with Skull Bash
  // reduces the remaining cooldown of Tiger's Fury, Survival Instincts and
  // Dash by 10 sec" — dummy 10. The interrupt row is SPELL_INTERRUPT 93985
  // (not the cast id 106839). Survival Instincts: holders 4 of 6 recasts
  // under the model, non-holders 0 of 13; replay 1 → 0.
  "205673": {
    targets: ["61336", "5217", "1850"],
    triggerCastIds: [],
    triggerInterruptIds: ["93985"],
    seconds: 10,
    note: "Savage Momentum — Skull Bash interrupt: Tiger's Fury / Survival Instincts / Dash −10 s",
  },
  // Energy Transfer (Monk): "Successfully interrupting an enemy reduces the
  // cooldown of Paralysis and Roll by 5 sec" — dummy −5 000. Windwalker
  // holders 27 of 303 Paralysis recasts under the 30 s model (the 13
  // impossible ones 24.4–27.2 s: one interrupt each), non-holders 0 of 1,121.
  "450631": {
    targets: ["115078", "109132"],
    triggerCastIds: [],
    triggerInterruptIds: ["116705"],
    seconds: 5,
    note: "Energy Transfer — Spear Hand Strike interrupt: Paralysis / Roll −5 s",
  },
  // Lunation (Elune's Chosen, Balance): "Your Arcane abilities reduce the
  // cooldown of Fury of Elune by 1.5 sec" — dummy −1 500. "Arcane" read as
  // the cast's DB2 school having the Arcane bit (0x40; Astral 0x48 counts).
  // Holders 141 of 161 recasts under the model, non-holders 0 of 137;
  // replay (242 triggering casts): 14 impossible → 0 at 1.5 s, 8 at 1 s.
  "429539": {
    targets: ["202770"],
    triggerCastIds: [],
    triggerCastSchoolMask: 0x40,
    seconds: 1.5,
    note: "Lunation — Fury of Elune −1.5 s per Arcane-school cast",
  },
  // Spellfrost Teachings (Spellslinger, Frost): "Direct damage from Frost
  // Splinters reduces the cooldown of Frozen Orb by 0.30 sec" — dummy 300.
  // Every Frost Splinter (443722) row is a trigger — damage, or a hit a
  // shield soaked whole; separate projectiles, no per-enemy dedupe (the
  // fit needs up to 0.86 s a hit without the absorbed rows). Holders 92 %
  // of recasts under the 60 s model, shortest gap 22.0 s; replay (8 files,
  // 180 recasts): 165 early → 2 at 0.29 s → 0 at 0.30 s, every round's
  // tightest needs ≤ 0.295 s.
  "444986": {
    targets: ["84714"],
    triggerCastIds: [],
    triggerHitIds: ["443722"],
    hitsCountEachRow: true,
    seconds: 0.3,
    note: "Spellfrost Teachings — Frozen Orb −0.3 s per Frost Splinter hit",
  },
  // Rumbling Earth (Warrior): "when it strikes at least 3 targets its
  // cooldown is reduced by 15 sec" — dummies 3 and 15. A strike counts a
  // unit's SPELL_DAMAGE or whole-absorb miss of Shockwave 46968 (pets
  // count, immune misses are not needed). Arms holders' floor is exactly
  // 25.0 s (= 40 − 15), holders whose Shockwave hit fewer than 3 never
  // under 40.2; 41 of 41 reduced pairs follow a 3+ hit.
  "275339": {
    targets: ["46968"],
    triggerCastIds: [],
    triggerHitIds: ["46968"],
    minHitsPerUse: 3,
    seconds: 15,
    note: "Rumbling Earth — Shockwave −15 s when it strikes 3+ targets",
  },
  // Anger Management (Warrior): "Every 20 Rage you spend [on attacks]
  // reduces the remaining cooldown on Avatar and Colossus Smash /
  // Recklessness / Shield Wall by 1 sec" — three dummies of 20, one per spec
  // branch; Fury's carries PvpMultiplier 0.5 → 10 Rage a second in the
  // arena (at 20, 190 of 194 Fury recast pairs break; at 10, none). The log
  // states Rage ×10 and the cost before the caster's reductions; the game
  // gives back what was spent (Battlelord's Mortal Strike −33 %,
  // Efficiency's Slam −25 %, Rampaging Berserker's Rampage −15 Rage during
  // Recklessness): with the stated cost no Fury pair comes within 2.8 s of
  // ready, with the spent cost the tightest is 0.81 s, 0 violations.
  // Colossus Smash holders 76.5 % of recasts under the 45 s model,
  // non-holders 0 of 24; Arms replay 191 pairs, 0 violations, 32 within
  // 1 s. Arms / Fury: Ignore Pain is no attack.
  "152278": {
    targets: ["107574", "167105", "1719", "871"],
    triggerCastIds: [],
    triggerPowerSpend: {
      powerType: 1,
      unitsPerSecond: { base: 200, bySpec: { "72": 100 } },
      exclude: { castIds: ["190456", "1277297"], specIds: ["71", "72"] },
      costReductions: [
        { castIds: ["12294"], pct: 33, whileAuraId: "386631" },
        { castIds: ["1464"], pct: 25, talentId: "1261047" },
        {
          castIds: ["184367"],
          flat: 150,
          whileAuraId: "1719",
          talentId: "1269309",
        },
      ],
    },
    seconds: 0,
    note: "Anger Management — Rage spent: Avatar / Colossus Smash / Recklessness / Shield Wall −1 s per 20 (Fury 10 in PvP)",
  },
  // Unrelenting Onslaught (Slayer, 444780): "Using Sudden Death causes you
  // to … reduce the cooldown of Bladestorm by 5 sec … per stack of
  // Executioner you have" — dummy 5; it also replaces Bladestorm 227847
  // with 446035 (aura 332), so the 446035 row is the holders'. A use is the
  // Sudden Death buff (Arms 52437, Fury 280776) removed within 0.15 s of the
  // unit's own Execute (163201 / 281000 / 280735 / 5308); the stacks are
  // Executioner 445584's just before. Holders 1,640 of 1,712 recasts under
  // the 90 s model, non-holders (227847) 0 of 130. Arms replay: flat 5 s a
  // use breaks 107 of 130 pairs, 5 s × stacks 0 of 129 (21 within 1 s).
  // Fury's buff and Execute ids are DB2's, not replayed (61 entries).
  "444780": {
    targets: ["446035"],
    triggerCastIds: [],
    triggerAuraConsumed: {
      auraIds: ["52437", "280776"],
      byCastIds: ["163201", "281000", "280735", "5308"],
      withinMs: 150,
      perStackOfAuraId: "445584",
    },
    seconds: 5,
    note: "Unrelenting Onslaught — Bladestorm −5 s per Executioner stack when Sudden Death is used",
  },
  // Barrier Diffusion (Frost, 455428): "When Ice Barrier is removed, its
  // remaining cooldown is reduced by 5 sec" — dummy 5 000, PvpMultiplier
  // 0.5 → 2.5 s in the arena (5 s runs ahead of the game). Ice Barrier has
  // two charges: the give-back goes to the charge recharging
  // (`IChargeEffects`). Three things are a removal: the barrier fading, a
  // recast over a live one (REFRESH), and the copy an enemy Spellsteal'd
  // fading on the thief — all aura rows the mage sourced. Replay (12 files,
  // 361 recasts): static 115 early, fades only 18, + refreshes 11, + the
  // stolen copy 0; at 2 s 44. Holders 29 % of recasts under the model,
  // non-holders 0 of 188. (Blazing / Prismatic Barrier: same talent, not
  // measured, not listed.)
  "455428": {
    targets: ["11426"],
    triggerCastIds: [],
    triggerOwnAuraEndIds: ["11426"],
    seconds: 2.5,
    note: "Barrier Diffusion — Ice Barrier −2.5 s (PvP) each time a barrier is removed",
  },
  // Protector of the Frail (Discipline, 373035): "Power Word: Shield reduces
  // the cooldown of Pain Suppression by 3 sec" — effect 1, dummy −3 000 (its
  // extra charge is a masked row, already modelled). The press is Power
  // Word: Shield 17 or, upgraded by Master the Darkness, Void Shield
  // 1253593. Pain Suppression has two charges (`IChargeEffects`). Replay (3
  // files): PW:S only still 13–18 s short; with Void Shield 0 violations,
  // the tightest presses 0.1 / 0.6 s after the predicted instant.
  "373035": {
    targets: ["33206"],
    triggerCastIds: ["17", "1253593"],
    seconds: 3,
    note: "Protector of the Frail — Pain Suppression −3 s per Power Word: Shield / Void Shield",
  },
  // Driven to Madness (PvP, Shadow, 199259): "While Voidform is not active,
  // being attacked reduces the cooldown of Voidform by 3 sec" — a proc
  // (aura 42 → 199260, effect 77, −3 000) with ProcCategoryRecovery 1 000 ms
  // and a proc mask of taken melee / ranged / spell / negative magic (no
  // periodic). Voidform's buff is 194249. Holders 742 gaps, p5 55.9 s on a
  // 120 s model; non-holders 42 gaps, p5 121.1. Replay (7 files, 39 pairs):
  // damage + misses + debuffs 0 violations; damage alone 1, by 11.1 s.
  "199259": {
    targets: ["228260"],
    triggerCastIds: [],
    triggerHostileTaken: {
      internalCooldownMs: 1000,
      notWhileSelfAuraId: "194249",
    },
    seconds: 3,
    note: "Driven to Madness — Voidform −3 s per attack taken (≤ 1 a second, not during Voidform)",
  },
  // HOLY WORD: CHASTISE (Holy Priest; research/holyword.md — 21 clean raw
  // files replayed: 221 of 497 Chastise presses early → 0). Its static
  // cooldown is right only once the 12.1.0 talent map is used for 12.1.0
  // logs (`talentsOf`, utils/talents.ts: Holy Celerity / Ultimate Serenity
  // traded definitions at 12.1.5).
  // Serendipity (Holy baseline 63733): "Smite / Holy Nova reduce the
  // cooldown of Holy Word: Chastise by 4 sec" — 88625 effect 1 bp 4
  // (tooltip `$?s63733`). The replay's slack test: 3 s leaves 5 presses
  // before ready, 5 s none within 0.5 s of it, 4 s a tight pile and 0 early.
  "63733": {
    targets: ["88625"],
    triggerCastIds: ["585", "132157"],
    ownedBySpecIds: ["257"],
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Serendipity — Smite / Holy Nova: Holy Word: Chastise −4 s",
  },
  // Voice of Harmony (390994; 3,014 of 3,014 Holy rows): Holy Fire →
  // Chastise, 4 × PvpMultiplier 0.5 = 2 s (at 4 s the earliest press lands
  // 2.0 s after "ready", none tight; at 2 s, 10 within ±0.5 s of it).
  "390994": {
    targets: ["88625"],
    triggerCastIds: ["14914"],
    seconds: 2,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Voice of Harmony — Holy Fire: Holy Word: Chastise −2 s (PvP)",
  },
  // (Both carry Apotheosis's "increasing the cooldown reductions to your Holy
  // Words by 200 %" while its buff 200183 is up — +100 % leaves 125 early
  // presses, +200 % 13 — and Light of the Naaru's +10 % a rank, added to it.
  // Serenity / Sanctify's give-backs — Flash Heal / Benediction, Prayer of
  // Mending, Halo, Energy Cycle — change target with Ultimate Serenity and
  // are not modelled yet: neither spell is on the ledger.)
  // RESETS (seconds: Infinity — back at the trigger, every charge).
  //
  // Apotheosis (Holy, 200183): resets Holy Word: Chastise. Its buff can land
  // with no cast (out of Shadowmeld), so the trigger is the buff applied.
  "200183": {
    targets: ["88625"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["200183"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Apotheosis — resets Holy Word: Chastise",
  },
  //
  // Demonic Intensity (Aldrachi / Devourer, 452415): "… and casting
  // Collapsing Star resets its cooldown" (The Hunt) — dummy rows only. All 4
  // impossible Hunt recasts (44.7 / 39.0 / 41.2 / 55.2 s on 90) have a
  // Collapsing Star 1221150 cast between; 26 other gaps in 12 files are all
  // ≥ 90 s. Predator's Wake 1259431 has its own cooldown — not a target.
  "452415": {
    targets: ["1246167"],
    triggerCastIds: ["1221150"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Demonic Intensity — Collapsing Star resets The Hunt",
  },
  // Violent Transformation (Devourer branch, 452409): "Entering Void
  // Metamorphosis resets the cooldown of Voidblade and Soul Immolation" —
  // dummy only. Entering = buff 1217607 applied on the demon hunter.
  // Holders 96 of 964 Soul Immolation pairs under the model, non-holders 0
  // of 180. Replay (6 files, 161 presses): static 53 impossible, reset to
  // full charges 9, one charge 15. (Leaving Void Meta as a second reset
  // would take 9 → 6 — unproven, not modelled.)
  "452409": {
    targets: ["1241937"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["1217607"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Violent Transformation — entering Void Metamorphosis resets Soul Immolation",
  },
  // Cold Snap (Frost, 235219): resets Ice Block and Ice Barrier (and Frost
  // Nova / Cone of Cold, not ledger spells). 0.5 % of Frost hold it (the
  // choice node against Glacial Bulwark); its casts explain the 3 Ice
  // Barrier impossible presses of one file and Ice Block gaps of 46.9 /
  // 83.6 s on a 240 s model, the reset visible in the log.
  "235219": {
    targets: ["45438", "11426"],
    triggerCastIds: ["235219"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Cold Snap — resets Ice Block and Ice Barrier",
  },
  // Preparation (Outlaw, 1277933): an active talent that resets Adrenaline
  // Rush — SPELL_CAST_SUCCESS 1277933 (140 of 147 Outlaw rounds take it).
  // Replay (1 file): static 4 impossible → 1 with the reset.
  "1277933": {
    targets: ["13750"],
    triggerCastIds: ["1277933"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Preparation — resets Adrenaline Rush",
  },
  // Red Thirst (Blood): "Every 10 Runic Power spent reduces the cooldown of
  // Vampiric Blood by 2.0 sec" — s1 2 000, s2 10. Runic Power is ×10 in the
  // log (Death Strike 450 = 45). Holders 13 of 13 recasts under the model,
  // non-holders 0 of 3; replay 12 impossible → 0 at 2 s per 10.
  "205723": {
    targets: ["55233"],
    triggerCastIds: [],
    triggerPowerSpend: { powerType: 6, unitsPerSecond: { base: 50 } },
    seconds: 0,
    note: "Red Thirst — Vampiric Blood −2 s per 10 Runic Power spent",
  },
  // Restless Blades (Outlaw baseline 79096): finishers reduce "many Rogue
  // skills" by `$<cdr>` sec per combo point — dummy 10, PvpMultiplier 0.8 →
  // 0.8 s. Combo points are the finisher row's second cost (whole points).
  // Replay (384 points): at 1.0 s per point 0 impossible, at 0.8 the 7.3 s
  // a Preparation reset does not explain remain — the DB2 value is kept,
  // the smaller give-back, and the recast floor covers the rest.
  "79096": {
    targets: [
      "13750",
      "315341",
      "13877",
      "271877",
      "195457",
      "381989",
      "51690",
      "1214909",
      "2983",
    ],
    triggerCastIds: [],
    ownedBySpecIds: ["260"],
    triggerPowerSpend: { powerType: 4, unitsPerSecond: { base: 1.25 } },
    seconds: 0,
    note: "Restless Blades — Outlaw finishers: −0.8 s per combo point on Adrenaline Rush and the Outlaw kit",
  },
};

/** Hits of one use land together; rows of `triggerHitIds` further apart than
 * this are different uses (`maxHitsPerUse` and the one-credit-per-unit rule
 * count per use). The Wildfire Bomb's explosion rows sit within 0.1 s of
 * each other. Two bombs are at least a global cooldown apart when CAST
 * (0.75 s at the haste floor), but they are projectiles: the second can be
 * thrown from closer, so their IMPACTS can be nearer than the casts — a
 * window of 1 s merged two bombs landing 0.8–0.96 s apart on one enemy and,
 * with one credit per unit, dropped the second (review 40-FT-70,
 * 2026-10-11). 0.3 s is three times one explosion's spread and under the
 * closest two impacts can get (a 0.75 s cast gap less the ~0.3 s of flight
 * a unit can close in that time). */
export const EVENT_HIT_SAME_USE_MS = 300;

/**
 * When a reduction's triggers fired for `unit` (epoch ms, ascending) — the
 * ONE reading of "a trigger happened" for the ledger (`extractMajorCooldowns`),
 * the [RES] utility entries (`resUtilityCds`) and the interrupt cooldown
 * (`interruptReadyAtMs`), which all get it through `eventTriggersFor`: the
 * unit's own successful casts of `triggerCastIds`, plus, for a per-hit
 * talent, its damage rows of `triggerHitIds` (and the hits a shield soaked
 * whole, logged as an ABSORB miss), at most `maxHitsPerUse` per use; for a
 * fade talent, each of its summons of `triggerSummonIds` `summonFadeMs` after
 * the summon.
 */
export function eventTriggerTimesMs(
  unit: Pick<ICombatUnit, "spellCastEvents" | "damageOut" | "missesOut"> &
    Partial<Pick<ICombatUnit, "actionOut">>,
  r: Pick<
    IEventCooldownReduction,
    | "triggerCastIds"
    | "triggerHitIds"
    | "maxHitsPerUse"
    | "triggerSummonIds"
    | "summonFadeMs"
    | "triggerInterruptIds"
    | "triggerOwnAuraEndIds"
    | "triggerSelfAuraAppliedIds"
    | "triggerCastSchoolMask"
    | "hitsCountEachRow"
    | "minHitsPerUse"
  >,
): number[] {
  const schoolMask = r.triggerCastSchoolMask;
  const out = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        (r.triggerCastIds.includes(String(e.spellId)) ||
          (schoolMask !== undefined &&
            ((spellSchoolMask(String(e.spellId)) ?? 0) & schoolMask) !== 0)),
    )
    .map((e) => e.logLine.timestamp);
  const appliedIds = r.triggerSelfAuraAppliedIds;
  if (appliedIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        e.destUnitId === e.srcUnitId &&
        appliedIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp);
  const auraEndIds = r.triggerOwnAuraEndIds;
  if (auraEndIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        (e.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
          e.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
        auraEndIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp);
  const interruptIds = r.triggerInterruptIds;
  if (interruptIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_INTERRUPT &&
        interruptIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp);
  const summonIds = r.triggerSummonIds;
  if (summonIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_SUMMON &&
        summonIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp + (r.summonFadeMs ?? 0));
  const hitIds = r.triggerHitIds;
  if (hitIds?.length) {
    const hits = [
      ...unit.damageOut.filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_DAMAGE &&
          hitIds.includes(String(e.spellId)),
      ),
      ...(unit.missesOut ?? []).filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_MISSED &&
          e.missType === "ABSORB" &&
          hitIds.includes(String(e.spellId)),
      ),
    ]
      .map((e) => ({ t: e.logLine.timestamp, dest: e.destUnitId }))
      .sort((a, b) => a.t - b.t);
    if (r.hitsCountEachRow) {
      out.push(...hits.map((h) => h.t));
      return out.sort((a, b) => a - b);
    }
    if (r.minHitsPerUse !== undefined) {
      // one trigger per use that struck enough distinct units
      let start = Number.NEGATIVE_INFINITY;
      let units = new Set<string>();
      const flush = () => {
        if (units.size >= r.minHitsPerUse!) out.push(start);
      };
      for (const { t, dest } of hits) {
        if (t - start > EVENT_HIT_SAME_USE_MS) {
          flush();
          start = t;
          units = new Set();
        }
        if (dest) units.add(dest);
      }
      flush();
      return out.sort((a, b) => a - b);
    }
    const cap = r.maxHitsPerUse ?? Number.POSITIVE_INFINITY;
    let useStart = Number.NEGATIVE_INFINITY;
    // One use credits each unit it hits once — "per enemy hit", not per
    // logged row: a second row on the same unit inside the use (a hit and
    // the part of it a shield soaked, a re-logged hit) is the same enemy
    // (codex review 45-FT-101, 2026-10-11).
    let hitUnits = new Set<string>();
    for (const { t, dest } of hits) {
      if (t - useStart > EVENT_HIT_SAME_USE_MS) {
        useStart = t;
        hitUnits = new Set();
      }
      // a row that names no destination is not evidence of another enemy
      // (the parser allows an empty one — review 40-FT-72)
      if (!dest || hitUnits.has(dest)) continue;
      if (hitUnits.size < cap) {
        out.push(t);
        hitUnits.add(dest);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * The seconds ONE trigger of `r` gives back to a holder of spec `holderSpec`
 * when it fires at `logEpochMs` — the one reading of "how much", next to
 * `eventTriggerTimesMs`'s "when".
 *
 * The date is the trigger's own log timestamp, not the match start: the three
 * readers all hold it (the interrupt cooldown is asked with a unit and an
 * instant, no combat), so none of them can ask with a different day, and a
 * round played across the cutover gives each cast what the game gave then.
 * It is the DR gate's reading — `drResetMsAt` is asked with the timestamp of
 * the CC being applied.
 *
 * A timestamp that is not a number is not a date and takes the CURRENT value
 * (`since`), never the old one (`logDatedNumberAt`, the reading the lockout
 * half shares): the dated value is a past exception, and for
 * the one entry that has one the current number is the smaller give-back —
 * the cooldown reads "not ready" for longer, so the model claims less was in
 * hand, not more. (A real trigger always has its timestamp; a fixture's
 * small synthetic epoch is a date long before any cutover, as it is for the
 * DR gate.)
 */
export function eventReductionSecondsAt(
  r: Pick<IEventCooldownReduction, "seconds">,
  holderSpec: string | undefined,
  logEpochMs: number,
): number {
  if (typeof r.seconds === "number") return r.seconds;
  const dated =
    holderSpec === undefined ? undefined : r.seconds.bySpec[holderSpec];
  if (!dated) return r.seconds.base;
  return logDatedNumberAt(dated, logEpochMs);
}

/** One trigger of an event reduction: when it fired and what it gave back. */
export interface IEventTrigger {
  atMs: number;
  seconds: number;
}

/**
 * Every trigger of `reductions` for `unit`, ascending — what the three
 * readers walk. "When" is `eventTriggerTimesMs`, "how much" is
 * `eventReductionSecondsAt` at that same instant for the unit's spec; a
 * reader has no other way to the seconds.
 */
export function eventTriggersFor(
  unit: Pick<
    ICombatUnit,
    "spec" | "spellCastEvents" | "damageOut" | "missesOut"
  > &
    Partial<
      Pick<
        ICombatUnit,
        "actionOut" | "auraEvents" | "id" | "damageIn" | "missesIn"
      >
    >,
  reductions: readonly IEventCooldownReduction[],
  /** the holder's talents, for a power trigger's talent-gated cost
   * reductions; absent → every reduction applies */
  holds?: (talentSpellId: string) => boolean,
  /** the holder's purchased rank of a talent (`creditBonus.perRank`);
   * absent → no per-rank bonus */
  rankOf?: (talentSpellId: string) => number,
): IEventTrigger[] {
  const holderSpec = unit.spec === undefined ? undefined : String(unit.spec);
  const bonused = (
    r: IEventCooldownReduction,
    gs: IEventTrigger[],
  ): IEventTrigger[] => {
    const b = r.creditBonus;
    if (!b) return gs;
    const rankPct = b.perRank
      ? b.perRank.pctPerRank * (rankOf?.(b.perRank.talentId) ?? 0)
      : 0;
    return gs.map((g) => {
      const auraPct =
        b.whileSelfAura && selfAuraUpAt(unit, b.whileSelfAura.auraId, g.atMs)
          ? b.whileSelfAura.pct
          : 0;
      return g.seconds === Number.POSITIVE_INFINITY
        ? g
        : { ...g, seconds: g.seconds * (1 + (rankPct + auraPct) / 100) };
    });
  };
  return reductions
    .flatMap((r) =>
      bonused(r, [
        ...eventTriggerTimesMs(unit, r).map((atMs) => ({
          atMs,
          seconds: eventReductionSecondsAt(r, holderSpec, atMs),
        })),
        ...(r.triggerPowerSpend
          ? powerSpendTriggers(unit, r.triggerPowerSpend, holderSpec, holds)
          : []),
        ...(r.triggerAuraConsumed ? auraConsumedTriggers(unit, r) : []),
        ...(r.triggerHostileTaken ? hostileTakenTriggers(unit, r) : []),
      ]),
    )
    .sort((a, b) => a.atMs - b.atMs);
}

/** The triggers of a "being attacked" talent (`triggerHostileTaken`). */
export function hostileTakenTriggers(
  unit: Partial<
    Pick<ICombatUnit, "id" | "damageIn" | "missesIn" | "auraEvents">
  >,
  r: Pick<IEventCooldownReduction, "triggerHostileTaken" | "seconds">,
): IEventTrigger[] {
  const h = r.triggerHostileTaken;
  if (!h) return [];
  const per = typeof r.seconds === "number" ? r.seconds : r.seconds.base;
  const times: number[] = [];
  const other = (src: string | undefined) => !!src && src !== unit.id;
  for (const e of unit.damageIn ?? [])
    if (
      e.logLine.event !== LogEvent.SPELL_PERIODIC_DAMAGE &&
      other(e.srcUnitId)
    )
      times.push(e.logLine.timestamp);
  for (const e of unit.missesIn ?? [])
    if (
      e.logLine.event !== LogEvent.SPELL_PERIODIC_MISSED &&
      other(e.srcUnitId)
    )
      times.push(e.logLine.timestamp);
  for (const e of unit.auraEvents ?? [])
    if (
      e.auraType === "DEBUFF" &&
      e.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
      other(e.srcUnitId)
    )
      times.push(e.logLine.timestamp);
  times.sort((a, b) => a - b);
  const out: IEventTrigger[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const t of times) {
    if (t - last < h.internalCooldownMs) continue;
    if (h.notWhileSelfAuraId && selfAuraUpAt(unit, h.notWhileSelfAuraId, t))
      continue;
    last = t;
    out.push({ atMs: t, seconds: per });
  }
  return out;
}

/** Stacks of the unit's own buff `auraId` strictly before `atMs` (a gain or
 * a loss at that very instant is the use's own, not its state). */
function selfAuraStacksBefore(
  unit: Partial<Pick<ICombatUnit, "auraEvents">>,
  auraId: string,
  atMs: number,
): number {
  let stacks = 0;
  for (const e of unit.auraEvents ?? []) {
    if (String(e.spellId) !== auraId || e.logLine.timestamp >= atMs) continue;
    const ev = e.logLine.event;
    if (ev === LogEvent.SPELL_AURA_REMOVED) stacks = 0;
    else if (
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE ||
      ev === LogEvent.SPELL_AURA_REMOVED_DOSE
    )
      stacks = e.amount ?? stacks;
    else if (ev === LogEvent.SPELL_AURA_APPLIED) stacks = e.amount ?? 1;
  }
  return stacks;
}

/** The uses of a consumed-buff talent (`triggerAuraConsumed`). */
export function auraConsumedTriggers(
  unit: Pick<ICombatUnit, "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "auraEvents">>,
  r: Pick<IEventCooldownReduction, "triggerAuraConsumed" | "seconds">,
): IEventTrigger[] {
  const c = r.triggerAuraConsumed;
  if (!c) return [];
  const per = typeof r.seconds === "number" ? r.seconds : r.seconds.base;
  const casts = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        c.byCastIds.includes(String(e.spellId)),
    )
    .map((e) => e.logLine.timestamp);
  const out: IEventTrigger[] = [];
  let lastUse = Number.NEGATIVE_INFINITY;
  for (const e of unit.auraEvents ?? []) {
    const ev = e.logLine.event;
    if (
      (ev !== LogEvent.SPELL_AURA_REMOVED &&
        ev !== LogEvent.SPELL_AURA_REMOVED_DOSE) ||
      !c.auraIds.includes(String(e.spellId))
    )
      continue;
    const t = e.logLine.timestamp;
    if (!casts.some((ct) => Math.abs(ct - t) <= c.withinMs)) continue;
    if (t - lastUse <= c.withinMs) continue; // one removal row per use
    lastUse = t;
    const stacks = c.perStackOfAuraId
      ? selfAuraStacksBefore(unit, c.perStackOfAuraId, t)
      : 1;
    if (stacks > 0) out.push({ atMs: t, seconds: per * stacks });
  }
  return out;
}

/** Is the unit's own buff `auraId` up at `atMs` (a removal at that very
 * instant still counts — a cost reduction is consumed by the cast it
 * reduces)? */
/** @internal exported for test/fact4Batch6a.test.ts */
export function selfAuraUpAt(
  unit: Partial<Pick<ICombatUnit, "auraEvents" | "id">>,
  auraId: string,
  atMs: number,
): boolean {
  // up from an APPLIED / REFRESH until its REMOVED — or, only when the log
  // lost that REMOVED (none before the next application), until the aura's
  // caster-resolved official length after that row: `buildAuraIntervals`'
  // cap (codex 59-POSTHOC-11e #6 / 60-POSTHOC-08d #1: an Apotheosis with no
  // REMOVED gave Smite 12 s of Chastise reduction instead of 4). A logged
  // REMOVED is the end even past the official length (Voidform, extended,
  // ran 0:21–0:57 on a 20 s row).
  const rows = (unit.auraEvents ?? []).filter(
    (e) => String(e.spellId) === auraId,
  );
  let lastOn: number | undefined;
  let k = -1;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]!.logLine.timestamp;
    if (t > atMs) break;
    if (rows[i]!.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (t < atMs) lastOn = undefined;
    } else {
      lastOn = t;
      k = i;
    }
  }
  if (lastOn === undefined) return false;
  // its own end: the first REMOVED after it, before another APPLIED
  for (let i = k + 1; i < rows.length; i++) {
    const ev = rows[i]!.logLine.event;
    if (ev === LogEvent.SPELL_AURA_REMOVED) return true;
    if (ev === LogEvent.SPELL_AURA_APPLIED) break;
  }
  const d =
    buffFullDurationForCaster(
      auraId,
      (unit as { spellCastEvents?: unknown }).spellCastEvents !== undefined
        ? (unit as never)
        : undefined,
      lastOn,
    ) ?? spellEffectData[auraId]?.durationSeconds;
  return !(typeof d === "number" && d > 0) || atMs <= lastOn + d * 1000;
}

/**
 * The give-backs of a power-spend talent: each own successful cast that
 * states a cost of `powerType` gives back the power actually spent ÷
 * `unitsPerSecond`. A cast whose row states no cost gives nothing (unknown,
 * not free — documents stored before 2026-10-11 carry no costs at all).
 */
export function powerSpendTriggers(
  unit: Pick<ICombatUnit, "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "auraEvents" | "id">>,
  p: IPowerSpendTrigger,
  holderSpec: string | undefined,
  holds?: (talentSpellId: string) => boolean,
): IEventTrigger[] {
  const units =
    (holderSpec !== undefined
      ? p.unitsPerSecond.bySpec?.[holderSpec]
      : undefined) ?? p.unitsPerSecond.base;
  const out: IEventTrigger[] = [];
  for (const e of unit.spellCastEvents) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const id = String(e.spellId);
    if (
      p.exclude?.castIds.includes(id) &&
      holderSpec !== undefined &&
      p.exclude.specIds.includes(holderSpec)
    )
      continue;
    const stated = e.powerCosts?.find((c) => c.type === p.powerType)?.cost;
    if (!stated || stated <= 0) continue;
    let cost = stated;
    for (const red of p.costReductions ?? []) {
      if (!red.castIds.includes(id)) continue;
      if (red.talentId && holds && !holds(red.talentId)) continue;
      if (
        red.whileAuraId &&
        !selfAuraUpAt(unit, red.whileAuraId, e.logLine.timestamp)
      )
        continue;
      if (red.pct !== undefined) cost *= 1 - red.pct / 100;
      if (red.flat !== undefined) cost -= red.flat;
    }
    if (cost > 0)
      out.push({ atMs: e.logLine.timestamp, seconds: cost / units });
  }
  return out;
}

export interface IOnInterruptCooldownReduction {
  /** the interrupt (its CAST id) whose own cooldown the talent shortens */
  spellId: string;
  /** seconds off the cooldown of a press that interrupted a cast */
  seconds: number;
  note: string;
}

/**
 * A third shape (FT-T11c, 2026-10-09): the talent shortens the interrupt's
 * OWN cooldown when the press interrupts a cast — nothing happens on a press
 * that stops nothing. Keyed by the talent, hand table, registered in
 * curatedIdRegistry.
 *
 * Three-way evidence (Game-Behaviour Rule), 605 new-season files, gaps
 * between two casts of the kick by one player in one round, split by
 * COMBATANT_INFO ownership × "the first press has a SPELL_INTERRUPT of the
 * player's within LANDED_PAIR_MS" (eval-private fix-FT
 * `t11c_onInterruptScan.ts`):
 *  - Coldthirst 378848 → Mind Freeze 47528, −3 s. DB2: the talent triggers
 *    378849, effect 292 on cooldown category 88 (the interrupt category
 *    Quick Witted's aura 341 names), −3000 ms. Corpus: holders after a
 *    landed kick 245 gaps, shortest 12.0 s, 40 under 14.5 s, none under
 *    11.5 s; holders after a kick that stopped nothing 108 gaps, 3 under
 *    14.5 s; non-holders 279 gaps, none under 14.5 s.
 *  - Light of the Sun 202918 → Solar Beam 78675, −15 s. DB2: dummy aura,
 *    base points 15 (tooltip: 15 sec when it interrupts the primary
 *    target). Corpus: holders after a landed beam 30 gaps, shortest 45.1 s,
 *    17 under 59.5 s, none under 44.5 s; holders otherwise 104 gaps, 2 under
 *    59.5 s; non-holders 9 gaps, shortest 61.4 s.
 * The five short gaps after a press with no interrupt line stay unexplained.
 */
export const ON_INTERRUPT_COOLDOWN_REDUCTIONS: Readonly<
  Record<string, IOnInterruptCooldownReduction>
> = {
  "378848": {
    spellId: "47528",
    seconds: 3,
    note: "Coldthirst — Mind Freeze −3 s when it interrupts",
  },
  "202918": {
    spellId: "78675",
    seconds: 15,
    note: "Light of the Sun — Solar Beam −15 s when it interrupts",
  },
};

/** Seconds a holder's press of `spellId` (the interrupt's cast id) gets back
 * when it interrupts a cast; 0 for everyone else. */
export function onInterruptReductionFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): number {
  let seconds = 0;
  for (const [talent, r] of Object.entries(ON_INTERRUPT_COOLDOWN_REDUCTIONS))
    if (r.spellId === spellId && holds(talent)) seconds += r.seconds;
  return seconds;
}

export interface IIdleCooldownCredit {
  /** spells whose next cooldown the idle time comes off */
  targets: readonly string[];
  /** at most this many seconds a press */
  capSeconds: number;
  note: string;
}

/**
 * A fourth shape (GH #154, 2026-10-20): the time a spell sat READY before a
 * press comes off the cooldown that press starts, up to a cap. Keyed by the
 * talent, hand table, registered in curatedIdRegistry; applied by the
 * ledger's `applyEventReductions`, press by press (each press's idle time
 * starts at the previous press's ready instant, credit and event reductions
 * included).
 *
 * Control of the Dream (Keeper of the Grove, 434249): "Time elapsed while
 * your major abilities are available to be used or at maximum charges is
 * subtracted from that ability's cooldown after the next time you use it, up
 * to 15 seconds. Affects Nature's Swiftness, Incarnation: Tree of Life,
 * [Force of Nature,] [Incarnation: Chosen of Elune | Celestial Alignment,]
 * and Convoke the Spirits" (Restoration the first two, Balance the bracketed
 * ones). DB2 12.1.5.70391: one dummy aura, base points 15, no class mask —
 * a server script, invisible to the mask-keyed talent tables; the log shows
 * no buff for it either, so the idle time is the ledger's own.
 * Targets are the ids the ledger keys (Celestial Alignment 194223 and
 * Chosen of Elune 102560 also log as 383410 / 390414, which the ledger reads
 * as the same entry). A multi-charge target (two charges of Chosen of
 * Elune) gets it through the charge simulation (`IChargeEffects`, 2026-10-20):
 * the time spent at full charges comes off the recharge the next press
 * starts — holders' Chosen of Elune floors at 105 s on a 120 s recharge,
 * non-holders never under it (other.md research, 44 of 326 pairs).
 * Corpus, 2,000 new-season files (every 3rd of the 08-28 manifest),
 * Restoration, Nature's Swiftness recast gaps of players without Call of
 * Ohn'ahra, talents from COMBATANT_INFO (entry 117894): with the talent 34 %
 * come back before the modelled cooldown and none more than 15 s before it;
 * without it 0 %.
 * A round's first press gets the whole cap: the spell sat ready through the
 * preparation phase. Counted from the round's start instead, the ledger's
 * own scan (`ledgerImpossibleCastScan`, the same 2,000 files plus 240
 * downloaded ones) called 55 Balance Force of Nature presses impossible —
 * nearly all the round's second press, 30.0–31.2 s after a first one made
 * well inside 15 s of the gates, on a 45 s cooldown: 45 − 15.
 */
export const IDLE_COOLDOWN_CREDITS: Readonly<
  Record<string, IIdleCooldownCredit>
> = {
  "434249": {
    targets: ["132158", "33891", "391528", "205636", "102560", "194223"],
    capSeconds: 15,
    note: "Control of the Dream — the time a target sat ready comes off its next cooldown, ≤ 15 s",
  },
};

/** The idle-credit cap a holder of these talents has on `spellId`; 0 when
 * none applies. */
export function idleCreditCapFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): number {
  let cap = 0;
  for (const [talent, r] of Object.entries(IDLE_COOLDOWN_CREDITS))
    if (r.targets.includes(spellId) && holds(talent))
      cap = Math.max(cap, r.capSeconds);
  return cap;
}

/** The free-recast window a spell has for a holder of these talents. */
export function freeRecastWindowFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): IFreeRecastWindow | undefined {
  for (const [talent, w] of Object.entries(FREE_RECAST_WINDOWS))
    if (w.spellId === spellId && holds(talent)) return w;
  return undefined;
}

/** Event reductions on `spellId` for a holder, flattened. */
export function eventReductionsFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
  /** the unit's spec, for a baseline passive (`ownedBySpecIds`) */
  specId?: string,
): IEventCooldownReduction[] {
  return Object.entries(EVENT_COOLDOWN_REDUCTIONS)
    .filter(
      ([talent, r]) =>
        r.targets.includes(spellId) &&
        (holds(talent) ||
          (specId !== undefined && !!r.ownedBySpecIds?.includes(specId))),
    )
    .map(([, r]) => r);
}

/**
 * The effective cooldown of ONE press under event reductions: R − press,
 * where R is the fixed point described above. `triggers` are the holder's
 * (`eventTriggersFor`) on the press's clock — match seconds, any order —
 * each with the seconds it gave back.
 */
export function eventReducedCooldownSeconds(
  pressSeconds: number,
  cooldownSeconds: number,
  triggers: ReadonlyArray<{ atSeconds: number; seconds: number }>,
): number {
  if (!triggers.length || !(cooldownSeconds > 0)) return cooldownSeconds;
  // a trigger in the press's own instant counts (codex 59-POSTHOC-11e #7 /
  // 60-POSTHOC-08d #2, 5b724629 r2: a Shockwave's six hits in its own ms —
  // Rumbling Earth — were dropped, and the ledger kept 40 s instead of 25)
  const events = triggers
    .filter((g) => g.atSeconds >= pressSeconds)
    .sort((a, b) => a.atSeconds - b.atSeconds);
  // walk forward: each trigger before the (current) ready instant pulls it in
  let ready = pressSeconds + cooldownSeconds;
  for (const e of events) {
    if (e.atSeconds >= ready) break;
    ready = Math.max(e.atSeconds, ready - e.seconds);
  }
  return ready - pressSeconds;
}
