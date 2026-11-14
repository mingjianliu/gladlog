import { createHash } from "crypto";
import { closeSync, openSync, readSync, statSync } from "fs";

import type { FileCheckpoint } from "../shared/protocol";

export interface TailState {
  offset: number;
  firstLineChecksum: string | null;
  carry: Buffer;
}

const CHUNK = 8 * 1024 * 1024;

export function initialTailState(cp?: FileCheckpoint | null): TailState {
  return {
    offset: cp?.offset ?? 0,
    firstLineChecksum: cp?.firstLineChecksum ?? null,
    carry: Buffer.alloc(0),
  };
}

function firstLineChecksumOf(filePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    if (n <= 0) return null;
    const nl = buf.subarray(0, n).indexOf(0x0a);
    const head = buf.subarray(0, nl === -1 ? n : nl);
    return createHash("sha1").update(head).digest("hex");
  } finally {
    closeSync(fd);
  }
}

/** Consumer of a streamed tail read. Lines are handed over as each chunk is
 * split, so a backlog of hundreds of MB never sits in memory as one line
 * array (GH #211: on a 209 MB log the old `lines: string[]` held ~400 MB of
 * strings before the first one reached the parser). */
export interface TailSink {
  /** Called at most once, before any line, when the file was rotated
   * (truncated, or its first line changed). The lines that follow come from
   * byte 0 of the new content, so the consumer has to finish with the old
   * content here, before the first of them arrives. */
  rotated?(firstLineChecksum: string | null): void;
  /** One complete line, without its `\n` and without a trailing `\r`, and the
   * byte offset in the file at which that line starts. */
  line(text: string, startOffset: number): void;
}

/** Reads every complete line past `state` and hands each one to `sink.line`
 * while the file is being read (memory peak is about two chunks, not the
 * file). The returned state's offset stops at the end of the last complete
 * line; a partial last line is carried over to the next call. If the sink
 * throws, the error propagates and the caller keeps its previous state. */
export function readTail(
  filePath: string,
  state: TailState,
  sink: TailSink,
  /** Test-only override of the read size; never passed in production. */
  chunkSize: number = CHUNK,
): { state: TailState; rotated: boolean } {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return { state, rotated: false };
  }

  const checksum = firstLineChecksumOf(filePath);
  const rotated =
    size < state.offset ||
    (state.firstLineChecksum !== null &&
      checksum !== null &&
      checksum !== state.firstLineChecksum);

  let cur: TailState = rotated
    ? { offset: 0, firstLineChecksum: checksum, carry: Buffer.alloc(0) }
    : { ...state, firstLineChecksum: state.firstLineChecksum ?? checksum };
  if (rotated) sink.rotated?.(checksum);

  let readFrom = cur.offset + cur.carry.length;
  if (readFrom >= size) return { state: cur, rotated };

  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return { state: cur, rotated };
  }
  try {
    let carry = cur.carry;
    // File offset of carry[0], which is also data[0] below.
    let offset = cur.offset;
    while (readFrom < size) {
      const want = Math.min(chunkSize, size - readFrom);
      const buf = Buffer.alloc(want);
      const n = readSync(fd, buf, 0, want, readFrom);
      if (n <= 0) break;
      readFrom += n;
      const data = Buffer.concat([carry, buf.subarray(0, n)]);
      let start = 0;
      for (;;) {
        const nl = data.indexOf(0x0a, start);
        if (nl === -1) break;
        let end = nl;
        if (end > start && data[end - 1] === 0x0d) end--;
        sink.line(data.subarray(start, end).toString("utf-8"), offset + start);
        start = nl + 1;
      }
      offset += start; // advance only to the end of the last complete line
      carry = data.subarray(start);
    }
    cur = {
      offset,
      firstLineChecksum: cur.firstLineChecksum,
      carry: Buffer.from(carry),
    };
  } finally {
    closeSync(fd);
  }
  return { state: cur, rotated };
}
