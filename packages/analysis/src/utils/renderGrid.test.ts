import { describe, expect, it } from "vitest";

import { fmtTime, toRenderSecond } from "./cooldowns";

/**
 * 渲染网格谓词的回归护栏。
 *
 * 2026-07-20 实证(A 类,26/50 场、33 处):`[STATE]` 按整数秒采样,
 * `[DMG SPIKE]` 按 `pw.fromSeconds`(小数秒)采样,两者却渲染成同一个显示秒,
 * 于是同一时间戳下两个 HP 数字互相矛盾(中位 7pp,最大 25pp)。
 *
 * 关键教训:**这不是采样半径问题**。getUnitHpAtTimestamp 先取最近样本、再用
 * 半径决定接受与否 —— 改半径只会把值变成 null,永远不会改变数值。当初按
 * 「统一半径」修的那一版实测 26/50 → 26/50,一个数都没动;改成对齐查询时刻后
 * 才 26/50 → 0/50。任何「两处数值不一致」的问题,先问它们查的是不是同一时刻。
 */
describe("toRenderSecond:采样网格必须与渲染网格一致", () => {
  it("与 fmtTime 同一取整规则 —— 这是它存在的全部意义", () => {
    for (const t of [0, 0.001, 0.4, 0.999, 1, 27.4, 59.9, 60, 108.6, 3599.99]) {
      expect(fmtTime(t)).toBe(fmtTime(toRenderSecond(t)));
    }
  });

  it("向下取整,不是四舍五入", () => {
    expect(toRenderSecond(27.9)).toBe(27);
    expect(toRenderSecond(27.1)).toBe(27);
    expect(toRenderSecond(27)).toBe(27);
  });

  it("已在网格上的整数秒是不动点(幂等)", () => {
    for (const t of [0, 1, 42, 300]) {
      expect(toRenderSecond(t)).toBe(t);
      expect(toRenderSecond(toRenderSecond(t))).toBe(t);
    }
  });

  it("**核心不变量**:渲染成同一秒的任意两个时刻,采样网格也必须相同", () => {
    // 这正是 A 类缺陷的形态:27.0 与 27.9 渲染都是 "0:27",
    // 若各自按原值采样就会命中不同的 advancedAction。
    const pairs: Array<[number, number]> = [
      [27.0, 27.9],
      [108.2, 108.75],
      [59.0, 59.99],
    ];
    for (const [a, b] of pairs) {
      expect(fmtTime(a)).toBe(fmtTime(b));
      expect(toRenderSecond(a)).toBe(toRenderSecond(b));
    }
  });
});
