import { describe, expect, it } from "vitest";
import { cohortDims, type CohortDim } from "./cohortDims";

const dim = (partial: Partial<CohortDim>): CohortDim => ({
  key: "offensiveIndex",
  value: 0.31,
  p10: 0.2,
  p50: 0.49,
  p90: 0.7,
  percentile: 30,
  verdict: "bottom quartile",
  ...partial,
});

describe("cohortDims", () => {
  it("formats value + percentile labels, passes anchors through", () => {
    const [row] = cohortDims([dim({})]);
    expect(row.valueLabel).toBe("0.31");
    expect(row.percentileLabel).toBe("30th");
    expect(row.p90).toBe(0.7);
    expect(row.verdict).toBe("bottom quartile");
  });

  it("renders null value as N/A", () => {
    const [row] = cohortDims([dim({ value: null })]);
    expect(row.valueLabel).toBe("N/A");
    expect(row.value).toBeNull();
  });

  it("评分方向修正:正向指标 score=percentile,反向指标 score=100-percentile", () => {
    const [pos] = cohortDims([dim({ key: "offensiveIndex", percentile: 30 })]);
    expect(pos.score).toBe(30);
    const [neg] = cohortDims([
      dim({ key: "reactionLatency", percentile: 30 }),
    ]);
    expect(neg.score).toBe(70);
  });
});
