/* eslint-disable no-console */
/**
 * checkJudgeCalibration.ts
 *
 * Grades the LLM judge against the synthetic-defect suite built by
 * buildJudgeCalibrationSuite.ts. Ground truth is known because we injected the
 * defects ourselves — no human annotation involved.
 *
 * Exception: dimensions in DET_GATE_DIMENSIONS (sufficiency) are adjudicated by
 * the deterministic coverage gate, not judge scores — see the constant's doc.
 *
 * For judge-adjudicated dimensions, a perturbed case counts as *detected* only
 * when it clears a discriminant-validity bar, not mere sensitivity:
 *   (1) Sensitivity — the TARGETED dimension drops below the unmodified sibling
 *       (same source ordinal) by at least DELTA_FLOOR. The floor separates a
 *       real defect signal from judge noise / integer-rubric ties.
 *   (2) Specificity — every UNtargeted dimension stays within SPECIFICITY_TOL of
 *       the original. Without this, a degenerate judge that lowers *every*
 *       dimension whenever the text merely changed passes trivially while
 *       carrying zero dimension-specific signal.
 * A dimension backed by fewer than MIN_PAIRS scoreable pairs is INSUFFICIENT
 * (not PASS): the across-dimension conjunction must have real trials behind it.
 *
 * Reads:
 *   BASE_DIR/judge-calibration/calibration-manifest.json
 *   BASE_DIR/judge-calibration/scores/<caseId>.json   (standard 7-dim format)
 * Writes:
 *   BASE_DIR/judge-calibration/calibration-report.md
 *
 * Exit code 1 if any dimension's detection rate is below PASS_THRESHOLD
 * (default 0.8) or the dimension is INSUFFICIENT/NO DATA: a judge that cannot
 * discriminately see planted defects must not be trusted to grade real
 * prompt-builder changes.
 *
 * Tunables (opts or env): PASS_THRESHOLD, MIN_PAIRS (4), DELTA_FLOOR (1),
 * SPECIFICITY_TOL (1 — integer-rubric default; 0 only for continuous rubrics,
 * where 1-pt co-movement is signal rather than quantization noise).
 */

import fs from "fs-extra";
import path from "path";

import type { CoverageManifest } from "../quality/coverageManifest";
import { checkFriendlyDeaths } from "../quality/promptQualityCheck";

/**
 * sufficiency 由确定性覆盖门裁决,不再看判官盲分。
 *
 * 依据(docs/BACKLOG.md 14.2 终稿,五次独立测量):删光 prompt 里全部死亡行,
 * 判官 10 对里 8 对零反应(5→5 五次),检出率 40% → 30% → 20%,三轮 rubric
 * 改动零作用 —— 判官只看得见 prompt 里有什么,看不见构建器没放进来什么,
 * 结构性盲区。`eval-ab.md` 本来就规定该维以确定性指标为准,这里把校准侧
 * 也对齐:对 removed-deaths 对子直接跑 `checkFriendlyDeaths`(与生产门规
 * 同一谓词),original 干净且 perturbed 报缺 → 检出。
 */
const DET_GATE_DIMENSIONS = new Set(["sufficiency"]);

/**
 * 构造性耦合:按扰动的**构造**必然带动的未目标维度,豁免特异性检查。
 *
 * 这不是放水,是修掉一个前提错误。特异性检查隐含假设「扰动是维度正交的」——
 * 判官若同时动了别的维,就是在对「文本变了」反应而非对具体缺陷反应。但
 * `removed-deaths` 删的是 **prompt** 里的死亡行,而 response **保持不动**:
 * 回复里关于那次死亡的主张于是真的不再被 prompt 支持,accuracy 本就该掉。
 * 判官是在正确地做事,却被规则罚 —— 前提不成立,不是判官不合格。
 *
 * 实测依据(2026-07-20 全语料校准,1245 场语料 @ 92f96d2,40 件套件 seed 42):
 * 11 个未检出里 9 个是特异性而非敏感性;逐条查渗漏维,10 条里 8 条是同一个
 * `accuracy 5→3`。sufficiency 因此被压到 20%,而其真实敏感性是 3/5=60%。
 *
 * **豁免必须窄 —— 只给内容被删除的扰动。** 其余六类都不在此列,理由逐条:
 *   - `shuffled-events` 只乱序,内容完整保留,每条主张仍可查证 → accuracy 掉分
 *     是判官放弃查证,不是构造使然,必须继续判违规;
 *   - `duplicated-noise` / `severity-labels` 只增不减,不影响可查证性;
 *   - `fabricated-claim` / `wrong-outcome` / `trivia-focus` 改的是 response,
 *     prompt 侧维度不受影响;其中 wrong-outcome 渗到 accuracy 是 rubric 独立性
 *     规则应用不一致(见 eval-baseline.md),属判官问题,不豁免。
 *
 * 加新扰动类时:先问「不改判官的前提下,这个维度会不会必然动」。答案是否,
 * 就别往这张表里加 —— 每加一条都在削弱这道门的裁决力。
 */
