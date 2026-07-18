import { describe, expect, it } from "vitest";

import { deriveDetailBreakdown } from "../src/renderer/src/report/derive/detailBreakdown";
import { meterValue } from "../src/renderer/src/report/derive/meterRows";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();
const src = base as unknown as ReportSource;

describe("deriveDetailBreakdown", () => {
  it("三模式合计对账 meterValue(全玩家)", () => {
    for (const t of deriveSummary(src)) {
      for (const mode of ["damage", "healing", "taken"] as const) {
        const { rows } = deriveDetailBreakdown(src, t.unitId, mode);
        const sum = rows.reduce((a, r) => a + r.total, 0);
        expect(Math.round(sum)).toBe(Math.round(meterValue(t, mode)));
      }
    }
  });

  it("damage:按 total 降序,share 合计≈100,hits/maxHit 有值", () => {
    const t = deriveSummary(src)[0]!; // 输出最高者
    const { rows } = deriveDetailBreakdown(src, t.unitId, "damage");
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i]!.total).toBeLessThanOrEqual(rows[i - 1]!.total);
    const share = rows.reduce((a, r) => a + r.sharePct, 0);
    expect(share).toBeGreaterThan(99);
    expect(share).toBeLessThan(101);
    expect(rows[0]!.hits).toBeGreaterThan(0);
    expect(rows[0]!.maxHit).toBeGreaterThan(0);
  });

  it("裁剪 fixture 无 params → critAvailable=false", () => {
    const t = deriveSummary(src)[0]!;
    const { critAvailable, rows } = deriveDetailBreakdown(
      src,
      t.unitId,
      "damage",
    );
    expect(critAvailable).toBe(false);
    expect(rows.every((r) => r.critPct === null)).toBe(true);
  });

  it("注入带 params 的合成伤害 → critPct 正确(2 暴击/4 次=50%)", () => {
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    const u = Object.values(clone.units).find(
      (x) => (x as { kind?: string }).kind === "Player",
    ) as unknown as {
      id: string;
      damageOut: Array<Record<string, unknown>>;
    };
    const base8 = ["g1", "A", "0x511", "0x0", "g2", "B", "0x10548", "0x0"];
    const spell3 = ["999001", "TestBolt", "0x10"];
    const mk = (crit: boolean) => ({
      timestamp: clone.startTime + 1000,
      eventName: "SPELL_DAMAGE",
      spellId: 999001,
      spellName: "TestBolt",
      srcId: u.id,
      srcName: "A",
      destId: "g2",
      destName: "B",
      amount: 1000,
      effectiveAmount: 1000,
      params: [
        ...base8,
        ...spell3,
        "1000",
        "1000",
        "0",
        "16",
        "0",
        "0",
        "0",
        crit ? "1" : "nil",
        "nil",
        "nil",
      ],
    });
    u.damageOut.push(mk(true), mk(true), mk(false), mk(false));
    const { rows, critAvailable } = deriveDetailBreakdown(
      clone as unknown as ReportSource,
      u.id,
      "damage",
    );
    const row = rows.find((r) => r.spellId === "999001");
    expect(critAvailable).toBe(true);
    expect(row!.critPct).toBe(50);
    expect(row!.hits).toBe(4);
    expect(row!.maxHit).toBe(1000);
  });

  it("healing:absorbsOut 出 isAbsorb 行,过量% 界内", () => {
    const healer = deriveSummary(src)
      .slice()
      .sort(
        (a, b) =>
          b.healingDone + b.absorbsDone - (a.healingDone + a.absorbsDone),
      )[0]!;
    const { rows } = deriveDetailBreakdown(src, healer.unitId, "healing");
    for (const r of rows) {
      if (r.overhealPct !== undefined) {
        expect(r.overhealPct).toBeGreaterThanOrEqual(0);
        expect(r.overhealPct).toBeLessThanOrEqual(100);
      }
      if (r.isAbsorb) expect(r.overhealPct).toBeUndefined();
    }
  });
});
