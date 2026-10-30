// Every COMBATANT_INFO line of every real log in GLADLOG_FIXTURES decodes.
// A line that does not leaves its player without `info`, and every reader
// that takes a round's players from `info` drops them — the round runs 3v2
// with no error anywhere (2026-10-24: 21 of 165 lines in the public
// wowarenalogs testlogs, an interesting-auras list of three pairs read as
// two triples). Skipped without the variable, like the other real-log
// suites; CI's `real-logs` job sets it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseLine } from "../src/l1/parseLine";

const FIX = process.env.GLADLOG_FIXTURES ?? "";
const files =
  FIX !== "" && existsSync(FIX)
    ? readdirSync(FIX).filter((f) => f.endsWith(".txt"))
    : [];
const d = files.length > 0 ? describe : describe.skip;

d("real logs: every COMBATANT_INFO decodes", () => {
  for (const f of files)
    it(f, () => {
      const bad: string[] = [];
      for (const raw of readFileSync(join(FIX, f), "utf8").split("\n")) {
        if (!raw.includes("  COMBATANT_INFO,")) continue;
        const p = parseLine(raw.replace(/\r$/, ""));
        if (!p?.combatantInfo) bad.push(raw.slice(0, 80));
      }
      expect(bad).toEqual([]);
    });
});
