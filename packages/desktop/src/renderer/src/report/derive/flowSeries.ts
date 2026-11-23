import {
  type Language,
  type MessageKey,
  translate,
} from "../../../../shared/i18n";
import type { ReportSource } from "./types";

type Unit = ReportSource["units"][string];

/**
 * Flow metrics for the 战报 curve (the four the dropdown adds next to 血量).
 * HP is a *level* and is drawn as a curve (derive/timeline.ts); these four are
 * *flows*: bucketed per second here, then drawn as one smoothed per-unit
 * curve each (Timeline, via smoothRate) — stacked bars made a single player's
 * share unreadable once several were on screen.
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
const CURVE_METRIC_KEY: Record<CurveMetric, MessageKey> = {
  hp: "report.curveMetric.hp",
  damage: "report.curveMetric.damage",
  healing: "report.curveMetric.healing",
  taken: "report.curveMetric.taken",
  healed: "report.curveMetric.healed",
};

export function curveMetricLabel(
  m: CurveMetric,
  lang: Language = "zh",
): string {
  return translate(lang, CURVE_METRIC_KEY[m]);
}

/** The zh labels, for callers that do not take the UI language yet; new code
 * uses `curveMetricLabel(m, lang)`. */
export const CURVE_METRIC_LABEL: Record<CurveMetric, string> = {
  hp: curveMetricLabel("hp"),
  damage: curveMetricLabel("damage"),
  healing: curveMetricLabel("healing"),
  taken: curveMetricLabel("taken"),
  healed: curveMetricLabel("healed"),
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
 * Per-second flow buckets, one row per player, sorted team-then-name so the
 * legend lists each team contiguously.
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

/** Width of the centred moving average the flow curves are drawn from — the
 * finest that stays readable (user: "尽量细", 2026-11-23). Compared on a 5.5-min
 * 3v3 (dev:ui stress sample, 治疗): at 1 s a single 511k second set the axis
 * and flattened every other unit into the bottom third; 3 s brings the peak to
 * ~206k and keeps each big heal a separate, attributable peak; 5 s merged
 * neighbouring heals into plateaus. Odd, so the window is centred on its own
 * second. */
export const FLOW_SMOOTH_S = 3;

/**
 * Per-second rate smoothed with a centred `windowS`-bucket moving average.
 * Edge buckets average over the part of the window that exists (not over
 * zero-padding), so the first and last seconds do not read as an artificial
 * dip. Display only: totals stay on FlowSeriesUnit.total, whose equality with
 * the leaderboard is what report.flowseries.test.ts pins.
 */
export function smoothRate(buckets: number[], windowS: number): number[] {
  const n = buckets.length;
  const half = Math.max(0, Math.floor(windowS / 2));
  if (half === 0 || n === 0) return buckets.slice();
  const prefix = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + (buckets[i] ?? 0);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = (prefix[hi]! - prefix[lo]!) / (hi - lo);
  }
  return out;
}
