/* eslint-disable no-console */
import { cleanupAppliedSegments } from "./cleanup";
import { loadCollectorConfig } from "./collect/collectorConfig";
import { runCollection } from "./collectLogs";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const configPath = argValue("--config") ?? "collect.config.json";
  const config = loadCollectorConfig(configPath);
  console.warn(
    `[collect] watching ${config.storage.directory} → ${config.outputDir} every ${config.pollIntervalMs}ms`,
  );
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
  });
  for (;;) {
    try {
      await runCollection(config);
      if (config.cleanup) {
        await cleanupAppliedSegments({
          syncFolderRoot: config.storage.directory,
          logsDir: config.outputDir,
          cleanupAfterDays: 7,
        });
      }
    } catch (e) {
      console.error(
        `[collect] run error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (stop || config.pollIntervalMs <= 0) break;
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((e) => {
  console.error("[collect] fatal:", e);
  process.exit(1);
});
