import { main } from "../src/quality/promptQualityCheck";
import { resolveEvalHome, runDir } from "../src/evalHome";

async function run() {
  // Parse --run <runId> from argv;与其他 CLI 一致:BASE_DIR 环境变量优先(终审 F4)
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
