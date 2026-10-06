import { describe, expect, it } from "vitest";

import { checkPercentileMonotonicity } from "./promptQualityCheck";

/**
 * The deterministic gate for inverted percentiles.
 *
 * In the 2026-07-20 50-match healer eval, 11 matches showed an inverted
 * `INCOMING DAMAGE BASELINES` block. This class of bad data is always "numbers
 * that look fine" with only the ordering wrong, which both the model and a human
 * find extremely hard to spot — yet it violates a hard constraint, so a
 * deterministic check catches every instance without depending on model
 * judgment at all.
 */
describe("checkPercentileMonotonicity", () => {
  it("**回归**:线上真实坏行 —— MM 猎人 p50 > p90", () => {
    const v = checkPercentileMonotonicity([
      "INCOMING DAMAGE BASELINES (per 10s window, ≥2100 personal rating):",
      "  Marksmanship Hunter (n=87): p50 214k | p90 65k",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("line 2");
    expect(v[0]).toContain("百分位倒置");
  });

  it("**回归**:线上真实坏行 —— Arms 战士 p75 塌陷", () => {
    const v = checkPercentileMonotonicity([
      "  Arms Warrior (n=58): p50 314k | p75 12k | p90 302k | p95 477k",
    ]);
    expect(v).toHaveLength(1);
  });

  it("正常行不误报", () => {
    const v = checkPercentileMonotonicity([
      "INCOMING DAMAGE BASELINES (per 10s window, ≥2100 personal rating):",
      "  Fury Warrior (n=9): p50 187k | p90 527k",
      "  Beast Mastery Hunter (n=9): p50 112k | p90 486k",
      "  Discipline Priest (n=220): p50 98k | p75 180k | p90 265k | p95 310k",
    ]);
    expect(v).toEqual([]);
  });

  it("相等值合法(单调不减,非严格递增)", () => {
    expect(
      checkPercentileMonotonicity([
        "  Fury Warrior (n=9): p90 154k | p95 154k",
      ]),
    ).toEqual([]);
  });

  it("单个百分位记号不触发", () => {
    expect(checkPercentileMonotonicity(["  Arms Warrior: p90 302k"])).toEqual(
      [],
    );
  });

  it("不同单位互不比较 —— 同行的 k 与 s 是两个序列", () => {
    // A mixed line like "p50 12s median | p90 300k damage" must not be flagged
    // as inverted.
    expect(
      checkPercentileMonotonicity(["  Foo: p50 12s | p90 8s | p50 100k"]),
      // only the s sequence is inverted (12s > 8s); the k sequence has one token
    ).toHaveLength(1);
  });

  it("多行各自独立判定,行号正确", () => {
    const v = checkPercentileMonotonicity([
      "  ok: p50 1k | p90 2k",
      "  bad: p50 9k | p90 2k",
      "  ok: p50 1k | p90 2k",
      "  bad: p50 9k | p90 2k",
    ]);
    expect(v).toHaveLength(2);
    expect(v[0]).toContain("line 2");
    expect(v[1]).toContain("line 4");
  });

  it("空输入 → 无违规", () => {
    expect(checkPercentileMonotonicity([])).toEqual([]);
  });
});
