/**
 * Read an archived combat log (plain or `.gz`) and walk its lines without ever
 * decoding the whole file into one string (GH #228).
 *
 * `(gunzipSync(raw) | raw).toString("utf8")` fails past V8's string limit
 * (536,870,888 chars): one 12.1.x log in the 728-file wide manifest
 * decompresses to 569,766,147 bytes and was reported unreadable on every
 * machine. A Buffer has no such limit, so the file is split at "\n" bytes and
 * each line decoded on its own. 0x0A never occurs inside a UTF-8 multi-byte
 * sequence, so the lines are exactly `text.split("\n")` of the whole-file
 * decode — trailing "\r" and the final empty string after a closing newline
 * included (`test/logLines.test.ts`).
 *
 * The product never had this problem: desktop import streams the file
 * (`packages/desktop/src/main/importLogs.ts`).
 */
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

/** The log's bytes, gunzipped when the path ends in `.gz`. Throws like
 * `readFileSync` / `gunzipSync` on a missing or corrupt file. */
export function readLogBytes(path: string): Buffer {
  const raw = readFileSync(path);
  return path.endsWith(".gz") ? gunzipSync(raw) : raw;
}

/** Calls `onLine` for each line of `buf`, in order, as `buf.toString("utf8")
 * .split("\n")` would produce them. */
export function forEachLogLine(
  buf: Buffer,
  onLine: (line: string) => void,
): void {
  let start = 0;
  for (;;) {
    const nl = buf.indexOf(0x0a, start);
    if (nl === -1) {
      onLine(buf.toString("utf8", start));
      return;
    }
    onLine(buf.toString("utf8", start, nl));
    start = nl + 1;
  }
}
