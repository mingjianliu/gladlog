import { describe, expect, it } from "vitest";

import { claimChecker, interpolate, scrubExemplar } from "./claimChecker";

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
  it("flags a word-form percentage (100 percent), not just the % symbol", () => {
    const r = claimChecker("You used 100 percent of your cooldowns.", facts);
    expect(r.ok).toBe(false);
  });
});

describe("scrubExemplar(以 claimChecker 自身为 oracle)", () => {
  it("crisisEvents 真实形状:时间戳与 HP% 洗掉,技能序列保留", () => {
    const s = scrubExemplar(
      "At 19.3s (Teammate Restoration Druid HP: 36%): Swiftmend -> Lifebloom",
    );
    expect(s).toBe("(Teammate Restoration Druid HP low): Swiftmend -> Lifebloom");
  });
  it("洗后必过门规(所有陷阱形状)", () => {
    const nasty = [
      "At 160.5s (Teammate X HP: 8%): Holy Word: Serenity",
      "at 0.5s late, 40% HP, .85 ratio, 90th percentile play",
      "100 percent uptime with 27% HP at 80.2",
    ];
    for (const n of nasty) {
      const r = claimChecker(scrubExemplar(n), {});
      expect(r.violations).toEqual([]);
    }
  });
  it("无违禁内容的文本原样通过", () => {
    expect(scrubExemplar("Pain Suppression -> Flash Heal")).toBe(
      "Pain Suppression -> Flash Heal",
    );
  });
});
