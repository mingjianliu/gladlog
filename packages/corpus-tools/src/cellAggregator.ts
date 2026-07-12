import type { IHealerMetrics } from "@gladlog/analysis";
import type { KeystoneGate } from "./keystoneGates";

export interface PerMatchRecord {
  spec: string;
  bracket: string;
  archetype: string;
  buildGroup: string; // "*" = build-agnostic (non-gated spec or unmatched)
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
  buildGroup: string;
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  exemplarCrises: string[][];
}
export interface BuildGroupDecl {
  keystoneNodeIds: number[];
  match: "any" | "all";
  groupPresent: string;
  groupAbsent: string;
}
export interface Corpus {
  wowPatchVersion: string;
  builtAt: string;
  sourceFloor: number;
  buildGroups: Record<string, BuildGroupDecl>;
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
  let vals = records
    .map((r) => r.metrics[metric])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  // offensiveIndex = damage/heal is unbounded and explodes when a healer barely
  // healed (early death / DPS round). Winsorize to the pool p99 so p90 isn't
  // dragged by fat-tail outliers. Only this metric is unbounded-ratio.
  if (metric === "offensiveIndex" && vals.length > 0) {
    const cap = percentile(vals, 0.99);
    vals = vals.map((v) => Math.min(v, cap));
  }
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
  buildGroup: string,
  records: PerMatchRecord[],
  nFloor: number,
): Cell {
  const metrics: Record<string, MetricDist> = {};
  for (const m of SCALAR_METRICS) metrics[m as string] = distFor(records, m);
  const exemplarCrises = records.slice(0, 50).map((r) => r.crisisEvents);
  return {
    spec,
    bracket,
    archetype,
    buildGroup,
    sampleN: records.length,
    insufficient: records.length < nFloor,
    metrics,
    exemplarCrises,
  };
}

export function aggregateCells(
  records: PerMatchRecord[],
  nFloor: number,
  meta: { wowPatchVersion?: string; sourceFloor?: number } | undefined,
  gates: KeystoneGate[],
): Corpus {
  const gateBySpec = new Map(gates.map((g) => [g.spec, g]));

  // --- N_floor guard: per (spec,bracket), a gated spec keeps its split only if
  // each buildGroup's build-parent (spec|bracket|*|group) has >= nFloor records.
  // Otherwise relabel that (spec,bracket)'s records to buildGroup="*".
  const buildParentCount = new Map<string, number>(); // spec|bracket|group -> n
  for (const r of records) {
    if (r.buildGroup === "*") continue;
    const k = `${r.spec}|${r.bracket}|${r.buildGroup}`;
    buildParentCount.set(k, (buildParentCount.get(k) ?? 0) + 1);
  }
  const deactivated = new Set<string>(); // spec|bracket
  for (const r of records) {
    if (r.buildGroup === "*") continue;
    const sb = `${r.spec}|${r.bracket}`;
    if (deactivated.has(sb)) continue;
    const g = gateBySpec.get(r.spec);
    if (!g) continue;
    const nPresent =
      buildParentCount.get(`${r.spec}|${r.bracket}|${g.groupPresent}`) ?? 0;
    const nAbsent =
      buildParentCount.get(`${r.spec}|${r.bracket}|${g.groupAbsent}`) ?? 0;
    if (nPresent < nFloor || nAbsent < nFloor) deactivated.add(sb);
  }
  const effGroup = (r: PerMatchRecord): string =>
    deactivated.has(`${r.spec}|${r.bracket}`) ? "*" : r.buildGroup;

  // --- Emit cells: each record contributes to its fallback-chain tiers.
  // buildGroup != "*": (archetype,group), (*,group), (*,*)
  // buildGroup == "*": (archetype,*), (*,*)
  const buckets = new Map<string, PerMatchRecord[]>();
  const push = (
    spec: string,
    bracket: string,
    a: string,
    b: string,
    r: PerMatchRecord,
  ) => {
    const k = `${spec}|${bracket}|${a}|${b}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  };
  const activeSpecs = new Set<string>();
  for (const r of records) {
    const bg = effGroup(r);
    if (bg !== "*") {
      activeSpecs.add(r.spec);
      if (r.archetype !== "*") push(r.spec, r.bracket, r.archetype, bg, r);
      push(r.spec, r.bracket, "*", bg, r);
      push(r.spec, r.bracket, "*", "*", r);
    } else {
      if (r.archetype !== "*") push(r.spec, r.bracket, r.archetype, "*", r);
      push(r.spec, r.bracket, "*", "*", r);
    }
  }

  const cells: Cell[] = [];
  for (const [k, recs] of buckets) {
    const [spec, bracket, archetype, buildGroup] = k.split("|");
    cells.push(buildCell(spec, bracket, archetype, buildGroup, recs, nFloor));
  }

  // --- buildGroups: declare each gated spec that stayed active in >=1 bracket.
  const buildGroups: Record<string, BuildGroupDecl> = {};
  for (const spec of activeSpecs) {
    const g = gateBySpec.get(spec);
    if (g)
      buildGroups[spec] = {
        keystoneNodeIds: g.keystoneNodeIds,
        match: g.match,
        groupPresent: g.groupPresent,
        groupAbsent: g.groupAbsent,
      };
  }

  return {
    wowPatchVersion: meta?.wowPatchVersion ?? "unknown",
    builtAt: new Date().toISOString(),
    sourceFloor: meta?.sourceFloor ?? 2300,
    buildGroups,
    cells,
  };
}
