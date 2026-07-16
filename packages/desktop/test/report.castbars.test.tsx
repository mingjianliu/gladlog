// @vitest-environment jsdom
import {
  castBarAt,
  deriveCastBars,
  CAST_BAR_MAX_MS,
} from "../src/renderer/src/report/derive/castBars";
import type { ReportSource } from "../src/renderer/src/report/derive/types";

function src(unit: Record<string, unknown>): ReportSource {
  return { units: { u1: { id: "u1", ...unit } } } as unknown as ReportSource;
}

describe("真读条条(#11b 完全版)", () => {
  it("start→同技能 SUCCESS = completed,条长 = 实际读条时长", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 1000, spellId: 30451, spellName: "Arcane Blast" },
        ],
        casts: [{ timestamp: 3200, spellId: 30451 }],
      }),
      "u1",
    );
    expect(bars).toEqual([
      {
        unitId: "u1",
        spellId: 30451,
        spellName: "Arcane Blast",
        fromMs: 1000,
        toMs: 3200,
        outcome: "completed",
      },
    ]);
    expect(castBarAt(bars, 2000)!.spellName).toBe("Arcane Blast");
    expect(castBarAt(bars, 5000)).toBeNull();
  });

  it("无 SUCCESS:下一次 CAST_START 掐断;无后续则 4s 兜底,outcome=cut", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 1000, spellId: 30451, spellName: "Arcane Blast" },
          { timestamp: 2500, spellId: 118, spellName: "Polymorph" },
        ],
        casts: [],
      }),
      "u1",
    );
    expect(bars[0]!).toMatchObject({ toMs: 2500, outcome: "cut" });
    expect(bars[1]!).toMatchObject({
      toMs: 2500 + CAST_BAR_MAX_MS,
      outcome: "cut",
    });
  });

  it("SUCCESS 属于下一次读条时不误配(同技能重读)", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 1000, spellId: 30451, spellName: "Arcane Blast" },
          { timestamp: 2000, spellId: 30451, spellName: "Arcane Blast" },
        ],
        casts: [{ timestamp: 4200, spellId: 30451 }],
      }),
      "u1",
    );
    // 第一条被第二次重读掐断;SUCCESS 归第二条
    expect(bars[0]!).toMatchObject({ toMs: 2000, outcome: "cut" });
    expect(bars[1]!).toMatchObject({ toMs: 4200, outcome: "completed" });
  });

  it("旧存档无 castStarts 字段 → 空数组不炸", () => {
    expect(deriveCastBars(src({ casts: [] }), "u1")).toEqual([]);
  });
});
