/**
 * haloStats.ts — 光环实验解盲统计。主指标是光环对齐差:
 * raw Δ = treatment − control(R−O);Win 场取 −Δ、Loss 场取 +Δ 后合并
 * (光环预期方向在赢/输场相反,直接合并互相抵消 —— spec「盲评协议与统计」)。
 * outcomeAlignment 是 rubric 切换的预期变化,恒判 expected-change,
 * 不参与污染判定。复用 abCompareStats 的 bootstrap/符号检验谓词。
 */
import fs from "fs-extra";
import path from "path";

import {
  BOOTSTRAP_SEED,
  DIMENSIONS,
  type ScoreFile,
  bootstrapCI,
  dimensionScore,
  makeRng,
  signTestP,
} from "../ab/abCompareStats.js";
import type { IndexEntry } from "../corpus/buildCorpus";

interface MappingItem {
  blindId: string;
  arm: "control" | "treatment";
  ordinal: number;
  matchId: string;
}

interface HaloDimStats {
  dimension: string;
  n: number;
  alignedMean: number;
  alignedSd: number;
  ci95: { lo: number; hi: number };
  signTest: { p: number; positives: number; negatives: number; ties: number };
  winRawMean: number;
  winN: number;
  lossRawMean: number;
  lossN: number;
  verdict: "contaminated" | "reverse" | "inconclusive" | "expected-change";
}

interface HaloReport {
  pairs: number;
  missingScores: number;
  stats: HaloDimStats[];
}

const mean = (xs: number[]) =>
  xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

export async function computeHaloStats(haloDir: string): Promise<HaloReport> {
  const index = (await fs.readJson(
    path.join(haloDir, "control", "index.json"),
  )) as IndexEntry[];
  const resultByOrdinal = new Map(index.map((e) => [e.ordinal, e.result]));

  const { mapping } = (await fs.readJson(
    path.join(haloDir, "blind", "mapping.json"),
  )) as { mapping: MappingItem[] };
  const scores = new Map<string, ScoreFile>(); // key: arm|ordinal
  let missingScores = 0;
  for (const item of mapping) {
    const p = path.join(haloDir, "blind", "scores", `${item.blindId}.json`);
    if (!(await fs.pathExists(p))) {
      missingScores++;
      continue;
    }
    scores.set(
      `${item.arm}|${item.ordinal}`,
      (await fs.readJson(p)) as ScoreFile,
    );
  }

  const ordinals = [...new Set(mapping.map((m) => m.ordinal))].sort(
    (a, b) => a - b,
  );
  const rng = makeRng(BOOTSTRAP_SEED);
  const stats: HaloDimStats[] = [];
  for (const dimension of DIMENSIONS) {
    const aligned: number[] = [];
    const winRaw: number[] = [];
    const lossRaw: number[] = [];
    for (const ordinal of ordinals) {
      const c = scores.get(`control|${ordinal}`);
      const t = scores.get(`treatment|${ordinal}`);
      const result = resultByOrdinal.get(ordinal);
      if (!c || !t || (result !== "Win" && result !== "Loss")) continue;
      const cv = dimensionScore(c, dimension);
      const tv = dimensionScore(t, dimension);
      if (cv === null || tv === null) continue;
      const raw = tv - cv;
      (result === "Win" ? winRaw : lossRaw).push(raw);
      aligned.push(result === "Win" ? -raw : raw);
    }
    if (aligned.length === 0) continue;
    const alignedMean = mean(aligned);
    const alignedSd = Math.sqrt(
      aligned.reduce((s, d) => s + (d - alignedMean) ** 2, 0) /
        Math.max(1, aligned.length - 1),
    );
    const ci95 = bootstrapCI(aligned, rng);
    const verdict: HaloDimStats["verdict"] =
      dimension === "outcomeAlignment"
        ? "expected-change"
        : ci95.lo > 0
          ? "contaminated"
          : ci95.hi < 0
            ? "reverse"
            : "inconclusive";
    stats.push({
      dimension,
      n: aligned.length,
      alignedMean,
      alignedSd,
      ci95,
      signTest: signTestP(aligned),
      winRawMean: mean(winRaw),
      winN: winRaw.length,
      lossRawMean: mean(lossRaw),
      lossN: lossRaw.length,
      verdict,
    });
  }
  return { pairs: ordinals.length, missingScores, stats };
}

export function renderHaloMarkdown(report: HaloReport): string {
  const lines: string[] = [];
  lines.push(
    `Pairs: ${report.pairs}, missing scores: ${report.missingScores}`,
    "",
    "| Dimension | n | aligned Δ | SD | 95% CI | sign p | Win raw Δ (n) | Loss raw Δ (n) | Verdict |",
    "| --------- | - | --------- | -- | ------ | ------ | ------------- | -------------- | ------- |",
  );
  const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
  for (const s of report.stats)
    lines.push(
      `| ${s.dimension} | ${s.n} | ${f(s.alignedMean)} | ${s.alignedSd.toFixed(2)} | [${s.ci95.lo.toFixed(2)}, ${s.ci95.hi.toFixed(2)}] | ${s.signTest.p.toFixed(3)} | ${f(s.winRawMean)} (${s.winN}) | ${f(s.lossRawMean)} (${s.lossN}) | ${s.verdict} |`,
    );
  lines.push(
    "",
    "Verdicts: contaminated/reverse = 光环对齐差 95% bootstrap CI 不含零;outcomeAlignment 恒 expected-change(rubric 切换预期,非污染信号)。",
  );
  return lines.join("\n");
}
