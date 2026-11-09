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
  /** % of base mana (`BASE_MANA`) per cast. */
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
 * Base mana: what a DB2 percentage cost is a share of — not the caster's
 * current max (GH #129, user ruling Q3; ticket T17). Measured on the 584
 * downloaded 12.1.5 logs: every own percentage-priced cast row states
 * `pct × 250,000` (401,548 of 401,548) while the caster's max differs from
 * it on 230,952 of them. Against the mana each press actually took (the next
 * reading's drop, regen added back), `pct × 250,000` is within tolerance on
 * 284,775 of 352,476 measurable presses and `pct × max` on 176,297; on the
 * raised-max casters alone 163,674 vs 55,196 of 205,283. A cost reduction
 * applies to this base too (16,872 reduced presses: the deduction sits on a
 * 5 % step of `pct × 250,000` on 13,687, of `pct × max` on 7,254), and it is
 * not in this number.
 */
export const BASE_MANA = 250_000;

/**
 * A percentage row's cost in whole mana, as the game charges it: the share
 * of `BASE_MANA` taken in float32 (DB2 stores the percentage as one), then
 * rounded half to even. That reproduces every stated cost of the 401,548
 * percentage-priced cast rows; a plain round misses Holy Word: Sanctify
 * 34861 (3.325 % → 8,312.5 → the log states 8,312, 362 rows) and a floor
 * misses 136,834 rows (0.9 % is 0.89999997616 in float32) — codex
 * 85-tk-E-T17-1 #2.
 */
export function pctManaCost(pct: number): number {
  const x = Math.fround(Math.fround(pct) * (BASE_MANA / 100));
  const r = Math.round(x);
  // Math.round takes .5 up; the game takes it to the even neighbour
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * Resolves the mana cost of one cast, in absolute mana, given the caster's
 * casting spec (`CombatUnitSpec` id, needed to disambiguate a
 * spec-conditional row); a `pct` row is that share of `BASE_MANA`.
 * Resolution order: an exact `bySpec[specId]` row
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
): number | null {
  const raw = manaCostRowFor(spellId, specId);
  if (!raw) return null;
  if (raw.pct !== undefined) return pctManaCost(raw.pct);
  if (raw.flat !== undefined) return raw.flat;
  return null;
}

/** The row `manaCostForCast` resolves for this caster — the exact
 * `bySpec[specId]` row first, else the spell's own unconditional one;
 * `undefined` when neither exists. For a reader that has to know WHICH
 * encoding it got (`resourceAt.ts`: only a percentage row is converted with a
 * mana figure). */
function manaCostRowFor(
  spellId: string,
  specId: string,
): ISpellManaCostRaw | undefined {
  const row = SPELL_MANA_COST_TABLE[spellId];
  if (!row) return undefined;
  return (
    row.bySpec?.[specId] ??
    (row.pct !== undefined || row.flat !== undefined ? row : undefined)
  );
}

/** Is this caster's cost for the spell a PERCENTAGE row (a share of base
 * mana), as opposed to a flat one or none? */
export function manaCostIsPercentage(spellId: string, specId: string): boolean {
  return manaCostRowFor(spellId, specId)?.pct !== undefined;
}
