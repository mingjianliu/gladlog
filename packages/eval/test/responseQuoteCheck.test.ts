import { describe, expect, it } from "vitest";

import { checkResponseQuotes } from "../src/provenance/responseQuoteCheck";

const PROMPT = [
  "3:05–3:16  [DMG SPIKE]   2(FWarrior): 1.1M in 11s (80% -> 21% HP) (low 21% @3:12)",
  "2:47–3:08  [KILL WINDOW] on Affliction Warlock",
  "3:10  [STATE]   friends 1(RShaman):85 2(FWarrior):44 / enemies 4(MHunter):68",
].join("\n");

describe("checkResponseQuotes (GH #103 class C metric)", () => {
  it("classifies verbatim / re-cut / free-form ranges", () => {
    const r = checkResponseQuotes(
      "The 3:05–3:16 spike … the finish at 3:05–3:15 … and the 1:00–1:10 lull.",
      PROMPT,
    );
    expect(r.verbatimRanges).toBe(1);
    expect(r.recutRanges).toEqual([
      { range: "3:05–3:15", printed: ["3:05–3:16"] },
    ]);
    expect(r.freeFormRanges).toBe(1);
  });

  it("accepts a hyphen or spaced dash as a range separator", () => {
    expect(checkResponseQuotes("2:47 - 3:08", PROMPT).verbatimRanges).toBe(1);
  });

  it("supports HP quotes from the stamped second or a printed trough", () => {
    const r = checkResponseQuotes(
      "warrior 44% (3:10), low 21% @3:12, and 50% at 3:10",
      PROMPT,
    );
    expect(r.hpQuotes).toBe(3);
    expect(r.unsupportedHp).toEqual(["50%@3:10"]);
  });
});
