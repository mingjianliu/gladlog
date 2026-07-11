/* eslint-disable no-console */
/**
 * CLI: Check judge calibration
 *
 * Grades the LLM judge against the synthetic-defect suite. For every perturbed
 * case, the judge's score on the targeted dimension must be LOWER than its
 * score for the unmodified sibling (same source ordinal). Ground truth is known
 * because we injected the defects ourselves.
 *
 * Reads:
 *   baseDir/judge-calibration/calibration-manifest.json
 *   baseDir/judge-calibration/scores/<caseId>.json
 * Writes:
 *   baseDir/judge-calibration/calibration-report.md
 *
 * Exit code 0 if all dimensions pass threshold; exit code 1 if any dimension
 * fails (a judge that cannot see planted defects must not be trusted to grade
 * real prompt-builder changes).
 *
 * Usage:
 *   tsx packages/eval/scripts/checkCalibration.ts --run <runId>
 */

import { checkCalibration } from "../src/judge/checkCalibration";
import { resolveEvalHome, runDir } from "../src/evalHome";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(): {
  run: string;
} {
  const args = process.argv.slice(2);
  const result = {
    run: "",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run") result.run = args[i + 1];
  }

  if (!result.run) {
    console.error("Error: --run <runId> is required");
    process.exit(1);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { run: runId } = parseArgs();

  console.log("Checking calibration suite");
  console.log();

  // Resolve base directory
  const evalHome = resolveEvalHome();
  const baseDir = process.env.BASE_DIR ?? runDir(evalHome, runId);

  console.log(`Base directory: ${baseDir}`);
  console.log();

  // Check calibration
  const result = await checkCalibration(baseDir);

  // Report results
  console.log();
  if (result.pass) {
    console.log("✓ Calibration check PASSED");
    process.exit(0);
  } else {
    console.log("✗ Calibration check FAILED");
    console.log(`  ${result.failures.length} undetected cases`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
