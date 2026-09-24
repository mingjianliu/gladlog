import { createReadStream } from "fs";
import { basename } from "path";
import {
  GladLogParser,
  type GladMatch,
  type GladShuffle,
} from "@gladlog/parser";

import type { MatchStore, StoredMatchMeta } from "./matchStore";

interface ImportProgress {
  file: string;
  i: number; // 1-based index of the current file
  n: number;
  stored: number; // running total newly stored
  dup: number; // running total skipped as duplicates
}

interface ImportSummary {
  files: number;
  stored: number;
  dup: number;
  failed: number;
}

/**
 * One-shot import of historical logs (phase3 #2c): runs GladLogParser over each
 * file as a stream; store.store dedupes by id, so re-importing is naturally
 * idempotent. Unrelated to the watcher's tail/checkpoint incremental model, and
 * it does not touch the checkpoint.
 *
 * Streaming rather than reading whole files (2026-07-26 audit): the old readFile
 * produced one string -- the largest local log is 406MB, already close to V8's
 * 512MB single-string ceiling (anything larger simply throws) -- plus a ~1GB
 * line array after split and every parsed match resident until the file was
 * done. Now we chunk the stream and split on \n by hand (readline eats the \r
 * of CRLF, and byte-exact rawLines is a log-pipeline contract, so it cannot be
 * used), storing each match as it is matched; the for-await between chunks
 * naturally yields to the event loop.
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
      const parser = new GladLogParser();
      const onItem = (item: GladMatch | GladShuffle) => {
        const r = store.store(item);
        if (r.stored) {
          summary.stored++;
          // Reuse the live-watcher stored notification so the left-hand list
          // updates immediately
          emit("gladlog:logs:matchStored", r.meta as StoredMatchMeta);
        } else if (r.meta) {
          summary.dup++;
        }
      };
      parser.on("match", onItem);
      parser.on("shuffle", onItem);
      // Line-for-line equivalent to the old content.split("\n"): split on \n
      // only, keep a trailing \r verbatim, and push the final segment (even an
      // empty string) -- split's trailing-empty-element semantics are
      // reproduced too.
      const stream = createReadStream(path, {
        encoding: "utf-8",
        highWaterMark: 4 << 20,
      });
      let carry = "";
      for await (const chunk of stream) {
        const parts = (carry + (chunk as string)).split("\n");
        carry = parts.pop()!;
        for (const line of parts) parser.push(line);
      }
      parser.push(carry);
      parser.end();
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
