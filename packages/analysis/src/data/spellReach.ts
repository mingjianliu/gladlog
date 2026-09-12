/**
 * Official per-spell reach (GENERATED json, DB2 SpellMisc.RangeIndex →
 * SpellRange.RangeMax, plus SpellEffect radius) — the one reader for
 * `spellReachGenerated.json`. Universe = ally-castable externals ∪ every
 * interrupt in `INTERRUPT_SPELL_IDS` (GH #78 / #88, 2026-09-12): a kick's
 * cast range is the feasibility gate of the kick-priority decision point and
 * had to come from SpellRange, not memory (Skull Bash 13 yd, Quell 25, Wind
 * Shear 30, Mind Freeze 15, the melee kicks share the 5 yd combat range).
 *
 * Regenerate: `DATAGEN_BUILD=<build> DATAGEN_CACHE=~/.cache/gladlog-datagen
 * npx tsx packages/analysis/scripts/datagen/genSpellReach.ts`
 * (docs/commands/update-wow-data.md).
 */
import raw from "./spellReachGenerated.json";

const SPELLS = (
  raw as unknown as {
    spells: Record<
      string,
      { rangeYards: number; reachYards: number } | undefined
    >;
  }
).spells;

/** Cast range in yards, or null when the table has no positive value for
 * the id (unknown map / unlisted spell → callers must degrade to "unknown",
 * never assume a number). */
export function spellRangeYards(spellId: string): number | null {
  const s = SPELLS[spellId];
  return s && Number.isFinite(s.rangeYards) && s.rangeYards > 0
    ? s.rangeYards
    : null;
}

/** Melee-range threshold: SpellRange's 5 yd "combat range" is the nominal
 * value; the log's position samples sit on model centres, so a melee kick
 * observed landing from 6–7 yd is normal. Whether a kick is melee decides the
 * LoS check (a ranged kick needs line of sight; a melee kick in range has it). */
export const MELEE_RANGE_YD = 5;
