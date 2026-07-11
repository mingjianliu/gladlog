import { main } from "../src/quality/promptQualityCheck";
import { resolveEvalHome, runDir } from "../src/evalHome";

async function run() {
  // Parse --run <runId> from argv
  const runIndex = process.argv.indexOf("--run");
  if (runIndex !== -1 && runIndex + 1 < process.argv.length) {
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
