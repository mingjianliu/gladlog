/**
 * familyBias.ts — D1 同族偏差 2×2 双差分统计(子项目 D,
 * see docs/superpowers/specs/2026-08-06-family-bias-sycophancy-design.md)。
 *
 * 2×2 设计:50 prompt × {S 回复, D 回复} × {S 判官, D 判官}。复用
 * `abCompareStats` 的 `BOOTSTRAP_SEED`/`bootstrapCI`/`makeRng`/`dimensionScore`/
 * `DIMENSIONS`/`ScoreFile`(门规谓词即规范:同一份 bootstrap 种子与打分读取
 * 逻辑,不在这里另开一份),以及 `checkScoreProvenance` 的 `FACT_AUDIT_VERDICTS`
 * 作为 verdict 枚举单源。
 *
 * `diffInDiff`/`accuracyVerdictBreakdown` 是纯函数(单测直接喂合成
 * ScoreFile[]);`computeFamilyStats` 是唯一做 fs IO 的编排函数,读
 * `<abDir>/blind/mapping.json` + `blind/scores/`(S 判官)+ `blind/scores-d/`
 * (D 判官)并按 ordinal 配对——与 `halo/haloStats.ts` 的 `computeHaloStats`
 * 同一分层:纯统计与 IO 编排分文件里的两层,不分两个文件。
 */
import fs from "fs-extra";
import path from "path";

import {
  BOOTSTRAP_SEED,
  bootstrapCI,
  DIMENSIONS,
  dimensionScore,
  makeRng,
  type ScoreFile,
} from "../ab/abCompareStats.js";
import { FACT_AUDIT_VERDICTS } from "../provenance/checkScoreProvenance.js";

interface MappingItem {
  blindId: string;
  arm: "control" | "treatment";
  ordinal: number;
  matchId: string;
}

/**
 * 四格配对输入:每个数组按 prompt(ordinal)顺序一一对应 —— `sjSr[i]` 与
 * `djSr[i]`/`sjDr[i]`/`djDr[i]` 必须是同一个 ordinal 的四份打分。配对本身
 * 由调用方(`computeFamilyStats`,读 mapping.json 解盲)完成,这里只做算术。
 *
 * 命名:S判(S回)= sonnet 判官对 sonnet 回复的打分,依此类推。Mapping 约定
 * (由构建盲池的一方保证)control 臂 = S 回复,treatment 臂 = D 回复。
 */
export interface DiffInDiffCells {
  sjSr: ScoreFile[];
  djSr: ScoreFile[];
  sjDr: ScoreFile[];
  djDr: ScoreFile[];
}

interface DimensionDiffResult {
  dimension: string;
  /** 该维度参与 familyBias 配对计算的 item 数(四格都有该维度有效值)。 */
  n: number;
  /** familyBias = mean[(S判(S回) − D判(S回)) − (S判(D回) − D判(D回))]。 */
  familyBias: number;
  ci95: { lo: number; hi: number };
  /** 判官严宽度:mean(S判 − D判),取全部 2n 个「同一份回复被两族判官各打一次」
   * 的差(即 sjSr−djSr 与 sjDr−djDr 的全体),与 familyBias 分开报告 —— spec
   * D1「判官严宽度单独报告」。 */
  harshness: number;
  harshnessN: number;
}

/**
 * 双差分:每维 familyBias = (S判(S回)−D判(S回)) − (S判(D回)−D判(D回)),按
 * item 配对 bootstrap 95% CI(种子单源 `BOOTSTRAP_SEED`,与 `abCompareStats`/
 * `haloStats` 相同的「一个 rng 顺序喂给全部维度」用法,保证跨维度可复现)。
 * 四个数组必须等长(调用方按 ordinal 配对好);任一维度某 item 四格有值缺失
 * (`dimensionScore` 返回 null)则该 item 在该维度被跳过,不影响其它维度。
 */
