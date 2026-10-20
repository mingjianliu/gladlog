/**
 * Archives the cross-machine collector's reconstructed own logs
 * (`~/gladlog-sync/logs`) to Google Drive as gzip, permanently.
 *
 * Usage:
 *   npm run logs:archive-own              # incremental, gzip, upload
 *   DRY_RUN=1 npm run logs:archive-own    # list what would go up, touch nothing
 * env: REMOTE (default gdrive) / DEST (default gladlog-own-logs) /
 *      SRC (default ~/gladlog-sync/logs) / STAGING / GZIP_LEVEL
 *
 * Permanence is the whole point ("no TTL"), which comes down to three things:
 *  1. `rclone copy`, never `rclone sync` — sync deletes remote files that are
 *     absent locally, so clearing the local 21GB would clear Drive with it.
 *     Pinned by a unit test in src/ownLogArchive.test.ts.
 *  2. This file contains no code path that deletes anything on Drive. The only
 *     deletion is our own local staging, after a confirmed upload.
 *  3. A separate Drive directory from `gladlog-relay`, whose segments the
 *     collector cleans up by design.
 *
 * Local .txt files are never touched — this adds a copy, it does not move one.
 */
import { spawnSync } from "child_process";
import { statfsSync } from "fs";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";

import { buildRcloneCopyArgs, parseListRemotes } from "../src/driveSync";
import {
  gzNameFor,
  isOwnLogName,
  type OwnLogManifest,
  parseOwnLogManifest,
  selectOwnLogsToArchive,
  serializeOwnLogManifest,
} from "../src/ownLogArchive";

const SRC = process.env.SRC ?? path.join(os.homedir(), "gladlog-sync/logs");
const REMOTE = process.env.REMOTE ?? "gdrive";
const DEST = process.env.DEST ?? "gladlog-own-logs";
const STAGING =
  process.env.STAGING ?? path.join(os.homedir(), "gladlog-sync/.drive-staging");
const GZIP_LEVEL = Number(process.env.GZIP_LEVEL ?? 6);
const DRY_RUN = process.env.DRY_RUN === "1";
/** gzip staging for the whole 21GB corpus measured ~1.8GB; refuse to start if
 * the disk is too tight to hold a batch. */
const MIN_FREE_BYTES = 5 * 1024 ** 3;
const MANIFEST = "manifest.json";

