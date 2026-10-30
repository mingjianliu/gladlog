import { describe, expect, it } from "vitest";

import {
  absorbContributionsInWindow,
  totalAbsorbedInWindow,
} from "../src/utils/absorbShields";

const ev = (spellId: string, ts: number, amount: number) => ({
  spellId,
  spellName: `spell-${spellId}`,
  absorbedAmount: amount,
  logLine: { timestamp: ts },
});

const unit = {
  absorbsIn: [
    ev("17", 1_000, 5_000), // 真言术盾
    ev("17", 2_000, 3_000),
    ev("11426", 2_500, 8_000), // 寒冰护体
    ev("17", 9_000, 9_999), // 窗口之外
  ],
} as never;

describe("吸收盾按实测吸收量计有效血量", () => {
  it("按护盾 id 聚合,窗口外的不计", () => {
    const rows = absorbContributionsInWindow(unit, 0, 5_000);
    // 金额并列时的先后是实现细节,不钉顺序 —— 按 id 排序后比较
    expect(
      rows
        .map((r) => [r.spellId, r.absorbedAmount, r.events])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["11426", 8_000, 1],
      ["17", 8_000, 2],
    ]);
    expect(totalAbsorbedInWindow(unit, 0, 5_000)).toBe(16_000);
  });

  it("护盾到期后的时间段不产生贡献(判据:只按实际吸收事件计)", () => {
    // 护盾在 3s 时失效 → 查询 3s 之后的窗口不应有它的贡献
    expect(absorbContributionsInWindow(unit, 3_000, 8_000)).toEqual([]);
    expect(totalAbsorbedInWindow(unit, 3_000, 8_000)).toBe(0);
  });

  it("过期未消耗的护盾贡献为 0(不臆造名义护盾值)", () => {
    const neverAte = { absorbsIn: [] } as never;
    expect(totalAbsorbedInWindow(neverAte, 0, 10_000)).toBe(0);
  });

  it("边界:窗口端点包含,零/负数额忽略", () => {
    const u = {
      absorbsIn: [ev("17", 1_000, 0), ev("17", 5_000, 100)],
    } as never;
    expect(totalAbsorbedInWindow(u, 1_000, 5_000)).toBe(100);
  });
});