export function diffInDiff(
  cells: DiffInDiffCells,
  dims: readonly string[] = DIMENSIONS,
  rngSeed: number = BOOTSTRAP_SEED,
): DimensionDiffResult[] {
  const { sjSr, djSr, sjDr, djDr } = cells;
  const n = sjSr.length;
  if (djSr.length !== n || sjDr.length !== n || djDr.length !== n) {
    throw new Error(
      `diffInDiff: 四格数组长度必须相等(按 ordinal 配对)—— got sjSr=${n} djSr=${djSr.length} sjDr=${sjDr.length} djDr=${djDr.length}`,
    );
  }

  const rng = makeRng(rngSeed);
  const results: DimensionDiffResult[] = [];
  for (const dimension of dims) {
    const deltas: number[] = [];
    const harshnessTerms: number[] = [];
    for (let i = 0; i < n; i++) {
      const sjSrV = dimensionScore(sjSr[i], dimension);
      const djSrV = dimensionScore(djSr[i], dimension);
      const sjDrV = dimensionScore(sjDr[i], dimension);
      const djDrV = dimensionScore(djDr[i], dimension);
      if (sjSrV === null || djSrV === null || sjDrV === null || djDrV === null)
        continue;
      deltas.push(sjSrV - djSrV - (sjDrV - djDrV));
      harshnessTerms.push(sjSrV - djSrV);
      harshnessTerms.push(sjDrV - djDrV);
    }
    if (deltas.length === 0) continue;
    const familyBias = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const ci95 = bootstrapCI(deltas, rng);
    const harshness =
      harshnessTerms.reduce((a, b) => a + b, 0) / harshnessTerms.length;
    results.push({
      dimension,
      n: deltas.length,
      familyBias,
      ci95,
      harshness,
      harshnessN: harshnessTerms.length,
    });
  }
  return results;
}

interface VerdictCounts {
  /** 带 factAudit 数组的份数(缺 factAudit 的分数文件不计入)。 */
  n: number;
  verified: number;
  refuted: number;
  unsupported: number;
  total: number;
  meanPerItem: { verified: number; refuted: number; unsupported: number };
}

function countVerdicts(scores: ScoreFile[]): VerdictCounts {
  let n = 0;
  let verified = 0;
  let refuted = 0;
  let unsupported = 0;
  for (const s of scores) {
    if (!Array.isArray(s.factAudit)) continue;
    n++;
    for (const entry of s.factAudit) {
      if (entry.verdict === FACT_AUDIT_VERDICTS[0]) verified++;
      else if (entry.verdict === FACT_AUDIT_VERDICTS[1]) refuted++;
      else if (entry.verdict === FACT_AUDIT_VERDICTS[2]) unsupported++;
    }
  }
  const total = verified + refuted + unsupported;
  return {
    n,
    verified,
    refuted,
    unsupported,
    total,
    meanPerItem: {
      verified: n === 0 ? 0 : verified / n,
      refuted: n === 0 ? 0 : refuted / n,
      unsupported: n === 0 ? 0 : unsupported / n,
    },
  };
}

/**
 * 两族判官 factAudit verdict 计数对比 —— accuracy 维现由 factAudit 派生
 * (子项目 A),两族判官的 accuracy 差异因此就是「事实审计行为差异」,不再
 * 混打分习惯。入参是各自判官打过的**全部**分数(两臂合并,不要求配对完整,
 * 与 familyBias 的配对要求不同——这里只统计判官行为,不比较回复)。
 */
export function accuracyVerdictBreakdown(
  sJudgeScores: ScoreFile[],
  dJudgeScores: ScoreFile[],
): { sJudge: VerdictCounts; dJudge: VerdictCounts } {
  return {
    sJudge: countVerdicts(sJudgeScores),
    dJudge: countVerdicts(dJudgeScores),
  };
}

/**
 * 从 `docs/commands/eval-baseline.md` 抽取「## Step 3」到下一个二级标题之间
 * 的原文(含标题本身)——D 判官的 rubric 必须与 S 判官读的是同一份契约文本,
 * 不在源码里另存一份副本(否则文档改了 rubric、判官却在用旧版,漂移无声无息)。
 * 抛错而非静默返回空串:标题丢失通常意味着文档结构改了,调用方必须知道。
 */
export function extractStep3Rubric(evalBaselineMd: string): string {
  const lines = evalBaselineMd.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith("## Step 3"));
  if (startIdx === -1) {
    throw new Error(
      "docs/commands/eval-baseline.md 未找到 '## Step 3' 标题 —— 文档结构漂移,rubric 抽取失败",
    );
  }
  let endIdx = lines.findIndex((l, i) => i > startIdx && l.startsWith("## "));
  if (endIdx === -1) endIdx = lines.length;
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

interface FamilyStatsReport {
  generatedAt: string;
  /** 四格都齐全、参与 diffInDiff 配对的 prompt 数。 */
  pairs: number;
  dimensions: DimensionDiffResult[];
  accuracyVerdicts: { sJudge: VerdictCounts; dJudge: VerdictCounts };
  /** mapping 里有条目但 blind/scores/ 缺文件的个数(诊断用,非硬门槛)。 */
  missingSJudge: number;
  missingDJudge: number;
}

