import { describe, expect, it } from "vitest";
import { verifiedComparison, percentileRank } from "./verifiedComparison";
import type { ReferenceCell } from "./corpusTypes";

describe("percentileRank (piecewise-linear over p10/p50/p90)", () => {
  const d = { p10: 0.2, p50: 0.49, p90: 0.7 };
  it("maps p50 to ~50 and clamps the ends", () => {
    expect(percentileRank(0.49, d)).toBeCloseTo(50, 0);
    expect(percentileRank(0.2, d)).toBeCloseTo(10, 0);
    expect(percentileRank(0.7, d)).toBeCloseTo(90, 0);
    expect(percentileRank(0.05, d)).toBe(10); // below p10 clamps to 10
    expect(percentileRank(0.9, d)).toBe(90); // above p90 clamps to 90
  });
});

describe("verifiedComparison", () => {
  const cell: ReferenceCell = {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    insufficient: false,
    metrics: { offensiveIndex: { p10: 0.2, p50: 0.49, p90: 0.7, n: 40 } },
    exemplarCrises: [],
  };
  it("emits a dim + facts entries for a present metric", () => {
    const vc = verifiedComparison({ offensiveIndex: 0.31 }, cell);
    const dim = vc.dims.find((x) => x.key === "offensiveIndex")!;
    expect(dim.value).toBe(0.31);
    expect(dim.percentile).toBeGreaterThan(10);
    expect(dim.percentile).toBeLessThan(50);
    expect(dim.verdict).toMatch(/quartile|mid-pack/);
    expect(vc.facts["offensiveIndex"]).toBe("0.31");
    expect(vc.facts["offensiveIndex.cohortMedian"]).toBe("0.49");
    expect(vc.facts["offensiveIndex.verdict"]).toBe(dim.verdict);
  });
  it("skips metrics the cell has no distribution for, and null user values", () => {
    const vc = verifiedComparison({ offensiveIndex: null, ccDensity: 1 }, cell);
    expect(vc.dims.find((x) => x.key === "offensiveIndex")).toBeUndefined();
    expect(vc.dims.find((x) => x.key === "ccDensity")).toBeUndefined(); // no dist in cell
  });
});
