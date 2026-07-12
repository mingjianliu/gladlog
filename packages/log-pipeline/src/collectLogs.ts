/* eslint-disable no-console */
import { Buffer } from "node:buffer";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { CollectorConfig } from "./collect/collectorConfig";
import { nextAction } from "./protocol/reconstruct";
import { parseSegmentKey, SegmentRef } from "./protocol/segments";
import { createAdapter } from "./storage/createAdapter";
import { StorageAdapter } from "./storage/StorageAdapter";

export interface CollectStats {
  segmentsFetched: number;
  bytesAppended: number;
  filesUpdated: string[];
  gaps: string[];
}

/** Stable per-(host, logFile, gen8) output name; gen8 is content-derived. */
export function outputNameFor(ref: SegmentRef): string {
  const base = ref.logFileName.endsWith(".txt")
    ? ref.logFileName.slice(0, -4)
    : ref.logFileName;
  return `${base}.${ref.hostname}.${ref.gen8}.txt`;
}

export async function runCollection(
  config: CollectorConfig,
  adapter: StorageAdapter = createAdapter(config.storage),
): Promise<CollectStats> {
  const outDir = config.outputDir;
  mkdirSync(outDir, { recursive: true });

  const stats: CollectStats = {
    segmentsFetched: 0,
    bytesAppended: 0,
    filesUpdated: [],
    gaps: [],
  };
  const refs = (await adapter.list("raw/"))
    .map(parseSegmentKey)
    .filter((r): r is SegmentRef => r !== null);

  const groups = new Map<string, SegmentRef[]>();
  for (const ref of refs) {
    const k = `${ref.hostname}/${ref.logFileName}/${ref.gen8}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(ref);
  }

  for (const [groupKey, group] of groups) {
    const outPath = path.join(outDir, outputNameFor(group[0]));
    const byId = new Map(group.map((r) => [`${r.startOffset}_${r.length}`, r]));
    const remaining = new Set(byId.keys());
    let updated = false;

    for (;;) {
      const size = existsSync(outPath) ? statSync(outPath).size : 0;
      const spans = [...remaining].map((id) => {
        const r = byId.get(id)!;
        return { startOffset: r.startOffset, length: r.length };
      });
      const action = nextAction(size, spans);
      if (action.type === "done") break;
      if (action.type === "gap") {
        const w = `${groupKey}: gap at ${action.expected}, next ${action.nextAvailable}`;
        console.warn(`[collect] WARN ${w}`);
        stats.gaps.push(w);
        break;
      }
      const ref = byId.get(`${action.startOffset}_${action.length}`)!;
      let body: Buffer;
      try {
        body = zlib.gunzipSync(await adapter.get(ref.key));
      } catch {
        // Partially synced / corrupt: not ready. Drop from this run's set and
        // let nextAction pick a shorter complete segment, else gap out and retry
        // on the next poll — never append truncated bytes.
        console.warn(`[collect] ${ref.key} not fully synced yet — deferring`);
        remaining.delete(`${action.startOffset}_${action.length}`);
        continue;
      }
      const seek = size - ref.startOffset; // >= 0 by nextAction's covering contract
      const tail = body.subarray(seek);
      remaining.delete(`${action.startOffset}_${action.length}`);
      if (tail.length === 0) continue;
      const existing = existsSync(outPath)
        ? readFileSync(outPath)
        : Buffer.alloc(0);
      const tmp = `${outPath}.tmp`;
      writeFileSync(tmp, Buffer.concat([existing, tail]));
      renameSync(tmp, outPath);
      stats.segmentsFetched += 1;
      stats.bytesAppended += tail.length; // advance by ACTUAL bytes, not the key's claim
      updated = true;
    }
    if (updated) stats.filesUpdated.push(path.basename(outPath));
  }

  console.log(
    `[collect] +${stats.bytesAppended}B across ${stats.filesUpdated.length} file(s)` +
      (stats.gaps.length ? `, ${stats.gaps.length} gap warning(s)` : ""),
  );
  return stats;
}
