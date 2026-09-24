import talentModifiersJson from "../data/talentModifiers.json";

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
}

export const CD_TALENT_MODIFIERS: Record<string, ICDModifier[]> =
  talentModifiersJson as Record<string, ICDModifier[]>;

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
  "382424", // Winter's Protection
  "1270900", // Eternal Hunt
]);
