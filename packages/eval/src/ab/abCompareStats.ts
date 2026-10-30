/* eslint-disable no-console */
/**
 * abCompareStats.ts
 *
 * Unblinds the /improve-healer-prompts blind scoring pool and computes paired
 * statistics per dimension. Replaces the old "avg worsened by > 0.3" rule,
 * which at n≈20 with a 1–5 Likert judge was indistinguishable from noise.
 *
 * Per dimension (treatment − control, paired by ordinal):
 *   - mean delta and SD of deltas
 *   - two-sided sign-test p-value (exact binomial on the +/− delta counts)
 *   - 95% bootstrap CI of the mean delta (10k resamples, seeded — deterministic)
 *
 * Reads  ab-test/blind/{mapping.json,scores/*.json}
 * Writes ab-test/comparison-stats.json and prints a markdown table for the
 * comparison report.
 *
 * Run this ONLY after every blind item has been scored — it reads mapping.json.
 */

import { toSortedFinite } from "@gladlog/analysis";
import fs from "fs-extra";
import path from "path";

import { computeAccuracyFromFactAudit } from "../provenance/checkScoreProvenance.js";

export const BOOTSTRAP_SEED = Number(process.env.BOOTSTRAP_SEED ?? 1337);
const BOOTSTRAP_ITERATIONS = 10000;

export const DIMENSIONS = [
  "sufficiency",
  "noise",
  "labelBias",
  "inferenceScaffolding",
  "accuracy",
  "outcomeAlignment",
  "focusCalibration",
] as const;

interface MappingItem {
  blindId: string;
  arm: "control" | "treatment";
  ordinal: number;
  matchId: string;
}

export interface ScoreFile {
  prompt: Record<string, number | string>;
  response: Record<string, number | string>;
  factAudit?: { verdict: string; severity?: string }[];
}

export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    // Divide by 2^32 (not 0xffffffff) to guarantee the output is strictly < 1;
    // otherwise a state of exactly 0xffffffff makes Math.floor(rng()*len) run
    // off the end of the array (review fix)
    return state / 0x100000000;
  };
}

