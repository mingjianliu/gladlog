import type { IDpsMetrics, IHealerMetrics } from "@gladlog/analysis";
import type { RotationSummary } from "@gladlog/analysis/src/compare/corpusTypes";

import type { KeystoneGate } from "./keystoneGates";

export interface PerMatchRecord {
  spec: string;
  bracket: string;
  archetype: string;
  buildGroup: string; // "*" = build-agnostic (non-gated spec or unmatched)
  /** A healer record = IHealerMetrics; a dps record = IDpsMetrics. Specs are
   * inherently disjoint, so only one kind appears within a cell; dimensions
   * with n=0 are skipped by the consumer (verifiedComparison). */
  metrics: IHealerMetrics | IDpsMetrics;
  crisisEvents: string[];
  /** #37 缺口一: opener + core sequences from extractRotations (crisisEvents
   * above is the third member of the same extraction). Optional so hand-built
   * fixtures and pre-2026-08-25 pipelines keep working. */
  rotations?: { opener: string[]; coreSequences: string[] };
  /** P2: enemy comp signature (enemyCompSignature) / match duration / the
   * spec of the first enemy killed. */
  enemyComp?: string;
  durationS?: number;
  firstEnemyKillSpec?: string;
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
  enemyComp?: string;
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  durationS?: MetricDist;
  firstKill?: Record<string, number>;
  exemplarCrises: string[][];
  rotationSummary?: RotationSummary;
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

// Values per dimension: 6 healer dimensions + 7 dps ones; null (e.g.
// reactionLatency, or a ratio in a match with no burst) does not enter that
// dimension's distribution. Every DPS dimension is bounded (ratios 0-1 /
// seconds / counts), so no winsorizing is needed.
const SCALAR_METRICS: string[] = [
  // healer
  "offensiveIndex",
  "ccDensity",
  "reactionLatency",
  "defensiveOverlapRatio",
  "effectiveCastRatio",
  "ccAvoidanceRate",
  // dps (pro-comparison P1; the predicate is the burst-ledger trio)
  "burstConversionRate",
  "burstIntoDefensiveRatio",
  "alignedBurstRatio",
  "onTargetPct",
  "kickLandedRate",
  "kicksJukedCount",
  "firstBurstSeconds",
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

function distFor(records: PerMatchRecord[], metric: string): MetricDist {
  let vals = records
    .map((r) => (r.metrics as unknown as Record<string, unknown>)[metric])
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

/** #37 缺口一: aggregate per-record rotations into cell-level shares. The
 * "(used Nx)" suffix extractRotations appends is stripped before counting; a
 * sequence is counted once per record (within-record repetition is already the
 * suffix's job). Records without rotations (old pipelines, hand fixtures) are
 * excluded from the denominator. */
export function aggregateRotations(
  records: PerMatchRecord[],
): RotationSummary | undefined {
  const withRot = records.filter((r) => r.rotations);
  if (withRot.length === 0) return undefined;
  const openerCounts = new Map<string, number>();
  const seqCounts = new Map<string, number>();
  for (const r of withRot) {
    const opener = (r.rotations!.opener ?? []).slice(0, 3).join(" → ");
    if (opener) openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + 1);
    const seen = new Set<string>();
    for (const sRaw of r.rotations!.coreSequences ?? []) {
      const seq = sRaw.split(" (used")[0]!;
      if (seen.has(seq)) continue;
      seen.add(seq);
      seqCounts.set(seq, (seqCounts.get(seq) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>, k: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([seq, n]) => ({ seq, share: n / withRot.length }));
  return { openers: top(openerCounts, 3), sequences: top(seqCounts, 3) };
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
  const rotationSummary = aggregateRotations(records);
  return {
    spec,
    bracket,
    archetype,
    buildGroup,
    sampleN: records.length,
    insufficient: records.length < nFloor,
    metrics,
    exemplarCrises,
    rotationSummary,
  };
}

/** Sample-size floor for a P2 comp cell (shared with validateCorpus -- the
 * gate predicate is the spec). */
export const COMP_CELL_N_FLOOR = 20;

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
  // #37 缺口二 (2026-08-25): hero-tree groups arrive WITHOUT a gate decl (the
  // hero tree is the default grouping for undeclared specs), so the old
  // "no gate → collapse to '*'" self-consistency guard would swallow every
  // hero group. The guard's INTENT survives in two shapes:
  //   - gated spec: the original present/absent-pair rule (either side under
  //     the floor — including entirely absent — pools the bracket);
  //   - ungated spec: a split is real only when >=2 distinct groups were
  //     observed and EVERY one clears the floor; otherwise pool. A lone
  //     observed group would only duplicate the "*" cell.
  // Hero groups still never enter `buildGroups` (that record stays gate-only);
  // the read side matches them via CompareInput.heroGroup instead.
  const groupsBySb = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.buildGroup === "*") continue;
    const sb = `${r.spec}|${r.bracket}`;
    (groupsBySb.get(sb) ?? groupsBySb.set(sb, new Set()).get(sb)!).add(
      r.buildGroup,
    );
  }
  for (const r of records) {
    if (r.buildGroup === "*") continue;
    const sb = `${r.spec}|${r.bracket}`;
    if (deactivated.has(sb)) continue;
    const g = gateBySpec.get(r.spec);
    if (g) {
      const nPresent =
        buildParentCount.get(`${sb}|${g.groupPresent}`) ?? 0;
      const nAbsent = buildParentCount.get(`${sb}|${g.groupAbsent}`) ?? 0;
      if (nPresent < nFloor || nAbsent < nFloor) deactivated.add(sb);
    } else {
      const groups = groupsBySb.get(sb) ?? new Set<string>();
      const viable =
        groups.size >= 2 &&
        [...groups].every(
          (bg) => (buildParentCount.get(`${sb}|${bg}`) ?? 0) >= nFloor,
        );
      if (!viable) deactivated.add(sb);
    }
  }
  const effGroup = (r: PerMatchRecord): string =>
    r.buildGroup !== "*" && !deactivated.has(`${r.spec}|${r.bracket}`)
      ? r.buildGroup
      : "*";

  // --- Emit cells: each record contributes to its fallback-chain tiers.
  // A gated (build-split) record ALSO emits the build-agnostic archetype cell
  // (archetype,*) so every bracket keeps an archetype baseline. This lets
  // SP-B2's fallback be archetype×buildGroup → *×buildGroup → archetype×* → *×*
  // and removes the hazard where a spec declared in buildGroups but only
  // build-split in some brackets would skip the valid archetype×* cell.
  // buildGroup != "*": (archetype,group), (archetype,*), (*,group), (*,*)
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
      if (r.archetype !== "*") {
        push(r.spec, r.bracket, r.archetype, bg, r);
        push(r.spec, r.bracket, r.archetype, "*", r); // archetype baseline
      }
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

  // --- P2: cells along the opposing comp dimension
  // (spec|bracket|enemyComp). Cells are emitted only for high-frequency comps
  // with enough samples (COMP_N_FLOOR); everything else uses the existing
  // fallback chain. Comp-level aggregates are attached: the duration
  // distribution plus a count of who was killed first.
  const COMP_N_FLOOR = COMP_CELL_N_FLOOR;
  const compBuckets = new Map<string, PerMatchRecord[]>();
  for (const r of records) {
    if (!r.enemyComp) continue;
    const k = `${r.spec}|${r.bracket}|${r.enemyComp}`;
    (compBuckets.get(k) ?? compBuckets.set(k, []).get(k)!).push(r);
  }
  for (const [k, recs] of compBuckets) {
    if (recs.length < COMP_N_FLOOR) continue;
    const [spec, bracket, enemyComp] = k.split("|");
    const cell = buildCell(spec, bracket, "*", "*", recs, COMP_N_FLOOR);
    cell.enemyComp = enemyComp;
    const durs = recs
      .map((r) => r.durationS)
      .filter((d): d is number => typeof d === "number")
      .sort((a, b) => a - b);
    cell.durationS = {
      p10: percentile(durs, 0.1),
      p50: percentile(durs, 0.5),
      p90: percentile(durs, 0.9),
      n: durs.length,
    };
    const firstKill: Record<string, number> = {};
    for (const r of recs) {
      if (!r.firstEnemyKillSpec) continue;
      firstKill[r.firstEnemyKillSpec] =
        (firstKill[r.firstEnemyKillSpec] ?? 0) + 1;
    }
    cell.firstKill = firstKill;
    cells.push(cell);
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