const mb = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function rclone(args: string[], opts: { inherit?: boolean } = {}) {
  return spawnSync("rclone", args, {
    encoding: "utf-8",
    stdio: opts.inherit ? "inherit" : "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function preflight(): void {
  if (!fs.pathExistsSync(SRC))
    die(
      `本地日志目录不存在:${SRC}\n先让 collector 重建出日志(npm run logs:collect),或用 SRC= 指定目录。`,
    );
  if (rclone(["version"]).error)
    die("未找到 rclone。macOS:brew install rclone;装完重跑本脚本。");
  const remotes = parseListRemotes(rclone(["listremotes"]).stdout ?? "");
  if (!remotes.includes(REMOTE))
    die(
      `rclone 里没有名为 "${REMOTE}" 的 remote(现有:${remotes.join(", ") || "无"})。\n配置见 docs/pvp-log-archive.md 的 Credentials 一节。`,
    );
}

/**
 * Exercise auth for real before spending minutes gzipping gigabytes.
 * `rclone listremotes` above only proves a remote is *configured* — an expired
 * or revoked token sails straight through it (docs/pvp-log-archive.md).
 * Read path = `about`; write path = overwriting a probe file that is
 * deliberately never deleted, so this stays free of any Drive-delete code.
 */
function verifyAuth(): void {
  const about = rclone(["about", `${REMOTE}:`]);
  if (about.status !== 0)
    die(
      `[own-logs] rclone 读路径不通(${REMOTE}:)——先修鉴权:\n${(about.stderr ?? "").slice(0, 400)}`,
    );
  const probeDir = path.join(STAGING, ".probe");
  fs.ensureDirSync(probeDir);
  fs.writeFileSync(
    path.join(probeDir, ".rclone-authcheck"),
    `${new Date().toISOString()}\n`,
  );
  const put = rclone([
    "copy",
    probeDir,
    `${REMOTE}:${DEST}`,
    "--transfers",
    "1",
  ]);
  fs.removeSync(probeDir);
  if (put.status !== 0)
    die(
      `[own-logs] rclone 写路径不通(${REMOTE}:${DEST})——先修鉴权:\n${(put.stderr ?? "").slice(0, 400)}`,
    );
}

/** The manifest lives on Drive, not locally: it is the one source of truth for
 * "what is already up there, at what size", and it survives losing this
 * machine. Absent (first run) reads as empty. */
function fetchManifest(): OwnLogManifest {
  const cat = rclone(["cat", `${REMOTE}:${DEST}/${MANIFEST}`]);
  if (cat.status === 0) return parseOwnLogManifest(cat.stdout ?? "");
  const err = cat.stderr ?? "";
  if (/not found|didn't find|does not exist/i.test(err)) return {};
  die(
    `[own-logs] 读云端 manifest 失败,拒绝在不知道云端状态的情况下上传:\n${err.slice(0, 400)}`,
  );
}

async function gzipInto(src: string, dest: string): Promise<number> {
  await pipeline(
    fs.createReadStream(src),
    createGzip({ level: GZIP_LEVEL }),
    fs.createWriteStream(dest),
  );
  return fs.statSync(dest).size;
}

async function main() {
  preflight();

  const files = fs
    .readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isFile() && isOwnLogName(e.name))
    .map((e) => {
      const st = fs.statSync(path.join(SRC, e.name));
      return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
    });

  if (!DRY_RUN) verifyAuth();
  const manifest = fetchManifest();
  const todo = selectOwnLogsToArchive({ files, manifest, nowMs: Date.now() });
  const totalSrc = todo.reduce((s, f) => s + f.size, 0);

  console.log(
    `[own-logs] ${SRC} → ${REMOTE}:${DEST}\n` +
      `[own-logs] 本地 ${files.length} 个日志,云端已记 ${Object.keys(manifest).length} 个,本轮待归档 ${todo.length} 个(${mb(totalSrc)})`,
  );
  if (todo.length === 0) {
    console.log("[own-logs] 没有新东西,退出。");
    return;
  }
  if (DRY_RUN) {
    for (const f of todo)
      console.log(
        `  DRY_RUN 将归档 ${f.name}(${mb(f.size)}${manifest[f.name] !== undefined ? `,云端旧版 ${mb(manifest[f.name])}` : ""})`,
      );
    console.log("[own-logs] DRY_RUN:不压缩、不上传、不改 manifest。");
    return;
  }

  const statfs = statfsSync(path.dirname(STAGING));
  if (Number(statfs.bavail) * Number(statfs.bsize) < MIN_FREE_BYTES)
    die("[own-logs] 磁盘剩余不足 5GB,停止 —— 压缩暂存放不下。");

  const logDir = path.join(STAGING, "logs");
  const metaDir = path.join(STAGING, "meta");
  fs.emptyDirSync(logDir);
  fs.emptyDirSync(metaDir);

  let gzTotal = 0;
  for (const [i, f] of todo.entries()) {
    const out = path.join(logDir, gzNameFor(f.name));
    const gz = await gzipInto(path.join(SRC, f.name), out);
    gzTotal += gz;
    console.log(
      `  [${i + 1}/${todo.length}] ${f.name} ${mb(f.size)} → ${mb(gz)}`,
    );
  }
  console.log(
    `[own-logs] 压缩完成:${mb(totalSrc)} → ${mb(gzTotal)}(${(totalSrc / gzTotal).toFixed(1)}x),开始上传`,
  );

  const up = rclone(
    buildRcloneCopyArgs({
      src: logDir,
      remote: REMOTE,
      dest: DEST,
      dryRun: false,
    }),
    { inherit: true },
  );
  if (up.status !== 0)
    die(
      `[own-logs] 上传失败(退出码 ${up.status})——暂存保留在 ${logDir},修好后重跑即可(增量)。`,
    );

  // Record only after the logs are confirmed up: a manifest that runs ahead of
  // the upload would mark a file done that never landed, and nothing would ever
  // retry it.
  const next: OwnLogManifest = { ...manifest };
  for (const f of todo) next[f.name] = f.size;
  fs.writeFileSync(path.join(metaDir, MANIFEST), serializeOwnLogManifest(next));
  const upMeta = rclone(
    buildRcloneCopyArgs({
      src: metaDir,
      remote: REMOTE,
      dest: DEST,
      dryRun: false,
    }),
  );
  if (upMeta.status !== 0)
    die(
      `[own-logs] 日志已上传成功,但 manifest 回写失败 —— 下轮会把这 ${todo.length} 个当成没传过重传一次(浪费带宽,不丢数据):\n${(upMeta.stderr ?? "").slice(0, 400)}`,
    );

  fs.removeSync(logDir);
  fs.removeSync(metaDir);
  const size = rclone(["size", `${REMOTE}:${DEST}`]);
  if (size.status === 0)
    console.log(`[own-logs] 云端现状:${size.stdout?.trim()}`);
  console.log(
    `[own-logs] 完成:新归档 ${todo.length} 个(${mb(totalSrc)} → ${mb(gzTotal)})。本地 .txt 一个没动。`,
  );
}

main().catch((e) => {
  console.error("[own-logs] 失败:", e);
  process.exit(1);
});
