/* eslint-disable no-console */
/**
 * CLI:历史日志批量回填到 app 的对局库(不经 Electron)。
 *
 * 用途:换机器 / 跨机中继补回一大批旧日志时,内置的「导入历史日志…」要人点文件
 * 对话框,而且整文件 readFile + split 一次性进内存(实测 387 MB 日志峰值 RSS
 * 4.5 GB、12.6s,跑在 main 线程上会冻 UI)。本脚本逐行流式喂 parser,内存恒定,
 * 无人值守跑完 app 打开即全在。
 *
 * 与 importLogs.ts 共用 MatchStore.store 的按 id 去重,**重复跑幂等**,
 * 也不动 watcher 的 checkpoint。
 *
 * Usage:
 *   npx tsx packages/desktop/scripts/backfillMatches.ts --dir <日志目录> [--store <matches 目录>]
 *
 * --store 默认 macOS 的 ~/Library/Application Support/gladlog/matches。
 */
import { execFileSync } from "child_process";
import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

import {
  GladLogParser,
  type GladMatch,
  type GladShuffle,
} from "@gladlog/parser";

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
 * 剩余磁盘(GB)。2026-07-21 的教训:回填的瓶颈不是内存也不是时间,是**磁盘** ——
 * MatchStore 每场写 match.json(完整解析结构)+ raw.txt(原始行),实测**平均
 * 103 MB/场、中位 66 MB、最大 473 MB**。一次 2536 场的回填要 260 GB,当时只剩
 * 122 GB,跑到 672 场时把可用空间从 122 GB 干到 38 GB 才被发现。
 * 内置的「导入历史日志」走同一个 store,代价一模一样,只是没人量过。
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

/** 逐行流式解析一个日志文件。返回该文件解析出的对局。 */
async function parseFile(
  path: string,
): Promise<Array<GladMatch | GladShuffle>> {
  const parser = new GladLogParser();
  const items: Array<GladMatch | GladShuffle> = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  parser.on("shuffle", (sh: GladShuffle) => items.push(sh));
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity, // Windows 来源的日志是 CRLF
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

  // 磁盘下限:低于此值就停,别把机器写满。默认留 20 GB。
  const minFreeGb = Number(argValue("--min-free-gb") ?? 20);

  const store = new MatchStore(storeDir);
  const before = store.init().length;
  const free0 = freeGb(storeDir);
  console.log(`对局库 ${storeDir}(已有 ${before} 场)`);
  console.log(`扫描 ${names.length} 个日志:${dir}`);
  if (free0 !== null) {
    // 按实测均值 103 MB/场、每个日志约 19 场 粗估
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
