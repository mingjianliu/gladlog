import talentModifiersJson from "../data/talentModifiers.json";
import { type ILogDatedNumber } from "./logEra";

/**
 * Mapping of base spell IDs to talent-driven modifications, organized by class.
 *
 * This allows the parser to accurately construct cooldown availability and charge counts
 * by combining raw spell data with the player's talent string.
 */

export interface ICDModifier {
  talentSpellId: string;
  // `reduce_cd` is a flat-seconds subtraction; `reduce_cd_pct` is a percentage
  // multiplier (`value: 30` means -30%, applied as `base *= (1 - 30/100)`) —
  // see the sibling type in scripts/datagen/genTalentModifiers.ts for the
  // full derivation. Kept in sync manually (no shared import: one is the
  // generator's own type, this is the runtime consumer's).
  effect: "extra_charge" | "reduce_cd" | "reduce_cd_pct" | "replace_spell";
  value: number;
  isConditional?: boolean;
  /** DB2 SpellEffect.ID the generator read this from (identity for dedup;
   * not read at runtime). */
  sourceRowId?: string;
  /** The source is a spec passive (DB2 SpecializationSpells), not a talent:
   * every player of these specs owns it (GH #106 — e.g. the "Holy Paladin"
   * aura 1258016, Divine Toll −15 s). */
  specIds?: string[];
  /** A talent row its tooltip gives to these specs only (`$?cN[…$sK…]`,
   * scripts/datagen/lib/tooltipSpecGates.ts): a holder of another spec —
   * or of an unknown one — does not get it. */
  onlySpecIds?: string[];
}

export const CD_TALENT_MODIFIERS: Record<string, ICDModifier[]> =
  talentModifiersJson as Record<string, ICDModifier[]>;

/**
 * Does a player of `specId` own a spec-passive modifier (`specIds` set)? The
 * one predicate for spec membership, read by the cooldown model
 * (`applyCdModifiers`) and the reach table (`spellRange.ts` `holds`) — GH
 * #120 (codex astra: the two had grown their own copies).
 */
export function specPassiveOwned(
  specIds: readonly string[],
  specId: string | undefined,
): boolean {
  return specId !== undefined && specIds.includes(specId);
}

/**
 * Multi-rank talents whose cooldown row is PER RANK: the arena reduction is
 * `value × rank` (rank read from COMBATANT_INFO), not `value` once.
 *
 * DB2 does not say which reading a row uses — Game-Behaviour Rule 4 — so an
 * id enters only on a corpus rank split (GH #106, 2026-09-24,
 * `zzRankScan` over the S2 archive every 20th file, 2-rank holders' recast
 * gap minus the value-once model; a per-rank talent leaves the holders one
 * extra `value` early, a total one leaves them at the model):
 *   · Improved Fade 390670 (Fade −5/rank): floors 19.9 s at rank 2 (2,308
 *     gaps), 25.2 s at rank 1, 30.1 s without it — 30 − 5 × rank;
 *   · Natural Mending 270581 (Exhilaration −30/rank): rank 2 floor 60.0 s
 *     (309 gaps, BM / MM / SV alike), rank 1 floor 90.0 s;
 *   · Winter's Protection 382424 (Ice Block −30/rank), read on Arcane / Fire
 *     only (Frost's Cold Snap resets Ice Block and would fake an early
 *     floor): Arcane rank 2 recasts at 180.1 s = 240 − 2 × 30; Fire rank 2 +
 *     1265517 at 150.0 / 164.9 / 170.4 / 173.7 / 176.9 s, five gaps under the
 *     value-once 180 s and none under the per-rank 150 s (every 10th file);
 *   · Eternal Hunt 1270900 (The Hunt −15/rank): every holder in the corpus is
 *     rank 2 and The Hunt's floor is 60 s = 90 − 2 × 15. This is the source of
 *     the 15 s that BACKLOG #45 could not find in DB2 and patched by hand.
 * Read the other way, the same split shows Ancient Arts 344359 is a total (774
 * Paralysis gaps at the model), so a rank flag is never a default.
 *
 * Read a floor from the minimum, never from a thin sample's shape: every
 * 30th file showed five Fire Ice Block gaps all 30 s PAST the per-rank model
 * and nearly reversed this entry; every 10th file holds the exact 150.0.
 * Late presses only ever lengthen a gap.
 */
