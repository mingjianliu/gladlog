/**
 * verify/jsonWrite.ts — a scan's `--json` report, written piece by piece.
 *
 * `JSON.stringify(report, null, 1)` builds the whole file as one string, and
 * the wide corpus's violations list is past V8's limit for one (536,870,888
 * chars: the v0.1.44 wide check lost a finished walk to it, T263). The bytes
 * written here are the ones that call would have produced.
 */
import { closeSync, openSync, writeFileSync } from "node:fs";

const FLUSH_CHARS = 1 << 22;

/** what `JSON.stringify` leaves out of an object */
const omitted = (v: unknown): boolean =>
  v === undefined || typeof v === "function" || typeof v === "symbol";

/**
 * `writeFileSync(path, JSON.stringify(obj, null, 1))`, byte for byte, never
 * holding more than one element of a top-level array as a string. A scan's
 * report is a flat object whose long values are arrays (`violations`,
 * `vList`): only those are streamed, everything else is stringified whole.
 */
export function writeJsonIndent1(
  path: string,
  obj: Record<string, unknown>,
): void {
  const fd = openSync(path, "w");
  let buf = "";
  const put = (s: string): void => {
    buf += s;
    if (buf.length > FLUSH_CHARS) {
      // writeFileSync, not writeSync: it writes until every byte is out
      writeFileSync(fd, buf);
      buf = "";
    }
  };
  const nest = (s: string, pad: string): string =>
    s.replaceAll("\n", `\n${pad}`);
  try {
    const keys = Object.keys(obj).filter((k) => !omitted(obj[k]));
    put("{");
    keys.forEach((k, i) => {
      const v = obj[k];
      put(`${i ? "," : ""}\n ${JSON.stringify(k)}: `);
      if (Array.isArray(v) && v.length > 0) {
        put("[");
        // by index, so a hole counts; an element stringify drops (undefined,
        // a function, a hole) prints as null
        for (let j = 0; j < v.length; j++)
          put(
            `${j ? "," : ""}\n  ${nest(JSON.stringify(v[j], null, 1) ?? "null", "  ")}`,
          );
        put("\n ]");
      } else put(nest(JSON.stringify(v, null, 1) ?? "null", " "));
    });
    put(keys.length ? "\n}" : "}");
    writeFileSync(fd, buf);
  } finally {
    closeSync(fd);
  }
}
