// Show the daily pull's recent runs, today's quota state and the cookie's age.
//   npm run logs:daily:status
import fs from "fs-extra";
import os from "os";
import path from "path";

import type { RunRecord } from "../src/dailyPull";
import { type QuotaState, nextUtcMidnight, quotaAlreadySpent } from "../src/pvpLogFetch";

const EVAL_HOME =
  process.env.GLADLOG_EVAL_HOME ??
  path.join(os.homedir(), "code/gladlog-eval-private");
const DOWNLOADS = path.join(EVAL_HOME, "downloads");
const QUOTA_STATE = path.join(DOWNLOADS, "wal-quota-state.json");
const RUN_LOG = path.join(DOWNLOADS, "daily-pull", "runs.jsonl");
const COOKIE_FILE =
  process.env.WAL_COOKIE_FILE ??
  path.join(os.homedir(), ".gladlog", "wal-session-cookie");
const N = Number(process.env.N ?? 7);

const state: QuotaState | undefined = fs.pathExistsSync(QUOTA_STATE)
  ? fs.readJsonSync(QUOTA_STATE)
  : undefined;
console.log(
  state
    ? `quota: ${state.downloadsUsedToday}/${state.downloadsQuota} on UTC ${state.utcDay}${quotaAlreadySpent(state) ? " (spent; resets " + nextUtcMidnight().toISOString() + ")" : ""}`
    : "quota: no state recorded yet",
);
if (fs.pathExistsSync(COOKIE_FILE)) {
  const ageDays = (Date.now() - fs.statSync(COOKIE_FILE).mtimeMs) / 86_400_000;
  console.log(`cookie: ${COOKIE_FILE}, written ${ageDays.toFixed(1)} days ago`);
} else {
  console.log(`cookie: missing (${COOKIE_FILE})`);
}
const lines = fs.pathExistsSync(RUN_LOG)
  ? fs.readFileSync(RUN_LOG, "utf8").trim().split("\n").filter(Boolean)
  : [];
console.log(`runs: ${lines.length} recorded, last ${Math.min(N, lines.length)}:`);
for (const line of lines.slice(-N)) {
  const r: RunRecord = JSON.parse(line);
  const fresh = r.steps.reduce((n, s) => n + s.fresh, 0);
  const steps = r.steps.map((s) => `${s.bracket} ${s.fresh}/${s.limit}`).join(", ") || r.note || "-";
  const q = r.quotaAfter ? `${r.quotaAfter.downloadsUsedToday}/${r.quotaAfter.downloadsQuota}` : "?";
  const drive = r.driveSync ? (r.driveSync.exit === 0 ? "drive ok" : "drive FAILED") : "drive -";
  console.log(`  ${r.startedAt.slice(0, 16)}Z  ${r.status.padEnd(12)} ${String(fresh).padStart(2)} new  quota ${q}  ${drive.padEnd(12)}  ${steps}`);
}
const last = lines.length ? (JSON.parse(lines[lines.length - 1]) as RunRecord) : undefined;
if (last?.driveSync && last.driveSync.exit !== 0) {
  console.log("\n⚠ the last run did not reach Google Drive — rerun `npx tsx scripts/syncPvpLogsToDrive.ts` (incremental).");
}
if (last?.status === "auth-expired") {
  console.log("\n⚠ the last run found the Battle.net session expired — re-login and update the cookie file.");
}
