/**
 * Per-spell mana cost lookup (BACKLOG #26 Task 4, raw-streams plan):
 * generation layer for `mana-efficiency`'s aggregate builder
 * (candidateFindings.ts's `manaEfficiencyEvents`). Generator:
 * `packages/analysis/scripts/datagen/genSpellManaCost.ts` — see that file's
 * module header for the DB2 `SpellPower` column semantics and the
 * spec-conditional-cost derivation (Flash Heal-style spells whose cost
 * differs by casting spec).
 */
import generated from "./spellManaCostGenerated.json";

interface ISpellManaCostRaw {
  /** % of the caster's base max mana per cast. */
  pct?: number;
  /** Flat absolute mana cost — mutually exclusive with `pct` in every
   * observed row so far. */
  flat?: number;
}

interface ISpellManaCostRow extends ISpellManaCostRaw {
  /** Present when this spell's cost differs by casting spec — keyed by
   * `CombatUnitSpec` id (packages/parser-compat/src/enumsGenerated.ts). */
  bySpec?: Record<string, ISpellManaCostRaw>;
}

const gen = (
  generated as unknown as { entries: Record<string, ISpellManaCostRow> }
).entries;

export const SPELL_MANA_COST_TABLE: Record<string, ISpellManaCostRow> = gen;

/**
 * Resolves the mana cost of one cast, in absolute mana, given the caster's
 * own `manaMax` (needed to convert a `pct` row to an absolute amount) and
 * casting spec (`CombatUnitSpec` id, needed to disambiguate a
 * spec-conditional row). Resolution order: an exact `bySpec[specId]` row
 * first (a spell WITH spec-conditional rows has no reliable spec-agnostic
 * fallback — see the generator's module header), else the row's own
 * unconditional `pct`/`flat`. Returns `null` when neither resolves — the
 * spell is unknown to the generated table, or has spec-conditional rows but
 * none matching this caster's spec (an off-spec use of a shared-class-pool
 * spell the generation layer never anchored) — callers must skip the spell
 * rather than guess (CLAUDE.md 修复给前后数字 / anchor-list discipline:
 * a wrong guess here silently corrupts the mana-efficiency aggregate).
 */
export function manaCostForCast(
  spellId: string,
  specId: string,
  manaMax: number,
): number | null {
  const row = SPELL_MANA_COST_TABLE[spellId];
  if (!row) return null;
  const raw =
    row.bySpec?.[specId] ??
    (row.pct !== undefined || row.flat !== undefined ? row : undefined);
  if (!raw) return null;
  if (raw.pct !== undefined) return (raw.pct / 100) * manaMax;
  if (raw.flat !== undefined) return raw.flat;
  return null;
}
