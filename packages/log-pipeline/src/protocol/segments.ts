export const OFFSET_PAD = 12;

export interface SegmentRef {
  hostname: string;
  logFileName: string;
  gen8: string;
  startOffset: number;
  length: number;
  key: string;
}

const pad = (n: number) => String(n).padStart(OFFSET_PAD, "0");

export function buildSegmentKey(
  hostname: string,
  logFileName: string,
  gen8: string,
  startOffset: number,
  length: number,
): string {
  return `raw/${hostname}/${logFileName}/${gen8}/${pad(startOffset)}_${pad(length)}.seg`;
}

export function parseSegmentKey(key: string): SegmentRef | null {
  const parts = key.split("/");
  if (parts.length !== 5 || parts[0] !== "raw") return null;
  const [, hostname, logFileName, gen8, last] = parts;
  const m = /^(\d+)_(\d+)\.seg$/.exec(last);
  if (!m) return null;
  return {
    hostname,
    logFileName,
    gen8,
    startOffset: parseInt(m[1], 10),
    length: parseInt(m[2], 10),
    key,
  };
}

export function buildHeartbeatKey(hostname: string): string {
  return `status/${hostname}.json`;
}
