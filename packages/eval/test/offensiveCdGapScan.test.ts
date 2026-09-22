import { describe, expect, it } from "vitest";

import {
  mergeIntervals,
  parseNonNegativeInt,
  parsePositiveInt,
} from "../scripts/offensiveCdGapScan";

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals", () => {
    const input: Array<[number, number]> = [
      [10, 20],
      [15, 25],
      [25, 30],
      [40, 50],
    ];
    expect(mergeIntervals(input)).toEqual([
      [10, 30],
      [40, 50],
    ]);
  });

  it("filters out degenerate intervals where end <= start", () => {
    const input: Array<[number, number]> = [
      [20, 10],
      [15, 15],
      [0, 5],
    ];
    expect(mergeIntervals(input)).toEqual([[0, 5]]);
  });

  it("handles unsorted inputs and nested intervals", () => {
    const input: Array<[number, number]> = [
      [50, 60],
      [10, 40],
      [15, 25],
    ];
    expect(mergeIntervals(input)).toEqual([
      [10, 40],
      [50, 60],
    ]);
  });
});

describe("parseNonNegativeInt & parsePositiveInt", () => {
  it("parses valid non-negative integer", () => {
    expect(parseNonNegativeInt("--offset", 0, ["--offset", "5"])).toBe(5);
    expect(parseNonNegativeInt("--offset", 10, [])).toBe(10);
    expect(parseNonNegativeInt("--offset", 0, ["--offset", "0"])).toBe(0);
  });

  it("throws on invalid non-negative integer", () => {
    expect(() =>
      parseNonNegativeInt("--offset", 0, ["--offset", "-1"]),
    ).toThrow();
    expect(() =>
      parseNonNegativeInt("--offset", 0, ["--offset", "abc"]),
    ).toThrow();
    expect(() =>
      parseNonNegativeInt("--offset", 0, ["--offset", "1.5"]),
    ).toThrow();
  });

  it("parses valid positive integer", () => {
    expect(parsePositiveInt("--every", 1, ["--every", "2"])).toBe(2);
    expect(parsePositiveInt("--every", 1, [])).toBe(1);
  });

  it("throws on zero or negative for positive integer", () => {
    expect(() => parsePositiveInt("--every", 1, ["--every", "0"])).toThrow();
    expect(() => parsePositiveInt("--every", 1, ["--every", "-5"])).toThrow();
  });
});