const COUPLED_BY_CONSTRUCTION: Record<string, readonly string[]> = {
  "removed-deaths": ["accuracy"],
};

interface CalibrationCase {
  caseId: string;
  sourceOrdinal: number;
  matchId: string;
  perturbation: string;
  targetDimension: string | null;
  perturbationDetail: string;
}

interface ScoreFile {
  prompt: Record<string, number | string>;
  response: Record<string, number | string>;
}

/** Parse a raw score value to a number, or null if it is not a real number.
 * Guards the JS footgun Number("") === Number("  ") === 0: an empty or
 * whitespace-only string is an absent score, not a zero. */
function toScore(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const num = Number(value);
  return !isNaN(num) ? num : null;
}

function dimensionScore(score: ScoreFile, dimension: string): number | null {
  return toScore(score.prompt?.[dimension] ?? score.response?.[dimension]);
}

/** Every dimension key that carries a numeric score in this file (prompt or
 * response side). Used to find the UNtargeted dimensions for the specificity
 * check. */
function scoredDimensions(score: ScoreFile): string[] {
  const keys = new Set<string>();
  for (const side of [score.prompt, score.response]) {
    if (!side) continue;
    for (const [k, v] of Object.entries(side)) {
      if (toScore(v) !== null) keys.add(k);
    }
  }
  return [...keys];
}

