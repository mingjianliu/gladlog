import { describe, expect, it } from "vitest";

import { findBrokenRoot } from "../src/utils/ccTrinketAnalysis";

// fact5 retest r1 (10299a17 0:12, d64022ad 0:27; user ruling 2026-10-26): a
// PvP trinket press names the root it removed; a root another logged cause
// ended (a dispel) before the press is not its (codex 20-F18-07 #1)
const START = 1_000_000;
const root = (extra: object = {}) => ({
  atSeconds: 10,
  durationSeconds: 2,
  spellId: "102359",
  spellName: "Mass Entanglement",
  sourceName: "Druid",
  sourceId: "Player-1",
  sourceSpec: "Balance Druid",
  ...extra,
});

describe("findBrokenRoot — the root a trinket press removed", () => {
  it("a root removed in the press's own ms is the press's", () => {
    expect(findBrokenRoot([root()], START, START + 12_000)?.spellName).toBe(
      "Mass Entanglement",
    );
  });
  it("a root a dispel removed before the press is not", () => {
    expect(
      findBrokenRoot(
        [root({ endedByLoggedCause: true as const })],
        START,
        START + 12_050,
      ),
    ).toBeUndefined();
  });
  it("no root windows, no root", () => {
    expect(findBrokenRoot(undefined, START, START + 12_000)).toBeUndefined();
  });
});
