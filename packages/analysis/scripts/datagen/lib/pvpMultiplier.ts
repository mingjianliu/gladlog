/**
 * `SpellEffect.PvpMultiplier` — the "in PvP combat" scale on an effect's base
 * points (and coefficients). The value that reaches an arena is
 * `EffectBasePointsF × PvpMultiplier`, not `EffectBasePointsF`; 3,607 spells
 * carry a multiplier ≠ 1 at 12.1.0.69404. Cross-checks that pin the semantics:
 * Mortal Wounds 115804 −50 × 0.5 = −25 % healing received (the well-known PvP
 * number), Lay on Hands 633 100 × 0.75 = 75 %, Oppressing Roar 372048 50 × 0.6
 * = +30 % CC duration (already hand-applied in spellEffectData.ts on
 * 2026-09-02).
 *
 * Until 2026-09-04 every generator read the bare base points, so the product
 * rendered PvE percentages in an arena coach: Divine Protection 20 (PvP 35),
 * Ardent Defender 30 (45), Survival of the Fittest 30 (25), Roar of Sacrifice
 * 15 (25), Anti-Magic Zone 15 (30), Power Word: Barrier 20 (40). User ruling
 * 2026-09-04 (BACKLOG #41): the PvP value IS the official value. Every
 * generator that turns `EffectBasePointsF` into a number must go through this
 * one helper, and must list `PVP_MULTIPLIER_COLUMN` in its `assertColumns`.
 */
export const PVP_MULTIPLIER_COLUMN = "PvpMultiplier";

/** Parsed multiplier; a blank / missing column reads as 1 (PvE = PvP). */
export function pvpMultiplierOf(row: Record<string, string>): number {
  const raw = row[PVP_MULTIPLIER_COLUMN];
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

/**
 * `EffectBasePointsF × PvpMultiplier`, rounded to 3 decimals so float noise in
 * the CSV (0.83333301544) cannot leak into generated tables or `via` strings
 * (−30 × 0.833333 → −25, not −24.99990463).
 */
export function pvpBasePoints(row: Record<string, string>): number {
  const v = Number(row.EffectBasePointsF) * pvpMultiplierOf(row);
  return Math.round(v * 1000) / 1000;
}
