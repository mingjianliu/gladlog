import type { ReportSource } from "./types";

type Unit = ReportSource["units"][string];

/**
 * Flow metrics for the 战报 curve (the four the dropdown adds next to 血量).
 * HP is a *level* and is drawn as a curve (derive/timeline.ts); these four are
 * *flows* and are drawn as per-second stacked bars.
 */
export type FlowMetric = "damage" | "healing" | "taken" | "healed";
/** What the curve is showing: the HP ratio, or one of the flow metrics. */
export type CurveMetric = "hp" | FlowMetric;

export const CURVE_METRIC_ORDER: CurveMetric[] = [
  "hp",
  "damage",
  "healing",
  "taken",
  "healed",
];
export const CURVE_METRIC_LABEL: Record<CurveMetric, string> = {
  hp: "血量",
  damage: "伤害",
  healing: "治疗",
  taken: "承伤",
  healed: "被治疗",
};

/**
 * The event bases a metric is made of. Each basis names one "which events
 * count, at what amount, for whom" rule — see forEachContribution, the single
 * source both the meters leaderboard (derive/summary.ts) and these bars go
 * through.
 *
 * 谓词单源 note: for the three metrics that are also leaderboard modes, this
 * composition must equal meterRows.meterValue for the same mode — i.e. 治疗
 * counts absorbs, exactly as the leaderboard bar does. meterValue consumes
 * totals rather than events, so the composition cannot be a shared expression;
 * the equality is asserted instead (test/report.flowseries.test.ts), per the
 * CLAUDE.md fallback for "分析断言 X、门规验证 X" pairs.
 */
export type FlowBasis =
  | "damageDone"
  | "healingDone"
  | "absorbsDone"
  | "damageTaken"
  | "healingTaken"
  | "absorbsTaken";

export const METRIC_BASES: Record<FlowMetric, FlowBasis[]> = {
  damage: ["damageDone"],
  healing: ["healingDone", "absorbsDone"],
  taken: ["damageTaken"],
  healed: ["healingTaken", "absorbsTaken"],
};

/** Trimmed docs (the anonymized fixture, slimmed library entries) drop whole
 * event arrays rather than emptying them, and a bare for-of over a missing
 * array throws — which an outer try/catch then swallows into a silently blank
 * panel. Every read goes through here. */
const arr = <T>(v: T[] | undefined): T[] => v ?? [];

/** Pets are attributed to their owner — the same rule the leaderboard uses, so
 * both consumers agree on whose damage a warlock's felhunter is. */
export const petsOf = <T extends { ownerId?: string | null }>(
  units: T[],
  unitId: string,
): T[] => units.filter((p) => p.ownerId === unitId);

/**
 * Single source for "which events count toward `basis` for `unit`, and at what
 * amount". Consumers: deriveSummary (the leaderboard totals) and
 * deriveFlowSeries (the per-second bars) — so a bar's integral over the match
 * can never drift from the leaderboard number.
 *
 * Callback style, not a returned array: a long match holds tens of thousands of
 * HP events per unit, and deriveSummary re-runs on every time-window change —
 * materializing `{timestamp, amount}` objects there would be a per-event
 * allocation the current `.filter()` path does not pay.
 *
 * The event object itself is handed back (not just its timestamp) so callers
 * keep using timeRange.eventInRange verbatim, including its "no timestamp =
 * counted" defensive branch.
 *
 * Asymmetry worth knowing: the *Done bases fold in pets, the *Taken bases do
 * not — damage a pet soaks is the pet's, not its owner's. That matches the
 * leaderboard's 承伤 column.
 */
export function forEachContribution(
  unit: Unit,
  pets: Unit[],
  basis: FlowBasis,
  visit: (e: { timestamp: number }, amount: number) => void,
): void {
  switch (basis) {
    case "damageDone":
      for (const e of arr(unit.damageOut)) visit(e, e.effectiveAmount);
      for (const p of pets)
        for (const e of arr(p.damageOut)) visit(e, e.effectiveAmount);
      return;
    case "healingDone":
      for (const e of arr(unit.healOut)) visit(e, e.effectiveAmount);
      for (const p of pets)
        for (const e of arr(p.healOut)) visit(e, e.effectiveAmount);
      return;
    case "absorbsDone":
      for (const e of arr(unit.absorbsOut)) visit(e, e.absorbedAmount);
      for (const p of pets)
        for (const e of arr(p.absorbsOut)) visit(e, e.absorbedAmount);
      return;
    case "damageTaken":
      for (const e of arr(unit.damageIn)) visit(e, e.effectiveAmount);
      return;
    case "healingTaken":
      for (const e of arr(unit.healIn)) visit(e, e.effectiveAmount);
      return;
    case "absorbsTaken":
      for (const e of arr(unit.absorbsIn)) visit(e, e.absorbedAmount);
      return;
  }
}

export interface FlowSeriesUnit {
  unitId: string;
  name: string;
  classId: number;
  teamId: number;
  /** Per-second buckets; index = floor((timestamp − start) / bucketMs). */
  buckets: number[];
  /** Whole-match total = sum(buckets); equals this unit's leaderboard value
   * for the matching mode (asserted in report.flowseries.test.ts). */
  total: number;
}

export interface FlowSeriesData {
  metric: FlowMetric;
  /** Absolute ms, same basis as TimelineData.start/end. */
  start: number;
  end: number;
  bucketMs: number;
  bucketCount: number;
  units: FlowSeriesUnit[];
}

const BUCKET_MS = 1000;

/**
 * Per-second flow buckets, one row per player, sorted team-then-name so a
 * stacked column keeps each team's contribution contiguous.
 *
 * Whole-match basis on purpose: the curve, window list, death recap and burst
 * ledger all stay on the whole match while a time window only re-scopes the
 * aggregate panels (see MatchReport's basis note) — the highlighted selection
 * is drawn *over* the full-length bars.
 */
export function deriveFlowSeries(
  m: ReportSource,
  metric: FlowMetric,
): FlowSeriesData {
  const all = Object.values(m.units);
  const bucketCount = Math.max(
    1,
    Math.ceil((m.endTime - m.startTime) / BUCKET_MS),
  );
  const units = all
    .filter((u) => u.kind === "Player" && u.info)
    .map((u) => {
      const pets = petsOf(all, u.id);
      const buckets = new Array<number>(bucketCount).fill(0);
      let total = 0;
      for (const basis of METRIC_BASES[metric]) {
        forEachContribution(u, pets, basis, (e, amount) => {
          // Clamped, not dropped: deriveSummary over the whole match counts
          // every event whatever its timestamp, so an out-of-bounds (or
          // missing) one has to land in an edge bucket or sum(buckets) would
          // stop matching the leaderboard.
          const raw = Math.floor((e.timestamp - m.startTime) / BUCKET_MS);
          const i = Number.isFinite(raw)
            ? Math.min(bucketCount - 1, Math.max(0, raw))
            : 0;
          buckets[i] = (buckets[i] ?? 0) + amount;
          total += amount;
        });
      }
      return {
        unitId: u.id,
        name: u.name,
        classId: u.classId,
        teamId: u.info!.teamId,
        buckets,
        total,
      };
    })
    .sort((a, b) => a.teamId - b.teamId || a.name.localeCompare(b.name));
  return {
    metric,
    start: m.startTime,
    end: m.endTime,
    bucketMs: BUCKET_MS,
    bucketCount,
    units,
  };
}
