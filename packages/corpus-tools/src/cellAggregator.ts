import type { IHealerMetrics } from "@gladlog/analysis";

export interface PerMatchRecord {
  spec: string;
  bracket: string;
  archetype: string;
  metrics: IHealerMetrics;
  crisisEvents: string[];
}
export interface MetricDist {
  p10: number;
  p50: number;
  p90: number;
  n: number;
}
export interface Cell {
  spec: string;
  bracket: string;
  archetype: string;
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  exemplarCrises: string[][];
}
export interface Corpus {
  wowPatchVersion: string;
  builtAt: string;
  sourceFloor: number;
  cells: Cell[];
}

// 逐维取值:6 个标量维;reactionLatency 可为 null(不计入该维分布)。
const SCALAR_METRICS: Array<keyof IHealerMetrics> = [
  "offensiveIndex",
  "ccDensity",
  "reactionLatency",
  "defensiveOverlapRatio",
  "effectiveCastRatio",
  "ccAvoidanceRate",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  // Linear interpolation (matches numpy's default "linear" method). The
  // brief's original nearest-rank formula (Math.floor(p * n)) lands exactly
  // on the toBeCloseTo(19.5, 0) boundary for the 40-record test (diff===0.5,
  // which fails the strict `< 0.5` tolerance), so interpolation is used here
  // instead to give the mathematically correct median with margin.
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function distFor(
  records: PerMatchRecord[],
  metric: keyof IHealerMetrics,
): MetricDist {
  const vals = records
    .map((r) => r.metrics[metric])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  return {
    p10: percentile(vals, 0.1),
    p50: percentile(vals, 0.5),
    p90: percentile(vals, 0.9),
    n: vals.length,
  };
}

function buildCell(
  spec: string,
  bracket: string,
  archetype: string,
  records: PerMatchRecord[],
  nFloor: number,
): Cell {
  const metrics: Record<string, MetricDist> = {};
  for (const m of SCALAR_METRICS) metrics[m as string] = distFor(records, m);
  // exemplar:取每条的 crisisEvents(SP-B2 再做多样化选择),上限 50 条防膨胀
  const exemplarCrises = records.slice(0, 50).map((r) => r.crisisEvents);
  return {
    spec,
    bracket,
    archetype,
    sampleN: records.length,
    insufficient: records.length < nFloor,
    metrics,
    exemplarCrises,
  };
}

export function aggregateCells(
  records: PerMatchRecord[],
  nFloor: number,
  meta?: { wowPatchVersion?: string; sourceFloor?: number },
): Corpus {
  const byArche = new Map<string, PerMatchRecord[]>();
  const byParent = new Map<string, PerMatchRecord[]>();
  for (const r of records) {
    const pk = `${r.spec}|${r.bracket}|*`;
    (byParent.get(pk) ?? byParent.set(pk, []).get(pk)!).push(r);
    // "*" 是父 cell 保留键;archetype 恰为 "*" 的记录只进父 cell(防与父 cell 撞键重复)
    if (r.archetype !== "*") {
      const ak = `${r.spec}|${r.bracket}|${r.archetype}`;
      (byArche.get(ak) ?? byArche.set(ak, []).get(ak)!).push(r);
    }
  }
  const cells: Cell[] = [];
  for (const [k, recs] of byArche) {
    const [spec, bracket, archetype] = k.split("|");
    cells.push(buildCell(spec, bracket, archetype, recs, nFloor));
  }
  for (const [k, recs] of byParent) {
    const [spec, bracket] = k.split("|");
    cells.push(buildCell(spec, bracket, "*", recs, nFloor));
  }
  return {
    wowPatchVersion: meta?.wowPatchVersion ?? "unknown",
    builtAt: new Date().toISOString(),
    sourceFloor: meta?.sourceFloor ?? 2300,
    cells,
  };
}
