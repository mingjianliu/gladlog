/**
 * Archives fetch-pvp-logs output to Google Drive (through rclone).
 * Usage (once rclone is installed and configured):
 *   npx tsx scripts/syncPvpLogsToDrive.ts            # full incremental sync
 *   DRY_RUN=1 npx tsx scripts/syncPvpLogsToDrive.ts  # list only, change nothing
 * env: REMOTE (default gdrive) / SRC (default $GLADLOG_EVAL_HOME/downloads) /
 *      DEST (default gladlog-pvp-logs)
 * Design and acceptance criteria:
 * docs/plans/2026-07-30-pvp-logs-drive-sync-plan.md
 */
import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { buildRcloneCopyArgs, parseListRemotes } from "../src/driveSync";

const EVAL_HOME =
  process.env.GLADLOG_EVAL_HOME ??
  path.join(os.homedir(), "code/gladlog-eval-private");
const SRC = process.env.SRC ?? path.join(EVAL_HOME, "downloads");
const REMOTE = process.env.REMOTE ?? "gdrive";
const DEST = process.env.DEST ?? "gladlog-pvp-logs";
const DRY_RUN = process.env.DRY_RUN === "1";

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!fs.pathExistsSync(SRC))
  die(
    `本地下载目录不存在:${SRC}\n先跑 fetchPvpLogs.ts 攒点货,或用 SRC= 指定目录。`,
  );

const ver = spawnSync("rclone", ["version"], { encoding: "utf-8" });
if (ver.error)
  die(
    [
      "未找到 rclone。一次性安装:",
      "  macOS:  brew install rclone",
      "  Windows: winget install Rclone.Rclone(或 scoop install rclone)",
      "装完重跑本脚本。",
    ].join("\n"),
  );

const remotes = parseListRemotes(
  spawnSync("rclone", ["listremotes"], { encoding: "utf-8" }).stdout ?? "",
);
if (!remotes.includes(REMOTE))
  die(
    [
      `rclone 里没有名为 "${REMOTE}" 的 remote(现有:${remotes.join(", ") || "无"})。`,
      "一次性配置:",
      "  rclone config",
      `  → n(新建)→ 名字填 ${REMOTE} → 类型选 drive(Google Drive)`,
      "  → client_id/client_secret 留空 → scope 选 1(drive)→ 一路默认",
      "  → 浏览器弹出 Google 授权,点允许即完成。",
      "配完重跑本脚本。",
    ].join("\n"),
  );

console.log(
  `[drive-sync] ${SRC} → ${REMOTE}:${DEST}${DRY_RUN ? "(dry-run)" : ""}`,
);
const cp = spawnSync(
  "rclone",
  buildRcloneCopyArgs({
    src: SRC,
    remote: REMOTE,
    dest: DEST,
    dryRun: DRY_RUN,
    progress: process.stdout.isTTY === true,
  }),
  { stdio: "inherit" },
);
if (cp.status !== 0)
  die(
    `[drive-sync] rclone copy 退出码 ${cp.status} —— 见上方输出;网络/配额问题直接重跑即可(增量,不重传已完成的)。`,
  );

if (!DRY_RUN) {
  const size = spawnSync("rclone", ["size", `${REMOTE}:${DEST}`], {
    encoding: "utf-8",
  });
  if (size.status === 0)
    console.log(`[drive-sync] 云端现状:${size.stdout.trim()}`);
}
console.log(
  "[drive-sync] 完成。feed 只留 ~7 天,记得隔几天跑一轮 fetch + sync。",
);
