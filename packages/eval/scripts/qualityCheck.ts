import { resolveEvalHome, runDir } from "../src/evalHome";
import { main } from "../src/quality/promptQualityCheck";

async function run() {
  // Parse --run <runId> from argv; consistent with the other CLIs: the BASE_DIR
  // environment variable takes precedence (final review F4)
  const runIndex = process.argv.indexOf("--run");
  if (
    !process.env.BASE_DIR &&
    runIndex !== -1 &&
    runIndex + 1 < process.argv.length
  ) {
    const runId = process.argv[runIndex + 1];
    const evalHome = resolveEvalHome();
    process.env.BASE_DIR = runDir(evalHome, runId);
  }

  await main();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
