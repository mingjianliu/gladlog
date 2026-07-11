/* eslint-disable no-console */
/**
 * CLI: Build judge calibration suite
 *
 * Generates synthetic-defect calibration cases for LLM judge evaluation.
 * Reads a run's prompt/response corpus and creates perturbed variants with
 * known defects, storing them in judge-calibration/ for blind scoring.
 *
 * Usage:
 *   tsx packages/eval/scripts/buildCalibration.ts \
 *     --run <runId> \
 *     [--source-count <number>] \
 *     [--seed <number>]
 */

import { buildCalibrationSuite } from "../src/judge/buildCalibrationSuite";
import { resolveEvalHome, runDir } from "../src/evalHome";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(): {
  run: string;
  sourceCount: number;
  seed: number;
} {
  const args = process.argv.slice(2);
  const result = {
    run: "",
    sourceCount: 5,
    seed: 42,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run") result.run = args[i + 1];
    else if (args[i] === "--source-count")
      result.sourceCount = Number(args[i + 1]);
    else if (args[i] === "--seed") result.seed = Number(args[i + 1]);
  }

  if (!result.run) {
    console.error("Error: --run <runId> is required");
    process.exit(1);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { run: runId, sourceCount, seed } = parseArgs();

  console.log("Building calibration suite");
  console.log();

  // Resolve base directory
  const evalHome = resolveEvalHome();
  const baseDir = process.env.BASE_DIR ?? runDir(evalHome, runId);

  console.log(`Base directory: ${baseDir}`);
  console.log(`Source count: ${sourceCount}`);
  console.log(`Seed: ${seed}`);
  console.log();

  // Build suite
  console.log("Building suite...");
  const cases = await buildCalibrationSuite(baseDir, {
    sourceCount,
    seed,
  });

  // Report results
  console.log();
  console.log(`✓ Cases generated: ${cases.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
