// Daily quota pull driver: 10 Solo Shuffle objects, then 3v3 for the rest of
// the day's 15, all at 2100+, any spec, any uploader (user ruling 2026-09-15).
// Runs fetchPvpLogs.ts once per step, records every run to
// downloads/daily-pull/runs.jsonl, and raises a macOS notification when the
// Battle.net session has expired so the operator knows to re-login.
//
//   npm run logs:daily            (this)
//   npm run logs:daily:status     (last runs + today's quota + cookie age)
//
// Careful by construction: a same-day rerun with the quota spent makes no
// request (fetchPvpLogs reads downloads/wal-quota-state.json before paging),
// each step pages at most DAILY_MAX_PAGES, and steps run strictly in series.
import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import {
  classifyExit,
  DAILY_MAX_PAGES,
  DAILY_MIN_RATING,
  parseFreshCount,
  planSteps,
  type PullStep,
  remainingToday,
  type RunRecord,
  type RunStatus,
} from "../src/dailyPull";
import { type QuotaState, utcDayKey } from "../src/pvpLogFetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_HOME =
  process.env.GLADLOG_EVAL_HOME ??
  path.join(os.homedir(), "code/gladlog-eval-private");
const DOWNLOADS = path.join(EVAL_HOME, "downloads");
const QUOTA_STATE = path.join(DOWNLOADS, "wal-quota-state.json");
const RUN_LOG = path.join(DOWNLOADS, "daily-pull", "runs.jsonl");
const FETCH_SCRIPT = path.join(__dirname, "fetchPvpLogs.ts");

function readState(): QuotaState | null {
  return fs.pathExistsSync(QUOTA_STATE) ? fs.readJsonSync(QUOTA_STATE) : null;
}

/**
 * Brackets already stepped through today by earlier runs (a same-day rerun or a
 * post-wake catch-up), so their share is not re-issued: the plan is per UTC day,
 * not per process.
 */
function bracketsDoneToday(utcDay: string): PullStep["bracket"][] {
  if (!fs.pathExistsSync(RUN_LOG)) return [];
  const done = new Set<PullStep["bracket"]>();
  for (const line of fs.readFileSync(RUN_LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as RunRecord;
    if (rec.utcDay !== utcDay) continue;
    for (const s of rec.steps) if (s.exit === 0) done.add(s.bracket as PullStep["bracket"]);
  }
  return [...done];
}

function notify(title: string, body: string): void {
  if (process.platform !== "darwin") return;
  const esc = (t: string) => t.replace(/["\\]/g, " ");
  spawnSync("osascript", [
    "-e",
    `display notification "${esc(body)}" with title "${esc(title)}"`,
  ]);
}

function runStep(bracket: string, limit: number) {
  const r = spawnSync("npx", ["tsx", FETCH_SCRIPT], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      BRACKET: bracket,
      MIN_RATING: String(DAILY_MIN_RATING),
      LIMIT: String(limit),
      MAX_PAGES: String(DAILY_MAX_PAGES),
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return { exit: r.status, fresh: parseFreshCount(r.stdout ?? "") };
}

async function main() {
  const startedAt = new Date();
  const record: RunRecord = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    utcDay: utcDayKey(startedAt),
    status: "ok",
    steps: [],
    quotaAfter: null,
  };
  let status: RunStatus = "ok";
  const doneEarlier = bracketsDoneToday(record.utcDay);
  if (doneEarlier.length) console.log(`already done today: ${doneEarlier.join(", ")}`);
  try {
    // Re-plan after every step from the recorded state: a step that found
    // fewer new matches than its share leaves the rest to the next bracket.
    for (;;) {
      const remaining = remainingToday(readState() ?? undefined);
      const [step] = planSteps(remaining, [
        ...doneEarlier,
        ...record.steps.map((s) => s.bracket as PullStep["bracket"]),
      ]);
      if (!step) break;
      console.log(`\n== daily pull: ${step.bracket} × ${step.limit} (remaining ${remaining})`);
      const { exit, fresh } = runStep(step.bracket, step.limit);
      record.steps.push({ bracket: step.bracket, limit: step.limit, fresh, exit });
      const st = classifyExit(exit);
      if (st !== "ok") {
        status = st;
        break;
      }
    }
    if (record.steps.length === 0) {
      record.note = "quota already spent today; nothing requested";
    }
  } catch (e) {
    status = "error";
    record.note = String(e);
  }
  record.status = status;
  record.quotaAfter = readState();
  record.finishedAt = new Date().toISOString();
  await fs.ensureDir(path.dirname(RUN_LOG));
  await fs.appendFile(RUN_LOG, JSON.stringify(record) + "\n");
  const fresh = record.steps.reduce((n, s) => n + s.fresh, 0);
  const q = record.quotaAfter;
  console.log(
    `\ndaily pull ${status}: ${fresh} new logs (${record.steps.map((s) => `${s.bracket} ${s.fresh}/${s.limit}`).join(", ") || "no step"}), quota ${q ? `${q.downloadsUsedToday}/${q.downloadsQuota}` : "?"}; log ${RUN_LOG}`,
  );
  if (status === "auth-expired") {
    notify(
      "gladlog daily pull: 登录已过期",
      "wowarenalogs 会话失效,请重新登录并更新 ~/.gladlog/wal-session-cookie",
    );
  } else if (status === "error") {
    notify("gladlog daily pull: 失败", `见 ${RUN_LOG}`);
  }
  process.exit(status === "ok" ? 0 : 1);
}

main();
