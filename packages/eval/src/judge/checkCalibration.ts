/* eslint-disable no-console */
/**
 * checkJudgeCalibration.ts
 *
 * Grades the LLM judge against the synthetic-defect suite built by
 * buildJudgeCalibrationSuite.ts. For every perturbed case, the judge's score
 * on the targeted dimension must be LOWER than its score for the unmodified
 * sibling case (same source ordinal). Ground truth is known because we
 * injected the defects ourselves — no human annotation involved.
 *
 * Reads:
 *   BASE_DIR/judge-calibration/calibration-manifest.json
 *   BASE_DIR/judge-calibration/scores/<caseId>.json   (standard 7-dim format)
 * Writes:
 *   BASE_DIR/judge-calibration/calibration-report.md
 *
 * Exit code 1 if any dimension's detection rate is below PASS_THRESHOLD
 * (default 0.8): a judge that cannot see planted defects must not be trusted
 * to grade real prompt-builder changes.
 */

import fs from 'fs-extra';
import path from 'path';

import { resolveRepoPath } from './resolveRepoPath';

const BASE_DIR = resolveRepoPath(process.env.BASE_DIR ?? 'packages/tools/local-batch/healer-eval');
const SUITE_DIR = path.join(BASE_DIR, 'judge-calibration');
const PASS_THRESHOLD = Number(process.env.PASS_THRESHOLD ?? 0.8);
/** Alternate scores subdir under the suite (e.g. SCORES_DIR=scores-model2 for a second-model pass). */
const SCORES_SUBDIR = process.env.SCORES_DIR ?? 'scores';

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

function dimensionScore(score: ScoreFile, dimension: string): number | null {
  const value = score.prompt?.[dimension] ?? score.response?.[dimension];
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return !isNaN(num) ? num : null;
}

async function main() {
  const manifestPath = path.join(SUITE_DIR, 'calibration-manifest.json');
  if (!(await fs.pathExists(manifestPath))) {
    console.error(`No calibration manifest at ${manifestPath} — run start:buildJudgeCalibrationSuite first.`);
    process.exit(1);
  }
  const manifest = (await fs.readJson(manifestPath)) as { seed: number; cases: CalibrationCase[] };

  const scores = new Map<string, ScoreFile>();
  let missingScores = 0;
  for (const c of manifest.cases) {
    const scorePath = path.join(SUITE_DIR, SCORES_SUBDIR, `${c.caseId}.json`);
    if (await fs.pathExists(scorePath)) {
      try {
        scores.set(c.caseId, (await fs.readJson(scorePath)) as ScoreFile);
      } catch (err) {
        console.error(`Error parsing JSON in score file ${scorePath}: ${err instanceof Error ? err.message : err}`);
        missingScores++;
      }
    } else {
      missingScores++;
    }
  }
  if (missingScores > 0) {
    console.warn(`WARNING: ${missingScores}/${manifest.cases.length} cases have no score file yet.`);
  }

  const coverageRatio = manifest.cases.length > 0 ? (manifest.cases.length - missingScores) / manifest.cases.length : 0;
  const MIN_COVERAGE = 0.8;
  if (coverageRatio < MIN_COVERAGE && !process.env.BYPASS_COVERAGE) {
    console.error(
      `FAIL: Insufficient score coverage. Scored ${manifest.cases.length - missingScores}/${manifest.cases.length} cases (${(coverageRatio * 100).toFixed(1)}%). Minimum required is ${(MIN_COVERAGE * 100).toFixed(0)}%. Set BYPASS_COVERAGE=true to ignore.`,
    );
    process.exit(1);
  }

  const originals = new Map<number, CalibrationCase>();
  for (const c of manifest.cases) if (c.perturbation === 'none') originals.set(c.sourceOrdinal, c);

  interface PairResult {
    perturbation: string;
    dimension: string;
    sourceOrdinal: number;
    originalScore: number | null;
    perturbedScore: number | null;
    detected: boolean | null; // null = unscoreable
    detail: string;
  }
  const pairs: PairResult[] = [];

  for (const c of manifest.cases) {
    if (c.perturbation === 'none' || !c.targetDimension) continue;
    const original = originals.get(c.sourceOrdinal);
    const originalScore = original ? scores.get(original.caseId) : undefined;
    const perturbedScore = scores.get(c.caseId);
    const orig = originalScore ? dimensionScore(originalScore, c.targetDimension) : null;
    const pert = perturbedScore ? dimensionScore(perturbedScore, c.targetDimension) : null;
    pairs.push({
      perturbation: c.perturbation,
      dimension: c.targetDimension,
      sourceOrdinal: c.sourceOrdinal,
      originalScore: orig,
      perturbedScore: pert,
      detected: orig !== null && pert !== null ? pert < orig : null,
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
  lines.push('# Judge Calibration Report');
  lines.push('');
  lines.push(
    `**Generated:** ${new Date().toISOString().slice(0, 10)} | **Seed:** ${manifest.seed} | **Pass threshold:** ${PASS_THRESHOLD}`,
  );
  lines.push('');
  lines.push('A pair is *detected* when the judge scored the perturbed variant strictly lower than the');
  lines.push('unmodified original on the targeted dimension. Undetected pairs mean the judge cannot see');
  lines.push('that class of defect — its scores on that dimension carry no signal.');
  lines.push('');
  lines.push('| Dimension | Perturbation | Pairs | Detected | Rate | Verdict |');
  lines.push('| --------- | ------------ | ----- | -------- | ---- | ------- |');

  let anyFail = false;
  for (const [dimension, list] of [...byDimension.entries()].sort()) {
    const scoreable = list.filter((p) => p.detected !== null);
    const detected = scoreable.filter((p) => p.detected === true).length;
    const rate = scoreable.length > 0 ? detected / scoreable.length : 0;
    const verdict = scoreable.length === 0 ? 'NO DATA' : rate >= PASS_THRESHOLD ? 'PASS' : 'FAIL';
    if (verdict !== 'PASS') anyFail = true;
    lines.push(
      `| ${dimension} | ${list[0].perturbation} | ${scoreable.length} | ${detected} | ${(rate * 100).toFixed(0)}% | ${verdict} |`,
    );
  }

  lines.push('');
  lines.push('## Pair Detail');
  lines.push('');
  lines.push('| Dimension | Source | Original | Perturbed | Detected | Injected defect |');
  lines.push('| --------- | ------ | -------- | --------- | -------- | --------------- |');
  for (const p of pairs) {
    lines.push(
      `| ${p.dimension} | ${String(p.sourceOrdinal).padStart(3, '0')} | ${p.originalScore ?? '—'} | ${p.perturbedScore ?? '—'} | ${
        p.detected === null ? 'unscored' : p.detected ? 'yes' : '**NO**'
      } | ${p.detail} |`,
    );
  }
  lines.push('');
  lines.push(
    anyFail
      ? '**Verdict: FAIL — do not trust judge scores on the failing dimensions until the judge prompt/rubric is fixed and this suite passes.**'
      : '**Verdict: PASS — the judge detects all planted defect classes at or above threshold.**',
  );
  lines.push('');

  const reportPath = path.join(
    SUITE_DIR,
    SCORES_SUBDIR === 'scores' ? 'calibration-report.md' : `calibration-report-${SCORES_SUBDIR}.md`,
  );
  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  console.log(`\nReport written to ${reportPath}`);
  if (anyFail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