export function dimensionScore(
  score: ScoreFile,
  dimension: string,
): number | null {
  const value = score.prompt?.[dimension] ?? score.response?.[dimension];
  // Same leniency as checkCalibration: coerce numeric strings ("4"), so a judge
  // emitting strings cannot turn every dimension into null and let empty
  // statistics pass silently (review fix)
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return !isNaN(num) ? num : null;
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `<id>.json`(legacy K=1)+ `<id>.rN.json`(K 重),N 升序。 */
export function collectReplicateFiles(
  scoresDir: string,
  blindId: string,
): string[] {
  const out: string[] = [];
  const legacy = path.join(scoresDir, `${blindId}.json`);
  if (fs.existsSync(legacy)) out.push(legacy);
  const re = new RegExp(
    `^${blindId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.r(\\d+)\\.json$`,
  );
  const reps = (fs.existsSync(scoresDir) ? fs.readdirSync(scoresDir) : [])
    .map((f) => ({ f, m: f.match(re) }))
    .filter((x): x is { f: string; m: RegExpMatchArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => path.join(scoresDir, x.f));
  return [...out, ...reps];
}

/** 逐维中位数聚合。accuracy:每份若带 factAudit,以 computeAccuracyFromFactAudit
 * 的计算值参与(与记录值不符计 mismatch)—— 防守:即使 provenance 漏网,
 * 统计侧仍是确定性值。 */
export function aggregateReplicates(
  reps: ScoreFile[],
): { score: ScoreFile; accuracyMismatches: number } | null {
  if (reps.length === 0) return null;
  let accuracyMismatches = 0;
  const promptOut: Record<string, number> = {};
  const responseOut: Record<string, number> = {};
  const PROMPT_DIMS = new Set([
    "sufficiency",
    "noise",
    "labelBias",
    "inferenceScaffolding",
  ]);
  for (const dimension of DIMENSIONS) {
    const values: number[] = [];
    for (const r of reps) {
      let v = dimensionScore(r, dimension);
      if (dimension === "accuracy" && Array.isArray(r.factAudit)) {
        const derived = computeAccuracyFromFactAudit(r.factAudit);
        if (v !== null && v !== derived) accuracyMismatches++;
        v = derived;
      }
      if (v !== null) values.push(v);
    }
    if (values.length === 0) continue;
    (PROMPT_DIMS.has(dimension) ? promptOut : responseOut)[dimension] =
      medianOf(values);
  }
  return {
    score: { prompt: promptOut, response: responseOut },
    accuracyMismatches,
  };
}

/** Two-sided exact sign test: P(X ≤ min(pos,neg) or X ≥ max(pos,neg)) for X ~ Binomial(pos+neg, 0.5). Ties dropped. */
export function signTestP(deltas: number[]): {
  p: number;
  positives: number;
  negatives: number;
  ties: number;
} {
  const positives = deltas.filter((d) => d > 0).length;
  const negatives = deltas.filter((d) => d < 0).length;
  const ties = deltas.length - positives - negatives;
  const n = positives + negatives;
  if (n === 0) return { p: 1, positives, negatives, ties };
  // log-space binomial pmf to avoid overflow
  const logFact: number[] = [0];
  for (let i = 1; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const pmf = (k: number) =>
    Math.exp(logFact[n] - logFact[k] - logFact[n - k] - n * Math.LN2);
  const k = Math.min(positives, negatives);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += pmf(i);
  return { p: Math.min(1, 2 * tail), positives, negatives, ties };
}

export function bootstrapCI(
  deltas: number[],
  rng: () => number,
): { lo: number; hi: number } {
  const means: number[] = [];
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    let sum = 0;
    for (let i = 0; i < deltas.length; i++)
      sum += deltas[Math.floor(rng() * deltas.length)];
    means.push(sum / deltas.length);
  }
  // Go through the shared predicate: a single NaN makes (a,b)=>a-b silently
  // leave the array unsorted, and the confidence-interval bounds then become
  // arbitrary samples — while still LOOKING like normal numbers. See
  // analysis/utils/stats.ts.
  const sorted = toSortedFinite(means);
  if (sorted.length === 0) return { lo: NaN, hi: NaN };
  // The index rule is unchanged from before (lo=floor(n*.025),
  // hi=ceil(n*.975)-1); only the sort moved to the shared predicate — this
  // changes no existing result on clean input, so old runs remain comparable.
  const clamp = (i: number) => Math.min(sorted.length - 1, Math.max(0, i));
  return {
    lo: sorted[clamp(Math.floor(sorted.length * 0.025))],
    hi: sorted[clamp(Math.ceil(sorted.length * 0.975) - 1)],
  };
}

export async function main(): Promise<void> {
  const abDir = process.env.AB_DIR ?? "";
  if (!abDir) {
    console.error("AB_DIR environment variable must be set");
    process.exit(1);
  }
  const blindDir = path.join(abDir, "blind");

  const mappingPath = path.join(blindDir, "mapping.json");
  if (!(await fs.pathExists(mappingPath))) {
    console.error(
      `No ${mappingPath} — run start:blindAbPool and blind-score the items first.`,
    );
    process.exit(1);
  }
  const { mapping } = (await fs.readJson(mappingPath)) as {
    mapping: MappingItem[];
  };

  const scoresByArm = new Map<string, ScoreFile>(); // key: arm|ordinal(聚合后)
  let missing = 0;
  let itemsDropped = 0;
  let twoReplicateItems = 0;
  let accuracyMismatchTotal = 0;
  // matchId placeholder convention (eval-ab.md): blinded items carry no MATCHID
  // header, so the matchId in the score JSON must be the blind id itself.
  // Without this check each judge invents its own placeholder (we have observed
  // null, "unknown" and "NO_MATCHID_HEADER_FOUND" in practice), and any
  // downstream aggregation by matchId turns into archaeology round by round.
  // A matchId equal to the **real** one is the worse case — that information is
  // not in the blinded item at all, so the judge can only have obtained it by
  // reading files it had no business reading; it is flagged separately as a
  // suspected blind break.
  const nonconforming: string[] = [];
  const leaks: string[] = [];
  const scoresDir = path.join(blindDir, "scores");
  const kMode = mapping.some((item) =>
    collectReplicateFiles(scoresDir, item.blindId).some((p) =>
      /\.r\d+\.json$/.test(p),
    ),
  );
  for (const item of mapping) {
    const files = collectReplicateFiles(scoresDir, item.blindId);
    if (files.length === 0) {
      missing++;
      continue;
    }
    if (kMode && files.length < 2) {
      itemsDropped++;
      continue;
    }
    if (kMode && files.length === 2) twoReplicateItems++;
    const reps: ScoreFile[] = [];
    for (const p of files) {
      const score = (await fs.readJson(p)) as ScoreFile & {
        matchId?: unknown;
      };
      if (score.matchId === item.matchId) {
        leaks.push(path.basename(p));
      } else if (score.matchId !== item.blindId) {
        nonconforming.push(
          `${path.basename(p)}=${JSON.stringify(score.matchId)}`,
        );
      }
      reps.push(score);
    }
    const agg = aggregateReplicates(reps);
    if (!agg) {
      missing++;
      continue;
    }
    accuracyMismatchTotal += agg.accuracyMismatches;
    scoresByArm.set(`${item.arm}|${item.ordinal}`, agg.score);
  }
  if (missing > 0)
    console.warn(
      `WARNING: ${missing}/${mapping.length} blind items unscored — their pairs are dropped.`,
    );
  if (leaks.length > 0)
    console.warn(
      `WARNING: ${leaks.length} score file(s) contain the REAL matchId (${leaks.join(", ")}) — the blind item does not carry it, so the judge can only have read files it was told not to. Treat this run's blinding as suspect.`,
    );
  if (nonconforming.length > 0)
    console.warn(
      `WARNING: ${nonconforming.length} score file(s) violate the matchId=blindId placeholder convention (eval-ab.md): ${nonconforming.slice(0, 5).join(", ")}${nonconforming.length > 5 ? ", …" : ""}`,
    );
  if (kMode)
    console.warn(
      `K-replicate mode: ${itemsDropped} item(s) dropped (<2 replicates), ${twoReplicateItems} item(s) aggregated from only 2, ${accuracyMismatchTotal} recorded-accuracy mismatch(es) overridden by factAudit-derived values.`,
    );

  const ordinals = [...new Set(mapping.map((m) => m.ordinal))].sort(
    (a, b) => a - b,
  );

  interface DimStats {
    dimension: string;
    n: number;
    controlMean: number;
    treatmentMean: number;
    meanDelta: number;
    sdDelta: number;
    signTest: { p: number; positives: number; negatives: number; ties: number };
    ci95: { lo: number; hi: number };
    verdict: "improved" | "regressed" | "inconclusive";
  }
  const stats: DimStats[] = [];
  const rng = makeRng(BOOTSTRAP_SEED);

  for (const dimension of DIMENSIONS) {
    const deltas: number[] = [];
    const controls: number[] = [];
    const treatments: number[] = [];
    for (const ordinal of ordinals) {
      const c = scoresByArm.get(`control|${ordinal}`);
      const t = scoresByArm.get(`treatment|${ordinal}`);
      if (!c || !t) continue;
      const cv = dimensionScore(c, dimension);
      const tv = dimensionScore(t, dimension);
      if (cv === null || tv === null) continue;
      controls.push(cv);
      treatments.push(tv);
      deltas.push(tv - cv);
    }
    if (deltas.length === 0) continue;
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const sdDelta = Math.sqrt(
      deltas.reduce((sum, d) => sum + (d - meanDelta) ** 2, 0) /
        Math.max(1, deltas.length - 1),
    );
    const ci95 = bootstrapCI(deltas, rng);
    const signTest = signTestP(deltas);
    const verdict: DimStats["verdict"] =
      ci95.lo > 0 ? "improved" : ci95.hi < 0 ? "regressed" : "inconclusive";
    stats.push({
      dimension,
      n: deltas.length,
      controlMean: controls.reduce((a, b) => a + b, 0) / controls.length,
      treatmentMean: treatments.reduce((a, b) => a + b, 0) / treatments.length,
      meanDelta,
      sdDelta,
      signTest,
      ci95,
      verdict,
    });
  }

  const outPath = path.join(abDir, "comparison-stats.json");
  await fs.writeJson(
    outPath,
    {
      generatedAt: new Date().toISOString(),
      pairs: ordinals.length,
      stats,
      replicateSummary: {
        kMode,
        itemsDropped,
        twoReplicateItems,
        accuracyMismatches: accuracyMismatchTotal,
      },
    },
    { spaces: 2 },
  );

  console.log(
    "\n| Dimension | n | Control | Treatment | Δ mean | Δ SD | 95% CI | sign test p | Verdict |",
  );
  console.log(
    "| --------- | - | ------- | --------- | ------ | ---- | ------ | ----------- | ------- |",
  );
  for (const s of stats) {
    console.log(
      `| ${s.dimension} | ${s.n} | ${s.controlMean.toFixed(2)} | ${s.treatmentMean.toFixed(2)} | ${s.meanDelta >= 0 ? "+" : ""}${s.meanDelta.toFixed(2)} | ${s.sdDelta.toFixed(2)} | [${s.ci95.lo.toFixed(2)}, ${s.ci95.hi.toFixed(2)}] | ${s.signTest.p.toFixed(3)} | ${s.verdict} |`,
    );
  }
  console.log(
    "\nVerdicts: improved/regressed = 95% bootstrap CI of the paired delta excludes 0; anything else is inconclusive (do not adopt or reject on it — increase n or accept the uncertainty explicitly).",
  );
  console.log(`Stats written to ${outPath}`);
}