export async function checkCalibration(
  baseDir: string,
  opts?: {
    passThreshold?: number;
    scoresSubdir?: string;
    /** A dimension with fewer scoreable pairs than this is INSUFFICIENT, not
     * PASS — the conjunction across dimensions must have real trials behind it. */
    minPairs?: number;
    /** The targeted dimension must drop by at least this much to count as
     * detected (separates a real defect signal from judge noise / ties). */
    deltaFloor?: number;
    /** UNtargeted dimensions may move by at most this much; a case that also
     * moves orthogonal dimensions is a judge reacting to "text changed", not to
     * the specific defect — discriminant validity, not raw sensitivity. */
    specificityTol?: number;
  },
): Promise<{
  pass: boolean;
  failures: { caseId: string; dimension: string; reason: string }[];
}> {
  const suiteDir = path.join(baseDir, "judge-calibration");
  const passThreshold =
    opts?.passThreshold ?? Number(process.env.PASS_THRESHOLD ?? 0.8);
  const scoresSubdir = opts?.scoresSubdir ?? process.env.SCORES_DIR ?? "scores";
  const minPairs = opts?.minPairs ?? Number(process.env.MIN_PAIRS ?? 4);
  const deltaFloor = opts?.deltaFloor ?? Number(process.env.DELTA_FLOOR ?? 1);
  // Default 1, not 0: on an integer 1–5 rubric even a calibrated judge wobbles untargeted
  // dims by ±1 (empirical, 2026-07-14: a judge with strong sensitivity — 31/35 planted
  // defects detected — scored 1/40 at TOL=0 purely on 1-pt co-movement). TOL=0 measures
  // integer-quantization noise, not discriminant validity; keep 0 only for continuous rubrics.
  const specificityTol =
    opts?.specificityTol ?? Number(process.env.SPECIFICITY_TOL ?? 1);

  const manifestPath = path.join(suiteDir, "calibration-manifest.json");
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(
      `No calibration manifest at ${manifestPath} — run buildCalibrationSuite first.`,
    );
  }
  const manifest = (await fs.readJson(manifestPath)) as {
    seed: number;
    cases: CalibrationCase[];
  };

  const scores = new Map<string, ScoreFile>();
  let missingScores = 0;
  for (const c of manifest.cases) {
    const scorePath = path.join(suiteDir, scoresSubdir, `${c.caseId}.json`);
    if (await fs.pathExists(scorePath)) {
      try {
        scores.set(c.caseId, (await fs.readJson(scorePath)) as ScoreFile);
      } catch (err) {
        console.error(
          `Error parsing JSON in score file ${scorePath}: ${err instanceof Error ? err.message : err}`,
        );
        missingScores++;
      }
    } else {
      missingScores++;
    }
  }
  if (missingScores > 0) {
    console.warn(
      `WARNING: ${missingScores}/${manifest.cases.length} cases have no score file yet.`,
    );
  }

  const coverageRatio =
    manifest.cases.length > 0
      ? (manifest.cases.length - missingScores) / manifest.cases.length
      : 0;
  const MIN_COVERAGE = 0.8;
  if (coverageRatio < MIN_COVERAGE && !process.env.BYPASS_COVERAGE) {
    console.error(
      `FAIL: Insufficient score coverage. Scored ${manifest.cases.length - missingScores}/${manifest.cases.length} cases (${(coverageRatio * 100).toFixed(1)}%). Minimum required is ${(MIN_COVERAGE * 100).toFixed(0)}%. Set BYPASS_COVERAGE=true to ignore.`,
    );
    process.exit(1);
  }

  const originals = new Map<number, CalibrationCase>();
  for (const c of manifest.cases)
    if (c.perturbation === "none") originals.set(c.sourceOrdinal, c);

  /** 覆盖门:读某个 case 的 prompt,对着该源 ordinal 的 ground-truth manifest
   * 数缺失的友方死亡。返回 null = 无法裁决(manifest 缺失或该场没有友方死亡,
   * 门无管辖权)。 */
  const gateMissingCount = async (
    caseId: string,
    sourceOrdinal: number,
  ): Promise<{ missing: number; total: number } | null> => {
    const manifestFile = path.join(
      baseDir,
      "manifests",
      `${String(sourceOrdinal).padStart(3, "0")}.json`,
    );
    if (!(await fs.pathExists(manifestFile))) {
      console.warn(
        `WARNING: no coverage manifest at ${manifestFile} — sufficiency det-gate cannot run for ordinal ${sourceOrdinal}. Rebuild the corpus (buildCorpus writes manifests/NNN.json).`,
      );
      return null;
    }
    const coverage = (await fs.readJson(manifestFile)) as CoverageManifest;
    const total = coverage.deaths.filter(
      (d) => d.reaction === "friendly",
    ).length;
    if (total === 0) return null; // 没有友方死亡 → removed-deaths 删的只是敌方行,门无管辖权
    const promptText = await fs.readFile(
      path.join(suiteDir, "cases", caseId, "prompt.txt"),
      "utf8",
    );
    const result = checkFriendlyDeaths(promptText.split("\n"), coverage);
    return { missing: result.missing.length, total };
  };

  interface PairResult {
    caseId: string;
    perturbation: string;
    dimension: string;
    sourceOrdinal: number;
    originalScore: number | null;
    perturbedScore: number | null;
    detected: boolean | null; // null = unscoreable
    /** Why an otherwise-lowered case was still not counted, for the report. */
    missReason: "floor" | "specificity" | "det-gate" | null;
    maxUntargetedDrift: number | null;
    /** 漂移最大的那个未目标维度的名字 —— 报告里点名,免得人工去比对分数文件。 */
    driftDimension: string | null;
    detail: string;
  }
  const pairs: PairResult[] = [];

  for (const c of manifest.cases) {
    if (c.perturbation === "none" || !c.targetDimension) continue;
    const original = originals.get(c.sourceOrdinal);
    const originalScore = original ? scores.get(original.caseId) : undefined;
    const perturbedScore = scores.get(c.caseId);
    const orig = originalScore
      ? dimensionScore(originalScore, c.targetDimension)
      : null;
    const pert = perturbedScore
      ? dimensionScore(perturbedScore, c.targetDimension)
      : null;

    if (DET_GATE_DIMENSIONS.has(c.targetDimension)) {
      // 确定性覆盖门裁决:original 必须干净、perturbed 必须报缺。判官盲分
      // (orig/pert)照旧记录,仅供陈列 —— 无裁决权(eval-ab.md)。
      const origGate = original
        ? await gateMissingCount(original.caseId, c.sourceOrdinal)
        : null;
      const pertGate = await gateMissingCount(c.caseId, c.sourceOrdinal);
      const scoreable = origGate !== null && pertGate !== null;
      const detected = scoreable
        ? origGate.missing === 0 && pertGate.missing > 0
        : null;
      pairs.push({
        caseId: c.caseId,
        perturbation: c.perturbation,
        dimension: c.targetDimension,
        sourceOrdinal: c.sourceOrdinal,
        originalScore: orig,
        perturbedScore: pert,
        detected,
        missReason: detected === false ? "det-gate" : null,
        maxUntargetedDrift: null,
        driftDimension: null,
        detail: scoreable
          ? `${c.perturbationDetail} | det-gate: original missing ${origGate.missing}/${origGate.total}, perturbed missing ${pertGate.missing}/${pertGate.total}`
          : `${c.perturbationDetail} | det-gate unscoreable (no manifest or no friendly deaths)`,
      });
      continue;
    }

    let detected: boolean | null = null;
    let missReason: "floor" | "specificity" | null = null;
    let maxUntargetedDrift: number | null = null;
    let driftDimension: string | null = null;

    if (orig !== null && pert !== null && originalScore && perturbedScore) {
      // (1) Sensitivity: the targeted dimension must drop by at least the floor.
      const targetedDrop = orig - pert;
      const sensitive = targetedDrop >= deltaFloor;

      // (2) Specificity: the UNtargeted dimensions must stay within tolerance.
      // A judge that also moves orthogonal dimensions is reacting to "the text
      // changed", not to the planted defect — so it earns no credit here. The
      // control (none) case defines which dimensions must be present; if the
      // perturbed case OMITS one, we cannot confirm it stayed put — that
      // incompleteness is itself a specificity violation, not a free pass.
      const untargeted = new Set<string>(scoredDimensions(originalScore));
      untargeted.delete(c.targetDimension);
      const exempt = new Set<string>(
        COUPLED_BY_CONSTRUCTION[c.perturbation] ?? [],
      );
      let drift = 0;
      let specificityViolated = false;
      for (const d of untargeted) {
        if (exempt.has(d)) continue; // 构造性耦合 —— 见 COUPLED_BY_CONSTRUCTION
        const od = dimensionScore(originalScore, d);
        const pd = dimensionScore(perturbedScore, d);
        if (od === null) continue; // not part of the control baseline
        if (pd === null) {
          specificityViolated = true; // untargeted dim dropped from the output
          continue;
        }
        const delta = Math.abs(od - pd);
        if (delta > drift) {
          drift = delta;
          driftDimension = d;
        }
        if (delta > specificityTol) specificityViolated = true;
      }
      maxUntargetedDrift = drift;

      detected = sensitive && !specificityViolated;
      if (!detected) missReason = !sensitive ? "floor" : "specificity";
    }

    pairs.push({
      caseId: c.caseId,
      perturbation: c.perturbation,
      dimension: c.targetDimension,
      sourceOrdinal: c.sourceOrdinal,
      originalScore: orig,
      perturbedScore: pert,
      detected,
      missReason,
      maxUntargetedDrift,
      driftDimension,
      detail: c.perturbationDetail,
    });
  }

  const byDimension = new Map<string, PairResult[]>();
  for (const p of pairs) {
    const list = byDimension.get(p.dimension) ?? [];
    list.push(p);
    byDimension.set(p.dimension, list);
  }

  const lines: string[] = [];
  lines.push("# Judge Calibration Report");
  lines.push("");
  lines.push(
    `**Generated:** ${new Date().toISOString().slice(0, 10)} | **Seed:** ${manifest.seed} | **Pass threshold:** ${passThreshold} | **Min pairs:** ${minPairs} | **Delta floor:** ${deltaFloor} | **Specificity tol:** ${specificityTol}`,
  );
  lines.push("");
  lines.push(
    "A pair is *detected* only when the judge (a) scored the perturbed variant lower than the",
  );
  lines.push(
    `unmodified original on the targeted dimension by at least ${deltaFloor} (sensitivity), AND (b) kept every`,
  );
  lines.push(
    `other dimension within ${specificityTol} of the original (specificity). A dimension with fewer than`,
  );
  lines.push(
    `${minPairs} scoreable pairs is INSUFFICIENT: too few trials to certify. Undetected or insufficient`,
  );
  lines.push(
    "dimensions mean the judge's scores there carry no trustworthy signal.",
  );
  lines.push("");
  lines.push(
    "**sufficiency is adjudicated by the deterministic coverage gate** (checkFriendlyDeaths",
  );
  lines.push(
    "against the ground-truth manifest), not by judge blind scores — the judge structurally",
  );
  lines.push(
    "cannot see what the builder omitted (BACKLOG 14.2, five independent measurements).",
  );
  lines.push(
    "Judge scores for sufficiency pairs are shown for reference only.",
  );
  lines.push("");
  lines.push(
    "| Dimension | Perturbation | Pairs | Detected | Rate | Verdict |",
  );
  lines.push(
    "| --------- | ------------ | ----- | -------- | ---- | ------- |",
  );

  let anyFail = false;
  const dimIssues: { dimension: string; reason: string }[] = [];
  for (const [dimension, list] of [...byDimension.entries()].sort()) {
    const scoreable = list.filter((p) => p.detected !== null);
    const detected = scoreable.filter((p) => p.detected === true).length;
    const rate = scoreable.length > 0 ? detected / scoreable.length : 0;
    const verdict =
      scoreable.length === 0
        ? "NO DATA"
        : scoreable.length < minPairs
          ? "INSUFFICIENT"
          : rate >= passThreshold
            ? "PASS"
            : "FAIL";
    if (verdict !== "PASS") anyFail = true;
    if (verdict === "NO DATA" || verdict === "INSUFFICIENT")
      dimIssues.push({
        dimension,
        reason: `${verdict}: only ${scoreable.length} scoreable pair(s), need >= ${minPairs}`,
      });
    const perturbationLabel = DET_GATE_DIMENSIONS.has(dimension)
      ? `${list[0].perturbation} (det-gate)`
      : list[0].perturbation;
    lines.push(
      `| ${dimension} | ${perturbationLabel} | ${scoreable.length} | ${detected} | ${(rate * 100).toFixed(0)}% | ${verdict} |`,
    );
  }

  lines.push("");
  lines.push("## Pair Detail");
  lines.push("");
  lines.push(
    "| Dimension | Source | Original | Perturbed | maxΔother | 漂移维 | Detected | Injected defect |",
  );
  lines.push(
    "| --------- | ------ | -------- | --------- | --------- | -------- | --------------- |",
  );
  for (const p of pairs) {
    const detectedCell =
      p.detected === null
        ? "unscored"
        : p.detected
          ? "yes"
          : p.missReason === "specificity"
            ? "**NO (spec)**"
            : p.missReason === "det-gate"
              ? "**NO (det-gate)**"
              : "**NO**";
    lines.push(
      `| ${p.dimension} | ${String(p.sourceOrdinal).padStart(3, "0")} | ${p.originalScore ?? "—"} | ${p.perturbedScore ?? "—"} | ${p.maxUntargetedDrift ?? "—"} | ${p.driftDimension ?? "—"} | ${detectedCell} | ${p.detail} |`,
    );
  }
  lines.push("");
  lines.push(
    anyFail
      ? "**Verdict: FAIL — do not trust judge scores on the failing dimensions until the judge prompt/rubric is fixed and this suite passes.**"
      : "**Verdict: PASS — the judge detects all planted defect classes at or above threshold.**",
  );
  lines.push("");

  const reportPath = path.join(
    suiteDir,
    scoresSubdir === "scores"
      ? "calibration-report.md"
      : `calibration-report-${scoresSubdir}.md`,
  );
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\nReport written to ${reportPath}`);

  // Collect failures: undetected perturbed cases, plus dimensions with too few trials.
  const failures: { caseId: string; dimension: string; reason: string }[] = [];
  for (const p of pairs) {
    if (p.detected === false) {
      const why =
        p.missReason === "specificity"
          ? `also moved or dropped untargeted dimensions (maxΔother ${p.maxUntargetedDrift} on ${p.driftDimension ?? "?"}) — reacted to the change, not the defect`
          : p.missReason === "det-gate"
            ? `deterministic coverage gate did not flag the perturbed prompt (or flagged the original) — see pair detail`
            : `targeted score did not drop by >= ${deltaFloor}`;
      failures.push({
        caseId: p.caseId,
        dimension: p.dimension,
        reason: `Judge did not detect ${p.perturbation} (original ${p.originalScore}, perturbed ${p.perturbedScore}): ${why}`,
      });
    }
  }
  for (const issue of dimIssues) {
    failures.push({
      caseId: "",
      dimension: issue.dimension,
      reason: issue.reason,
    });
  }

  return { pass: !anyFail, failures };
}
