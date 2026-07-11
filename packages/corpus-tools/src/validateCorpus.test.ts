import { describe, expect, it } from "vitest";
import { validateCorpus } from "./validateCorpus";
import type { Corpus } from "./cellAggregator";

function corpusWith(cell: any): Corpus {
  return {
    wowPatchVersion: "11.0.7",
    builtAt: "now",
    sourceFloor: 2300,
    cells: [cell],
  };
}
const goodCell = {
  spec: "RestorationShaman",
  bracket: "3v3",
  archetype: "cc_swap_burst",
  sampleN: 40,
  insufficient: false,
  metrics: { reactionLatency: { p10: 1, p50: 2, p90: 3, n: 40 } },
  exemplarCrises: [["[0:10] taken Chaos Bolt"]],
};

describe("validateCorpus", () => {
  it("passes a clean corpus", () => {
    expect(validateCorpus(corpusWith(goodCell), 30)).toEqual([]);
  });
  it("flags the 1.5 latency sentinel (0-record cell carrying 1.5)", () => {
    const bad = {
      ...goodCell,
      metrics: { reactionLatency: { p10: 1.5, p50: 1.5, p90: 1.5, n: 0 } },
    };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /1\.5 sentinel/.test(v)),
    ).toBe(true);
  });
  it("flags non-ASCII crisis spell names", () => {
    const bad = { ...goodCell, exemplarCrises: [["[0:10] 承受 混乱之箭"]] };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /non-ASCII/.test(v)),
    ).toBe(true);
  });
  it("flags a cell below floor not marked insufficient", () => {
    const bad = { ...goodCell, sampleN: 5, insufficient: false };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /insufficient/.test(v)),
    ).toBe(true);
  });
  it("flags missing/unknown wowPatchVersion", () => {
    const c = corpusWith(goodCell);
    c.wowPatchVersion = "unknown";
    expect(validateCorpus(c, 30).some((v) => /wowPatchVersion/.test(v))).toBe(
      true,
    );
  });
  it("flags a cell at/above floor wrongly marked insufficient", () => {
    const bad = { ...goodCell, sampleN: 40, insufficient: true };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /insufficient/.test(v)),
    ).toBe(true);
  });
});
