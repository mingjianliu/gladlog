import { describe, expect, it } from "vitest";

import { checkPercentileMonotonicity } from "./promptQualityCheck";

/**
 * 百分位倒置的确定性门规。
 *
 * 2026-07-20 的 50 场 healer eval 里 11 场读到倒置的 `INCOMING DAMAGE BASELINES`。
 * 这类坏数据全是「看起来正常的数字」,只是顺序不对,模型和人都极难发现 ——
 * 但它是硬约束违反,确定性检查一抓一个准,且完全不依赖模型判断。
 */
describe("checkPercentileMonotonicity", () => {
  it("**回归**:线上真实坏行 —— MM 猎人 p50 > p90", () => {
    const v = checkPercentileMonotonicity([
      "INCOMING DAMAGE BASELINES (per 10s window, ≥2100 MMR):",
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
      "INCOMING DAMAGE BASELINES (per 10s window, ≥2100 MMR):",
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
    // 「p50 12s median | p90 300k damage」这类混排行不该被判倒置。
    expect(
      checkPercentileMonotonicity(["  Foo: p50 12s | p90 8s | p50 100k"]),
    ).toHaveLength(1); // 只有 s 序列倒置(12s > 8s),k 序列只有一个记号
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
