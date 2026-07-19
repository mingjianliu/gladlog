import {
  clampSplitRatio,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
} from "./useReplayLayout";

describe("clampSplitRatio", () => {
  it("低于下限夹到 SPLIT_MIN", () => {
    expect(clampSplitRatio(0.05)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(0)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(-3)).toBe(SPLIT_MIN);
  });

  it("高于上限夹到 SPLIT_MAX", () => {
    expect(clampSplitRatio(0.95)).toBe(SPLIT_MAX);
    expect(clampSplitRatio(1)).toBe(SPLIT_MAX);
    expect(clampSplitRatio(42)).toBe(SPLIT_MAX);
  });

  it("范围内原样返回", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(SPLIT_MIN)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(SPLIT_MAX)).toBe(SPLIT_MAX);
  });

  it("非有限值落回默认(localStorage 读到脏数据)", () => {
    expect(clampSplitRatio(NaN)).toBe(SPLIT_DEFAULT);
    expect(clampSplitRatio(Infinity)).toBe(SPLIT_DEFAULT);
    expect(clampSplitRatio(-Infinity)).toBe(SPLIT_DEFAULT);
    expect(clampSplitRatio(undefined as unknown as number)).toBe(SPLIT_DEFAULT);
  });
});
