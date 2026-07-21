/* eslint-disable no-console */
/**
 * CLI: Measure inter-judge variance on the calibration suite.
 *
 * Complements checkCalibration (defect detection) by answering the other
 * question: do two judges reading the SAME material agree? Uses the
 * response-preserving perturbation triplets as free replicates — see
 * src/judge/judgeVariance.ts for the premise and the two metrics.
 *
 * Reads:
 *   baseDir/judge-calibration/calibration-manifest.json
 *   baseDir/judge-calibration/<scoresDir>/<caseId>.json
 * Writes:
 *   baseDir/judge-calibration/judge-variance-report.md
 *
 * Determinism: the report prints an inputHash per scores dir. Subagents rewrite
 * score files after self-checking, so run this TWICE and only use the numbers
 * when both runs print the same hash.
 *
 * Usage:
 *   tsx packages/eval/scripts/judgeVariance.ts --run <runId> --dirs scores,scores-det,scores-det2
 */

import path from "path";
import fs from "fs-extra";
import {
  measureJudgeVariance,
  formatVarianceReport,
} from "../src/judge/judgeVariance";
import { resolveEvalHome, runDir } from "../src/evalHome";

function parseArgs(): { run: string; dirs: string[] } {
  const args = process.argv.slice(2);
  let run = "";
  let dirs = "scores";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run") run = args[i + 1];
    if (args[i] === "--dirs") dirs = args[i + 1];
  }
  if (!run) {
    console.error("Error: --run <runId> is required");
    process.exit(1);
  }
  return {
    run,
    dirs: dirs
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

async function main() {
  const { run: runId, dirs } = parseArgs();
  const evalHome = resolveEvalHome();
  const baseDir = process.env.BASE_DIR ?? runDir(evalHome, runId);

  const reports = [];
  for (const dir of dirs) {
    reports.push(await measureJudgeVariance(baseDir, dir));
  }

  const md = formatVarianceReport(reports);
  const out = path.join(
    baseDir,
    "judge-calibration",
    "judge-variance-report.md",
  );
  await fs.writeFile(out, md, "utf8");
  console.log(md);
  console.log(`\nReport written to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