/**
 * 读 `<abDirPath>/blind/mapping.json` + `blind/scores/`(S 判官)+
 * `blind/scores-d/`(D 判官),按 ordinal 把 control 臂(S 回复)与 treatment
 * 臂(D 回复)的两份判分配成四格,调 `diffInDiff` + `accuracyVerdictBreakdown`。
 * 与 `halo/haloStats.ts` 的 `computeHaloStats` 同一编排风格:唯一做 fs IO
 * 的函数,CLI 只负责调用它、写 JSON、打印。
 */
export async function computeFamilyStats(
  abDirPath: string,
): Promise<FamilyStatsReport> {
  const { mapping } = (await fs.readJson(
    path.join(abDirPath, "blind", "mapping.json"),
  )) as { mapping: MappingItem[] };

  const sScoresDir = path.join(abDirPath, "blind", "scores");
  const dScoresDir = path.join(abDirPath, "blind", "scores-d");
  const sScores = new Map<string, ScoreFile>();
  const dScores = new Map<string, ScoreFile>();
  let missingSJudge = 0;
  let missingDJudge = 0;
  for (const item of mapping) {
    const sp = path.join(sScoresDir, `${item.blindId}.json`);
    if (await fs.pathExists(sp)) {
      sScores.set(item.blindId, (await fs.readJson(sp)) as ScoreFile);
    } else {
      missingSJudge++;
    }
    const dp = path.join(dScoresDir, `${item.blindId}.json`);
    if (await fs.pathExists(dp)) {
      dScores.set(item.blindId, (await fs.readJson(dp)) as ScoreFile);
    } else {
      missingDJudge++;
    }
  }

  const byOrdinalControl = new Map<number, string>();
  const byOrdinalTreatment = new Map<number, string>();
  for (const item of mapping) {
    (item.arm === "control" ? byOrdinalControl : byOrdinalTreatment).set(
      item.ordinal,
      item.blindId,
    );
  }
  const ordinals = [...new Set(mapping.map((m) => m.ordinal))].sort(
    (a, b) => a - b,
  );

  const cells: DiffInDiffCells = { sjSr: [], djSr: [], sjDr: [], djDr: [] };
  for (const ordinal of ordinals) {
    const controlId = byOrdinalControl.get(ordinal);
    const treatmentId = byOrdinalTreatment.get(ordinal);
    if (!controlId || !treatmentId) continue;
    const sjSr = sScores.get(controlId);
    const djSr = dScores.get(controlId);
    const sjDr = sScores.get(treatmentId);
    const djDr = dScores.get(treatmentId);
    if (!sjSr || !djSr || !sjDr || !djDr) continue;
    cells.sjSr.push(sjSr);
    cells.djSr.push(djSr);
    cells.sjDr.push(sjDr);
    cells.djDr.push(djDr);
  }

  const dimensions = diffInDiff(cells);
  const accuracyVerdicts = accuracyVerdictBreakdown(
    [...sScores.values()],
    [...dScores.values()],
  );

  return {
    generatedAt: new Date().toISOString(),
    pairs: cells.sjSr.length,
    dimensions,
    accuracyVerdicts,
    missingSJudge,
    missingDJudge,
  };
}

const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

export function renderFamilyStatsMarkdown(report: FamilyStatsReport): string {
  const lines: string[] = [];
  lines.push(
    `Pairs: ${report.pairs} (missing S judge: ${report.missingSJudge}, missing D judge: ${report.missingDJudge})`,
    "",
    "| Dimension | n | familyBias | 95% CI | harshness (S−D) |",
    "| --------- | - | ---------- | ------ | ---------------- |",
  );
  for (const d of report.dimensions) {
    lines.push(
      `| ${d.dimension} | ${d.n} | ${f(d.familyBias)} | [${f(d.ci95.lo)}, ${f(d.ci95.hi)}] | ${f(d.harshness)} |`,
    );
  }
  lines.push(
    "",
    "familyBias CI 不含零 ⇒ 同族偏差成立(判官偏爱同族回复);harshness = 全体 S判−D判 均值,单独反映判官严宽度,不参与 familyBias 判定。",
    "",
    "| Judge | scored items w/ factAudit | verified | refuted | unsupported | mean/item (v/r/u) |",
    "| ----- | ------------------------- | -------- | ------- | ------------ | ------------------ |",
  );
  for (const [label, v] of [
    ["S judge", report.accuracyVerdicts.sJudge],
    ["D judge", report.accuracyVerdicts.dJudge],
  ] as const) {
    lines.push(
      `| ${label} | ${v.n} | ${v.verified} | ${v.refuted} | ${v.unsupported} | ${v.meanPerItem.verified.toFixed(2)}/${v.meanPerItem.refuted.toFixed(2)}/${v.meanPerItem.unsupported.toFixed(2)} |`,
    );
  }
  return lines.join("\n");
}
