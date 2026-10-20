 
/**
 * CLI: bulk-backfill historical logs into the app's match library (without
 * going through Electron).
 *
 * Why: when restoring a big batch of old logs after a machine change or a
 * cross-machine relay, the built-in "Import historical logs…" requires
 * clicking through a file dialog, and it does a whole-file readFile + split
 * into memory at once (measured: a 387 MB log peaks at 4.5 GB RSS and takes
 * 12.6s, and running that on the main thread freezes the UI). This script
 * streams line by line into the parser at constant memory, so it can run
 * unattended and everything is simply there when the app opens.
 *
 * It shares MatchStore.store's dedupe-by-id with importLogs.ts, so **rerunning
 * is idempotent**, and it never touches the watcher's checkpoint.
 *
 * Usage:
 *   npx tsx packages/desktop/scripts/backfillMatches.ts --dir <log dir> [--store <matches dir>]
 *
 * --store defaults to macOS's ~/Library/Application Support/gladlog/matches.
 */
import {
  GladLogParser,
  type GladMatch,
  type GladShuffle,
} from "@gladlog/parser";
import { execFileSync } from "child_process";
import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

import { MatchStore } from "../src/main/matchStore";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function defaultStoreDir(): string {
  if (process.platform === "darwin")
    return join(
      homedir(),
      "Library",
      "Application Support",
      "gladlog",
      "matches",
    );
  if (process.platform === "win32")
    return join(process.env.APPDATA ?? homedir(), "gladlog", "matches");
  return join(homedir(), ".config", "gladlog", "matches");
}

/**
 * Free disk space (GB). Lesson from 2026-07-21: the bottleneck of a backfill
 * is neither memory nor time, it is **disk** -- MatchStore writes match.json
 * (the full parsed structure) plus raw.txt (the original lines) per match,
 * measured at **103 MB/match on average, 66 MB median, 473 MB max**. A
 * 2536-match backfill needs 260 GB; only 122 GB were free at the time, and by
 * match 672 it had chewed free space from 122 GB down to 38 GB before anyone
 * noticed. The built-in "Import historical logs" uses the same store and
 * costs exactly the same -- nobody had just measured it.
 */
function freeGb(path: string): number | null {
  try {
    const out = execFileSync("df", ["-k", path], { encoding: "utf-8" });
    const cols = out.trim().split("\n").pop()?.split(/\s+/);
    const availKb = cols ? Number(cols[3]) : NaN;
    return Number.isFinite(availKb) ? availKb / 1024 / 1024 : null;
  } catch {
    return null;
  }
}

/** Stream-parse one log file line by line. Returns the matches it yielded. */
async function parseFile(
  path: string,
): Promise<Array<GladMatch | GladShuffle>> {
  const parser = new GladLogParser();
  const items: Array<GladMatch | GladShuffle> = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  parser.on("shuffle", (sh: GladShuffle) => items.push(sh));
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity, // logs originating on Windows use CRLF
  });
  for await (const line of rl) parser.push(line);
  parser.end();
  return items;
}

async function main(): Promise<void> {
  const dir = argValue("--dir");
  if (!dir) {
    console.error(
      "Usage: backfillMatches.ts --dir <日志目录> [--store <matches 目录>]",
    );
    process.exit(1);
  }
  const storeDir = argValue("--store") ?? defaultStoreDir();

  const names = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
  if (names.length === 0) {
    console.error(`没有找到 .txt 日志:${dir}`);
    process.exit(1);
  }

  // Disk floor: stop below this, don't fill the machine up. Default 20 GB.
  const minFreeGb = Number(argValue("--min-free-gb") ?? 20);

  const store = new MatchStore(storeDir);
  const before = store.init().length;
  const free0 = freeGb(storeDir);
  console.log(`对局库 ${storeDir}(已有 ${before} 场)`);
  console.log(`扫描 ${names.length} 个日志:${dir}`);
  if (free0 !== null) {
    // Rough estimate from the measured average of 103 MB/match and ~19
    // matches per log file
    const estGb = (names.length * 19 * 103) / 1024;
    console.log(
      `磁盘可用 ${free0.toFixed(0)} GB,下限 ${minFreeGb} GB;` +
        `粗估需要 ~${estGb.toFixed(0)} GB(均值 103 MB/场)`,
    );
    if (estGb > free0 - minFreeGb) {
      console.log(
        `⚠ 空间大概率不够 —— 会边跑边检查,触到下限就停(已入库的不会回滚)。`,
      );
    }
  }
  console.log("");

  let stored = 0;
  let dup = 0;
  let failed = 0;
  const t0 = Date.now();

  let stoppedForDisk = false;
  for (let i = 0; i < names.length; i++) {
    const free = freeGb(storeDir);
    if (free !== null && free < minFreeGb) {
      console.log(
        `\n⛔ 磁盘可用 ${free.toFixed(1)} GB < 下限 ${minFreeGb} GB —— 停止。` +
          `\n   已处理 ${i}/${names.length} 个日志;已入库的对局完好(tmp+rename 写入)。` +
          `\n   腾出空间后重跑即可续上(按 id 去重,不会重复写)。`,
      );
      stoppedForDisk = true;
      break;
    }
    const name = names[i]!;
    const path = join(dir, name);
    const mb = Math.round((await stat(path)).size / 1048576);
    const tag = `[${String(i + 1).padStart(3)}/${names.length}] ${name} (${mb} MB)`;
    try {
      const items = await parseFile(path);
      let s = 0;
      let d = 0;
      for (const item of items) {
        if (store.store(item).stored) s++;
        else d++;
      }
      stored += s;
      dup += d;
      console.log(`${tag} → ${items.length} 场(新 ${s} / 重复 ${d})`);
    } catch (e) {
      failed++;
      console.log(
        `${tag} → 失败:${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const dt = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\n${stoppedForDisk ? "中止" : "完成"}:新入库 ${stored},去重跳过 ${dup},失败 ${failed},耗时 ${dt}s`,
  );
  const free1 = freeGb(storeDir);
  console.log(
    `对局库现有 ${store.init().length} 场` +
      (free1 !== null ? `,磁盘可用 ${free1.toFixed(0)} GB` : ""),
  );
  if (stoppedForDisk) process.exitCode = 2;
}

main().catch((e) => {
  console.error("backfill fatal:", e);
  process.exit(1);
});
