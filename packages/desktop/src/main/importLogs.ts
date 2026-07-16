import { promises as fs } from "fs";
import { basename } from "path";
import {
  GladLogParser,
  type GladMatch,
  type GladShuffle,
} from "@gladlog/parser";

import type { MatchStore, StoredMatchMeta } from "./matchStore";

export interface ImportProgress {
  file: string;
  i: number; // 1-based 当前文件序号
  n: number;
  stored: number; // 累计新入库
  dup: number; // 累计去重跳过
}

export interface ImportSummary {
  files: number;
  stored: number;
  dup: number;
  failed: number;
}

/**
 * 历史日志一次性导入(phase3 #2c):逐文件全量跑 GladLogParser,
 * store.store 按 id 去重 → 重复导入天然幂等。与 watcher 的 tail/checkpoint
 * 增量模型无关,不动 checkpoint。
 * 注:在 main 线程同步解析——导入是显式用户操作且有进度反馈,v1 接受;
 * 若未来卡顿再下沉 worker。
 */
export async function importLogFiles(
  paths: string[],
  store: Pick<MatchStore, "store">,
  emit: (channel: string, payload: unknown) => void,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    files: paths.length,
    stored: 0,
    dup: 0,
    failed: 0,
  };
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    try {
      const content = await fs.readFile(path, "utf-8");
      const parser = new GladLogParser();
      const items: Array<GladMatch | GladShuffle> = [];
      parser.on("match", (m: GladMatch) => items.push(m));
      parser.on("shuffle", (sh: GladShuffle) => items.push(sh));
      for (const line of content.split("\n")) parser.push(line);
      parser.end();

      for (const item of items) {
        const r = store.store(item);
        if (r.stored) {
          summary.stored++;
          // 复用实时监控的入库通知,让左侧列表即时出现
          emit("gladlog:logs:matchStored", r.meta as StoredMatchMeta);
        } else if (r.meta) {
          summary.dup++;
        }
      }
    } catch {
      summary.failed++;
    }
    emit("gladlog:import:progress", {
      file: basename(path),
      i: i + 1,
      n: paths.length,
      stored: summary.stored,
      dup: summary.dup,
    } satisfies ImportProgress);
  }
  return summary;
}
