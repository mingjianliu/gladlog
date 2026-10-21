/**
 * The points a talent's effect really has: per purchased rank, and per spec
 * where a spec passive rewrites them (cooldown mastery round, 2026-10-20).
 *
 * SpellEffect.EffectBasePointsF is one number. Two other DB2 tables change
 * it, and neither was read anywhere before this:
 *
 *  - TraitDefinitionEffectPoints (TraitDefinitionID, EffectIndex,
 *    OperationType, CurveID) → CurvePoint (Pos_0 = rank, Pos_1 = value).
 *    Operation 0 SETS the effect's points to the curve's value at the held
 *    rank, 1 MULTIPLIES the base by it (most such curves are 1 → 1, 2 → 2:
 *    "per rank"), −1 is left alone (7 rows, none a cooldown). Call of the
 *    Righteous 1241511 (definition 107577) effect 2, Avenging Crusader's
 *    cooldown: base −30 000, curve −7 500 / −15 000 — Holy's corpus floors are
 *    52.5 s at rank 1 and 45.0 s at rank 2 of a 60 s spell, exactly.
 *  - A spec passive (SpecializationSpells) with aura 219 (flat) / 218 (pct)
 *    whose MiscValue0 is a PointsIndex SpellMod op rewrites effect N of every
 *    spell carrying label MiscValue1. Holy Paladin's 1258016 effect 22: +45 000
 *    on label 2651 = {Sacrifice of the Just 384820} → −60 + 45 = −15 s for
 *    Holy, the 105 s floor of 581 Holy recasts of Blessing of Sacrifice.
 *
 * Both return raw points (the SpellEffect unit, before PvP scaling); the
 * cooldown compiler converts them the way it converts the base.
 */

/** SpellModOp PointsIndex0..4 → effect index (TrinityCore SpellModOp). */
export const POINTS_INDEX_OPS: Readonly<Record<number, number>> = {
  3: 0,
  12: 1,
  23: 2,
  32: 3,
  33: 4,
};

const AURA_ADD_PCT_MODIFIER_BY_LABEL = 218;
const AURA_ADD_FLAT_MODIFIER_BY_LABEL = 219;

function toInt(v: string | undefined): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}
function toNum(v: string | undefined): number {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** Piecewise-linear value of a curve at x, clamped to its ends. */
export function curveValueAt(
  points: ReadonlyArray<{ x: number; y: number }>,
  x: number,
): number | undefined {
  if (!points.length) return undefined;
  if (x <= points[0]!.x) return points[0]!.y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b.x)
      return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return points[points.length - 1]!.y;
}

export interface ITalentDefinition {
  definitionId: string;
  maxRanks: number;
}

/**
 * (talent spell id, effect index, base points) → the points at ranks
 * 1..maxRanks, or undefined when no curve covers that effect.
 */
export function rankPointsResolver(
  tdepRows: ReadonlyArray<Record<string, string>>,
  curvePointRows: ReadonlyArray<Record<string, string>>,
  definitionOf: ReadonlyMap<string, ITalentDefinition>,
): (
  talentSpellId: string,
  effectIndex: number,
  basePoints: number,
) => number[] | undefined {
  const curves = new Map<
    string,
    Array<{ order: number; x: number; y: number }>
  >();
  for (const r of curvePointRows) {
    const l = curves.get(r.CurveID ?? "") ?? [];
    l.push({
      order: toInt(r.OrderIndex),
      x: toNum(r.Pos_0),
      y: toNum(r.Pos_1),
    });
    curves.set(r.CurveID ?? "", l);
  }
  for (const l of curves.values()) l.sort((a, b) => a.order - b.order);
  const byKey = new Map<string, { op: number; curve: string }>();
  for (const r of tdepRows)
    byKey.set(`${r.TraitDefinitionID}:${toInt(r.EffectIndex)}`, {
      op: toInt(r.OperationType),
      curve: r.CurveID ?? "",
    });
  return (talentSpellId, effectIndex, basePoints) => {
    const def = definitionOf.get(talentSpellId);
    if (!def) return undefined;
    const t = byKey.get(`${def.definitionId}:${effectIndex}`);
    if (!t || (t.op !== 0 && t.op !== 1)) return undefined;
    const pts = curves.get(t.curve);
    if (!pts?.length) return undefined;
    const out: number[] = [];
    for (let rank = 1; rank <= Math.max(1, def.maxRanks); rank++) {
      const y = curveValueAt(pts, rank);
      if (y === undefined) return undefined;
      out.push(t.op === 0 ? y : basePoints * y);
    }
    return out;
  };
}

export interface ISpecPointsAdjust {
  specIds: string[];
  kind: "flat" | "pct";
  /** raw points of the adjusting row, PvP-scaled by its own multiplier */
  points: number;
  /** the spec passive's row, for the record */
  sourceRowId: string;
}

/**
 * (talent spell id, effect index) → the spec passives' rewrites of it.
 */
export function specPointsAdjusts(
  spellEffectRows: ReadonlyArray<Record<string, string>>,
  spellLabelRows: ReadonlyArray<Record<string, string>>,
  specSpells: ReadonlyMap<string, readonly number[]>,
): Map<string, ISpecPointsAdjust[]> {
  const spellsOfLabel = new Map<number, string[]>();
  for (const r of spellLabelRows) {
    const l = spellsOfLabel.get(toInt(r.LabelID)) ?? [];
    l.push(r.SpellID ?? "");
    spellsOfLabel.set(toInt(r.LabelID), l);
  }
  const out = new Map<string, ISpecPointsAdjust[]>();
  for (const r of spellEffectRows) {
    const aura = toInt(r.EffectAura);
    if (
      aura !== AURA_ADD_FLAT_MODIFIER_BY_LABEL &&
      aura !== AURA_ADD_PCT_MODIFIER_BY_LABEL
    )
      continue;
    const specs = specSpells.get(r.SpellID ?? "");
    if (!specs?.length) continue;
    const effectIndex = POINTS_INDEX_OPS[toInt(r.EffectMiscValue_0)];
    if (effectIndex === undefined) continue;
    const pvp = r.PvpMultiplier === undefined ? 1 : toNum(r.PvpMultiplier);
    for (const talent of spellsOfLabel.get(toInt(r.EffectMiscValue_1)) ?? []) {
      const key = `${talent}:${effectIndex}`;
      const l = out.get(key) ?? [];
      l.push({
        specIds: specs.map(String),
        kind: aura === AURA_ADD_FLAT_MODIFIER_BY_LABEL ? "flat" : "pct",
        points: toNum(r.EffectBasePointsF) * (pvp || 1),
        sourceRowId: r.ID ?? "",
      });
      out.set(key, l);
    }
  }
  return out;
}

/** Apply a spec's rewrites to raw points: flat ones add, pct ones scale. */
export function adjustPoints(
  points: number,
  adjusts: readonly ISpecPointsAdjust[],
): number {
  let p = points;
  for (const a of adjusts) if (a.kind === "flat") p += a.points;
  for (const a of adjusts) if (a.kind === "pct") p *= 1 + a.points / 100;
  return p;
}
