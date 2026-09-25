/**
 * CLI: hindsightScan — predicate self-test against real corpus menus, or a
 * smoke recheck of captured {eventIds, candidates} lines.
 *
 * Usage:
 *   tsx packages/eval/scripts/hindsightScan.ts \
 *     --synthesize --run <runId> --manifest <path/to/manifest.txt> [--limit 20]
 *   tsx packages/eval/scripts/hindsightScan.ts --check <jsonl>
 *
 * --run resolves the same runDir(evalHome, runId) every other CLI in this
 * package uses (buildCorpus.ts/qualityCheck.ts); --manifest is the raw
 * combat-log path list buildCorpus.ts itself takes — hindsightScan re-parses
 * those logs (candidateMenu.ts) and joins them back to the run's index.json
 * by matchId, the same two-input shape positioningScan.ts uses (BASE_DIR +
 * MANIFEST) to get both a built corpus's ordinals and freshly-parsed
 * candidates in the same pass.
 */
import { resolveEvalHome, runDir } from "../src/evalHome";
import { runCheck, runSynthesize } from "../src/quality/hindsightScan";
import { ensureAnalysisData } from "@gladlog/analysis";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  await ensureAnalysisData();
  if (process.argv.includes("--synthesize")) {
    const runId = arg("--run");
    const manifestPath = arg("--manifest");
    if (!runId || !manifestPath) {
      console.error(
        "Usage: hindsightScan --synthesize --run <runId> --manifest <path> [--limit N]",
      );
      process.exit(1);
    }
    const limitArg = arg("--limit");
    const baseDir = runDir(resolveEvalHome(), runId);
    await runSynthesize({
      baseDir,
      manifestPath,
      limit: limitArg ? Number(limitArg) : undefined,
    });
    return;
  }

  const checkPath = arg("--check");
  if (checkPath) {
    await runCheck(checkPath);
    return;
  }

  console.error(
    "Usage: hindsightScan --synthesize --run <runId> --manifest <path> | --check <jsonl>",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
