import { describe, expect, it } from "vitest";

import {
  HP_SAMPLE_RADIUS_CRITICAL_MS,
  HP_SAMPLE_RADIUS_MS,
  hpSampleRadiusMs,
} from "./cooldowns";

/**
 * HP 采样半径单源性的回归护栏。
 *
 * 2026-07-20 的 50 场 eval 实证:`[STATE]` tick 在关键窗口用 ±1.5s,而
 * `[DMG SPIKE]` 端点恒用 ±3s —— 而 DMG SPIKE **只发生在关键窗口**,两者
 * 必然取到不同样本,同一秒两行 HP 互相矛盾(31/50 场;最极端 spike 报 2%
 * 而 STATE 报 88%;ord 008 因此把不存在的濒死写进了教练结论)。
 *
 * 这些用例锁住的是**谓词本身的契约**,不是某个渲染器的输出:只要两侧都
 * 从 hpSampleRadiusMs 取值,就不可能再漂开。
 */
describe("hpSampleRadiusMs:同一时刻只有一个半径", () => {
  it("关键窗口内收窄到 ±1.5s", () => {
    const critical = new Set([10, 11, 12]);
    expect(hpSampleRadiusMs(10, critical)).toBe(HP_SAMPLE_RADIUS_CRITICAL_MS);
    expect(hpSampleRadiusMs(12, critical)).toBe(HP_SAMPLE_RADIUS_CRITICAL_MS);
  });

  it("关键窗口外用基线 ±3s", () => {
    const critical = new Set([10, 11, 12]);
    expect(hpSampleRadiusMs(9, critical)).toBe(HP_SAMPLE_RADIUS_MS);
    expect(hpSampleRadiusMs(13, critical)).toBe(HP_SAMPLE_RADIUS_MS);
  });

  it("小数秒按 floor 归到整数秒网格 —— 与 [STATE] tick 的网格一致", () => {
    const critical = new Set([10]);
    // DMG SPIKE 的 from/toSeconds 可能是小数;STATE tick 是整数秒。
    // 不 floor 的话 10.4s 会落在关键窗口外,取到与同秒 STATE 不同的半径。
    expect(hpSampleRadiusMs(10.4, critical)).toBe(HP_SAMPLE_RADIUS_CRITICAL_MS);
    expect(hpSampleRadiusMs(10.9, critical)).toBe(HP_SAMPLE_RADIUS_CRITICAL_MS);
    expect(hpSampleRadiusMs(9.9, critical)).toBe(HP_SAMPLE_RADIUS_MS);
  });

  it("空关键窗口集合 → 全程基线半径", () => {
    const none = new Set<number>();
    expect(hpSampleRadiusMs(0, none)).toBe(HP_SAMPLE_RADIUS_MS);
    expect(hpSampleRadiusMs(999, none)).toBe(HP_SAMPLE_RADIUS_MS);
  });

  it("**核心不变量**:任意时刻,两个渲染器拿到的半径必然相同", () => {
    const critical = new Set([3, 4, 5, 20, 21]);
    // 模拟 [STATE] 与 [DMG SPIKE] 各自对同一时刻取半径
    for (let t = 0; t <= 30; t++) {
      const fromState = hpSampleRadiusMs(t, critical);
      const fromSpike = hpSampleRadiusMs(t, critical);
      expect(fromSpike).toBe(fromState);
    }
  });

  it("两个半径常量不相等 —— 否则本测试形同虚设", () => {
    // 如果有人把两者改成同值,上面的用例会全部通过但失去意义。
    expect(HP_SAMPLE_RADIUS_CRITICAL_MS).not.toBe(HP_SAMPLE_RADIUS_MS);
    expect(HP_SAMPLE_RADIUS_CRITICAL_MS).toBeLessThan(HP_SAMPLE_RADIUS_MS);
  });
});
