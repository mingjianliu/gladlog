import { checkScoreProvenance } from "../src/provenance/checkScoreProvenance";
import { resolveEvalHome, runDir } from "../src/evalHome";

async function main() {
  const args = process.argv.slice(2);
  let runId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run") {
      runId = args[++i];
    }
  }

  if (!runId && !process.env.BASE_DIR) {
    console.error("Usage: checkProvenance --run <runId>  (or set BASE_DIR)");
    process.exit(1);
  }

  const runDirPath =
    process.env.BASE_DIR ?? runDir(resolveEvalHome(), runId as string);
  const result = checkScoreProvenance(runDirPath);

  console.log(`[checkProvenance] ${result.ok} ok, ${result.fail} fail`);
  for (const failure of result.failures) {
    console.log(`  ${failure.file}: ${failure.reason}`);
  }

  process.exit(result.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
