/**
 * Reliability round 3 wave 2 (audit 0e06): a time fact is rendered beside
 * fmtTime timeline lines, which floor to the whole second, so it must be
 * formatted with fmtFactTime (truncate), never fmtFactNum (round) — 113.957
 * rounded to "114.0" while the timeline showed the same CC at 1:53. Producers
 * format facts where the raw timestamp is still known; a serializer cannot
 * tell a rounded 114.0 from a real one (codex astra), so this pins the
 * producers' source instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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

describe("time facts floor onto the render grid", () => {
  it("fmtFactTime keeps the whole second fmtTime shows", () => {
    for (const raw of [113.957, 9.96, 59.999, 120.05, 0.95, 3600.97])
      expect(Math.floor(Number(fmtFactTime(raw)))).toBe(toRenderSecond(raw));
    expect(fmtFactTime(113.957)).toBe("113.9");
    expect(fmtFactTime(120)).toBe("120");
  });

  it("no producer formats a time fact key (t, …T, …At) any other way", () => {
    const offenders: string[] = [];
    // `fmt` is the conventional alias of fmtFactNum; fmtTime renders m:ss
    // (the menu prints "t=1:53s"); toFixed rounds (agy review)
    const rounded =
      /\b(t|[a-z]+T|[a-z]+At)\s*:\s*(?:(?:fmt|fmtFactNum|fmtTime)\(|[^,]*\.toFixed\()/;
    for (const file of sources(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (rounded.test(line))
            offenders.push(
              `${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`,
            );
        });
    }
    expect(offenders).toEqual([]);
  });
});
