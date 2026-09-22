import { describe, expect, it } from "vitest";

import { parseNonNegativeInt } from "../scripts/offcdExampleGen";

describe("offcdExampleGen parseNonNegativeInt", () => {
  it("parses valid non-negative integer", () => {
    expect(parseNonNegativeInt("--offset", 0, ["--offset", "5"])).toBe(5);
    expect(parseNonNegativeInt("--limit", 40, [])).toBe(40);
    expect(parseNonNegativeInt("--limit", 40, ["--limit", "0"])).toBe(0);
  });

  it("throws on negative or non-integer input", () => {
    expect(() =>
      parseNonNegativeInt("--offset", 0, ["--offset", "-1"]),
    ).toThrow();
    expect(() =>
      parseNonNegativeInt("--limit", 40, ["--limit", "foo"]),
    ).toThrow();
    expect(() =>
      parseNonNegativeInt("--limit", 40, ["--limit", "2.5"]),
    ).toThrow();
  });
});