export const PER_RANK_COOLDOWN_TALENTS: ReadonlySet<string> = new Set([
  "390670", // Improved Fade
  "270581", // Natural Mending
  // Improved Feign Death 1258486 (−5 s per rank). Cooldown mastery round,
  // 2026-10-20 — DB2: aura 107, misc 11, −5 000 ms, the class mask covers
  // Feign Death 5384; the node has 2 ranks. Corpus, 2,240 files
  // (ledgerImpossibleCastScan): every holder is rank 2 (2,105 / 2,105), the
  // value-once 25 s left 1,086 of 4,090 recasts under it, and the floor is
  // sharp at 20.1–20.2 s on all three specs (0 gaps under 20.0 = 30 − 2 × 5;
  // 79 between 19.9 and 20.5). Non-holders 0 of 66 under 30.
  "1258486",
  "382424", // Winter's Protection
  "1270900", // Eternal Hunt
  // Master of Time (Alter Time −5/rank). Talent impact audit 2026-09-26,
  // new-season archive every 10th file (ledgerImpossibleCastScan ranks2),
  // Alter Time floors: rank 0 62.4 s, rank 1 + Time Twist 45.0, rank 2 50.0
  // (160 units, 50.0 × 3 at the bottom), rank 2 + Time Twist 40.3 = 60 −
  // 5 × rank − 10. Value-once modelled rank 2 at 55 / 45: 266 impossible
  // casts, the most of any ledger spell.
  "342249",
  // Static Charge (Capacitor Totem) — 10 s per rank, see RULED_COOLDOWN_VALUES.
  "265046",
  // Savagery (Takedown −15/rank). FT board item 1b, 2026-10-10 — Takedown
  // reached the ledger with the offensive gap rows and its recasts sat at
  // ×0.80 of the value-once model. DB2: SpellEffect 1256590, aura 107
  // (cooldown, misc 11), −15 000 ms, the class mask covers Takedown 1250646;
  // the node has 2 ranks. Corpus, 605 new-season files, ranks from
  // COMBATANT_INFO (ledgerImpossibleCastScan ranks2): 93 of 94 Survival
  // rounds hold rank 2 — 67 of their 78 recasting rounds have a gap under
  // the value-once 75 s, shortest 60.0 s = 90 − 2 × 15; the one rank-1 round
  // recasts at ≥ 74 s. Every-3rd-file floor pass: 927 of 1,129 recast ratios
  // under ×0.99 of 75 s, bunched at ×0.80–0.83.
  "1251790",
  // Born To Be Wild (Aspect of the Turtle / Cheetah / Eagle −15/rank). FT
  // F20, 2026-10-11 — 8 of the 605-file scan's "impossible" presses were
  // Turtles of rank-2 holders. DB2: SpellEffect 713188, aura 107 (cooldown,
  // misc 11), −15 000 ms, the class mask covers 186265 / 186257 / 186258 /
  // 356781 / 186289; the node has 2 ranks. Corpus, Aspect of the Turtle
  // recast gaps on the 1,814-file ledgerImpossibleCastScan of 2026-09-27,
  // ranks from COMBATANT_INFO (ranks2), every unit also holding Improved
  // Aspect of the Turtle (−30): no rank (150 s) 194 units, 9 gaps, shortest
  // 150.2; rank 1 (135 s) 40 units, 2 gaps, 140.5 and 278.2; rank 2 158
  // units, 27 gaps, 13 under the value-once 135 s and 25 at or over the
  // per-rank 120 s = 180 − 30 − 2 × 15, three of them at 120.2 / 120.5 /
  // 120.5. FLAG, not explained: the two rank-2 gaps under 120 s (101.9 and
  // 107.4 s) are both Marksmanship. Cheetah and Eagle are outside the
  // ledger, so their recasts were not measured — the row and its rank scale
  // them as the game does every target of one effect.
  "266921",
]);

/**
 * User-ruled per-rank values that replace the DB2 row's number (the row says
 * one thing, the game does another). Read by `applyCdModifiers` before the
 * rank scaling; every id here is also in PER_RANK_COOLDOWN_TALENTS.
 */
export const RULED_COOLDOWN_VALUES: Readonly<
  Record<string, { secondsPerRank: number; note: string }>
> = {
  // Static Charge 265046: DB2 row 708963 is −15 000 ms once. User ruling
  // 2026-09-26: first 「静电充能是5秒一级」, revised the same day to 10 s per
  // rank on the corpus split (「嗯 改成10」): Capacitor Totem shortest recast,
  // Enhancement with Totemic Surge (−5), new-season archive every 10th file,
  // ranks from COMBATANT_INFO — rank 0 55.0 s (286 gaps), rank 1 45.0 s (60),
  // rank 2 35.0 s (36); Restoration rank 2 35.0 s (251). At 5 s per rank the
  // impossible-cast count on the totem rose 101 → 231.
  "265046": {
    secondsPerRank: 10,
    note: "Static Charge — user ruling 2026-09-26: 10 s per rank",
  },
};

/**
 * Call of Ohn'ahra's hotfix: Nature's Swiftness +30 s → +60 s. The day is the
 * hotfix note's (2026-09-22: "increases the cooldown of Nature's Swiftness
 * by 60 sec (was 30 sec)"), the hour is not known, so the instant is the
 * start of that day in UTC, the way `STORM_CONDUIT_HOTFIX_EPOCH_MS` is.
 */
export const CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS = Date.UTC(2026, 8, 22, 0, 0, 0);

/**
 * DB2 `reduce_cd` values the game changed on a date — the row carries only
 * today's number, a log from before the change has the old one. Read by
 * `applyCdModifiers` (asked with the owner's `logEpochMs`, through
 * `logDatedNumberAt`: no date → today's number). `since` must equal the
 * generated row's value (test/talentScriptedCooldowns.test.ts).
 */
export const DATED_COOLDOWN_VALUES: Readonly<
  Record<string, { value: ILogDatedNumber; note: string }>
> = {
  // Call of Ohn'ahra 1246126 (PvP, Restoration Druid) on Nature's Swiftness
  // 132158, row 1247559: −30 000 ms at 12.1.0.69587, −60 000 ms at
  // 12.1.5.70391 (scripts/datagen/customTalentModifiers.ts has the history).
  // Corpus, GH #154 (2026-10-20), Restoration holders without Control of the
  // Dream, Nature's Swiftness recast gaps: logs of 08-13 … 09-05 (2,000
  // new-season files) 123 gaps, 87 under the +60 s model's 105 s, the
  // shortest 75.7 s (= 60 − 15 Passing Seasons + 30); logs of 10-06 … 10-16
  // (240 downloaded files) 8 gaps, the shortest 123.8 s.
  "1246126": {
    value: {
      cutoverEpochMs: CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS,
      before: -30,
      since: -60,
    },
    note: "Call of Ohn'ahra — Nature's Swiftness +30 s before the 2026-09-22 hotfix, +60 s since",
  },
};
