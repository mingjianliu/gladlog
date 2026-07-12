import { describe, expect, it } from "vitest";
import { interpolate, claimChecker } from "./claimChecker";

const facts = {
  offensiveIndex: "0.31",
  "offensiveIndex.cohortMedian": "0.49",
  "offensiveIndex.verdict": "bottom quartile of your cohort",
};

describe("interpolate", () => {
  it("substitutes known placeholders with their true values", () => {
    const out = interpolate(
      "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
      facts,
    );
    expect(out).toBe("You hit 0.31 vs 0.49.");
  });
  it("leaves an unknown placeholder as a marker (claimChecker will flag it)", () => {
    expect(interpolate("x {{bogus}} y", facts)).toContain("{{bogus}}");
  });
});

describe("claimChecker", () => {
  it("passes prose that only uses known placeholders + conversational numbers", () => {
    const r = claimChecker(
      "You landed {{offensiveIndex}} — {{offensiveIndex.verdict}}. In the first 2 minutes you improved.",
      facts,
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it("flags an unknown {{key}}", () => {
    const r = claimChecker("You hit {{fabricated}} damage.", facts);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => /fabricated/.test(v))).toBe(true);
  });
  it("flags a raw stat-like number outside a placeholder (the model wrote a bare stat)", () => {
    const r = claimChecker("Your offensive index of 0.85 is high.", facts);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => /0\.85/.test(v))).toBe(true);
  });
  it("flags a bare percentage outside a placeholder", () => {
    const r = claimChecker("You are in the 85% percentile.", facts);
    expect(r.ok).toBe(false);
  });
  it("flags a leading-dot decimal (.85) — no digit before the dot", () => {
    const r = claimChecker("Your index of .85 is high.", facts);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => /\.85/.test(v))).toBe(true);
  });
});
