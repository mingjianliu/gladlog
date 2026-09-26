/**
 * Reliability round 3 wave 2 (audit 0e06): a time fact is rendered beside
 * fmtTime timeline lines, which floor to the whole second, so it must be
 * formatted with fmtFactTime (truncate), never fmtFactNum (round) — 113.957
 * rounded to "114.0" while the timeline showed the same CC at 1:53. Producers
 * format facts where the raw timestamp is still known; a serializer cannot
 * tell a rounded 114.0 from a real one (codex astra), so this pins the
 * producers' source instead.
 *
 * The scan reads the TypeScript syntax tree (codex post-hoc review: a
 * per-line regex missed `t:` on one line with its value on the next, a
 * camelCase `lastHitAt`, and a quoted `"t"`). Coverage it does NOT claim: a
 * shorthand `{ t }` or a value computed into a variable first, and aliases
 * other than `fmt`. The deep dive's window bounds are template text, not a
 * key — deepDive.test.ts renders them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { fmtFactTime } from "../src/analysis/factFormat";
import { toRenderSecond } from "../src/utils/renderGrid";

const SRC = path.join(__dirname, "../src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

/** Keys that name a time: t, …T (deathT), …At (lastHitAt). */
const TIME_KEY = /^(t|[A-Za-z]*[a-z0-9]T|[A-Za-z]*[a-z0-9]At)$/;
/** fmt is the conventional alias of fmtFactNum; fmtTime renders m:ss (the
 * menu would print "t=1:53s"); toFixed rounds. */
const ROUNDING_CALLS = new Set(["fmt", "fmtFactNum", "fmtTime"]);

/** Every time-keyed property whose value calls a rounding formatter. */
function roundedTimeFacts(
  text: string,
  fileName = "x.ts",
): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out: Array<{ line: number; text: string }> = [];
  const callsRounding = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && ROUNDING_CALLS.has(c.text)) return true;
      if (ts.isPropertyAccessExpression(c) && c.name.text === "toFixed")
        return true;
    }
    return ts.forEachChild(n, callsRounding) ?? false;
  };
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const k = n.name;
      const key =
        ts.isIdentifier(k) || ts.isStringLiteral(k) ? k.text : undefined;
      if (key && TIME_KEY.test(key) && callsRounding(n.initializer))
        out.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          text: n.getText().replace(/\s+/g, " "),
        });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("time facts floor onto the render grid", () => {
  it("fmtFactTime keeps the whole second fmtTime shows", () => {
    for (const raw of [113.957, 9.96, 59.999, 120.05, 0.95, 3600.97])
      expect(Math.floor(Number(fmtFactTime(raw)))).toBe(toRenderSecond(raw));
    expect(fmtFactTime(113.957)).toBe("113.9");
    expect(fmtFactTime(120)).toBe("120");
  });

  it("the scan catches the forms a line regex missed, and passes the right ones", () => {
    const bad = [
      "const f = { t: fmt(raw) };",
      "const f = {\n  t:\n    fmt(raw),\n};",
      "const f = { lastHitAt: fmt(raw) };",
      'const f = { "t": fmt(raw) };',
      "const f = { deathT: raw.toFixed(1) };",
      "const f = { t: fmtTime(raw) };",
      "const f = { t: String(raw.toFixed(1)) };",
      "const f = { t: fmtFactNum(raw) };",
    ];
    for (const src of bad) expect(roundedTimeFacts(src), src).toHaveLength(1);
    const good = [
      "const f = { t: fmtFactTime(raw) };",
      "const f = { t: String(toRenderSecond(raw)) };",
      "const f = { duration: raw.toFixed(1) };",
      "const f = { format: fmt(raw) };",
      "const f = { heat: fmt(raw) };",
    ];
    for (const src of good) expect(roundedTimeFacts(src), src).toEqual([]);
  });

  it("no producer formats a time fact key (t, …T, …At) any other way", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC))
      for (const o of roundedTimeFacts(readFileSync(file, "utf8"), file))
        offenders.push(`${path.relative(SRC, file)}:${o.line}: ${o.text}`);
    expect(offenders).toEqual([]);
  });
});
