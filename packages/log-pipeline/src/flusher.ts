import { closeSync, fstatSync, openSync, readSync } from "fs";
import { gzipSync } from "zlib";

import { firstLineChecksum, gen8Of } from "./protocol/identity";
import { buildSegmentKey } from "./protocol/segments";
import { FileCheckpoint } from "./state";
import { StorageAdapter } from "./storage/StorageAdapter";

export interface FlushOutcome {
  checkpoint: FileCheckpoint | undefined;
  flushedBytes: number;
  reset: boolean;
  segmentKey: string | null;
}

const IDENTITY_HEAD_BYTES = 4096;

/** Read exactly [start, start+length) — loops on partial reads; returns only the bytes actually read. */
function readRange(fd: number, start: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const n = readSync(fd, buf, total, length - total, start + total);
    if (n === 0) break; // file shrank between fstat and read — return what we have
    total += n;
  }
  return total === length ? buf : buf.subarray(0, total);
}

/**
 * Read-delta-and-upload for one file. Open → read → close every time; never
 * hold a handle between flushes (Windows: open handles can block the game or
 * cleanup tools from rotating/deleting the file). The checkpoint advances only
 * after the adapter acks the put (at-least-once); re-uploads land on the same
 * key, so duplicates are idempotent end-to-end.
 */
export async function flushFile(opts: {
  filePath: string;
  logFileName: string;
  hostname: string;
  checkpoint: FileCheckpoint | undefined;
  adapter: StorageAdapter;
}): Promise<FlushOutcome> {
  const { filePath, logFileName, hostname, adapter } = opts;
  let checkpoint = opts.checkpoint;

  const fd = openSync(filePath, "r"); // read-only, shared; WoW keeps writing happily
  let reset = false;
  try {
    const size = fstatSync(fd).size;

    const head = readRange(fd, 0, Math.min(IDENTITY_HEAD_BYTES, size));

    const checksum = firstLineChecksum(head);
    if (checksum === null) {
      // No complete first line yet — identity pending, try again next flush.
      return { checkpoint, flushedBytes: 0, reset: false, segmentKey: null };
    }

    if (checkpoint && checkpoint.firstLineChecksum !== checksum) {
      // Recreated file (first line changed): new generation, re-stream from 0.
      checkpoint = undefined;
      reset = true;
    } else if (checkpoint && size < checkpoint.offset) {
      // Same first line but the file shrank: external truncation, not a WoW
      // recreate. Re-streaming would overwrite this generation's durable
      // offset-0 segment with different bytes (silent corruption), so log the
      // anomaly and stand down for this file until its first line changes.
      console.warn(
        `[log-pipeline] ${logFileName}: shrank ${checkpoint.offset} -> ${size} with unchanged first line; skipping`,
      );
      return { checkpoint, flushedBytes: 0, reset: false, segmentKey: null };
    }

    const startOffset = checkpoint?.offset ?? 0;
    if (size <= startOffset) {
      // Duplicate fs.watch event or no growth — idempotent no-op.
      return {
        checkpoint: checkpoint ?? {
          offset: startOffset,
          firstLineChecksum: checksum,
        },
        flushedBytes: 0,
        reset,
        segmentKey: null,
      };
    }

    const delta = readRange(fd, startOffset, size - startOffset);
    if (delta.length === 0) {
      return {
        checkpoint: { offset: startOffset, firstLineChecksum: checksum },
        flushedBytes: 0,
        reset,
        segmentKey: null,
      };
    }

    const gen8 = gen8Of(checksum);
    const segmentKey = buildSegmentKey(
      hostname,
      logFileName,
      gen8,
      startOffset,
    );
    await adapter.put(segmentKey, gzipSync(delta));
    return {
      checkpoint: {
        offset: startOffset + delta.length,
        firstLineChecksum: checksum,
      },
      flushedBytes: delta.length,
      reset,
      segmentKey,
    };
  } finally {
    closeSync(fd);
  }
}
