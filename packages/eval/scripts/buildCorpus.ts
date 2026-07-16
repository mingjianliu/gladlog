/* eslint-disable no-console */
/**
 * CLI: Build healer prompt corpus from local WoW combat logs
 *
 * Reads a manifest of log file paths, parses each with GladLogParser,
 * extracts healer-owner combats, and generates prompt corpus.
 *
 * Usage:
 *   tsx packages/eval/scripts/buildCorpus.ts \
 *     --manifest <path> \
 *     --run <runId>
 */

import fs from "fs-extra";
import { buildCorpus } from "../src/corpus/buildCorpus";
import { resolveEvalHome, runDir } from "../src/evalHome";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(): {
  manifest: string;
  run: string;
  owner: "healer" | "dps";
} {
  const args = process.argv.slice(2);
  const result = {
    manifest: "",
    run: "",
    owner: "healer" as "healer" | "dps",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") result.manifest = args[i + 1];
    else if (args[i] === "--run") result.run = args[i + 1];
    else if (args[i] === "--owner") {
      if (args[i + 1] !== "healer" && args[i + 1] !== "dps") {
        console.error("Error: --owner must be healer|dps");
        process.exit(1);
      }
      result.owner = args[i + 1] as "healer" | "dps";
    }
  }

  if (!result.manifest) {
    console.error("Error: --manifest <path> is required");
    process.exit(1);
  }

  if (!result.run) {
    console.error("Error: --run <runId> is required");
    process.exit(1);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { manifest: manifestPath, run: runId, owner } = parseArgs();

  console.log(`Building ${owner} prompt corpus from local logs`);
  console.log();

  // 1. Read manifest
  console.log(`Reading manifest from ${manifestPath}...`);
  let logPaths: string[] = [];
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    logPaths = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    console.error(`Failed to read manifest: ${err}`);
    process.exit(1);
  }

  console.log(`  ${logPaths.length} log file(s) to process`);
  console.log();

  // 2. Resolve output directory
  const evalHome = resolveEvalHome();
  const outDir = runDir(evalHome, runId);

  console.log(`Output directory: ${outDir}`);
  console.log();

  // 3. Build corpus
  console.log("Building corpus...");
  const { entries, fingerprint } = await buildCorpus({
    logPaths,
    outDir,
    ownerFilter: owner,
  });

  // 4. Report results
  console.log();
  console.log(`✓ Entries: ${entries.length}`);
  console.log(`✓ Fingerprint: ${fingerprint}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
