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

export function firstLineChecksumOf(filePath: string): string | null {
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

export function readTail(
  filePath: string,
  state: TailState,
): { lines: string[]; state: TailState; rotated: boolean } {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return { lines: [], state, rotated: false };
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

  const lines: string[] = [];
  let readFrom = cur.offset + cur.carry.length;
  if (readFrom >= size) return { lines, state: cur, rotated };

  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return { lines: [], state: cur, rotated };
  }
  try {
    let carry = cur.carry;
    let offset = cur.offset;
    while (readFrom < size) {
      const want = Math.min(CHUNK, size - readFrom);
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
        lines.push(data.subarray(start, end).toString("utf-8"));
        start = nl + 1;
      }
      offset += start; // 只推进到最后一个完整行尾
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
  return { lines, state: cur, rotated };
}
