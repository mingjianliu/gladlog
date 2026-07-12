 
/**
 * streamCli.ts — CLI entry for the streamer (Windows side): watch the WoW log
 * dir and write segments to the storage folder (a Google Drive folder via the
 * localDir adapter). Config: --config stream.config.json.
 */
import { main } from "./index";

main().catch((e) => {
  console.error(`[log-pipeline] fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
