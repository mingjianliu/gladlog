// @vitest-environment jsdom
import {
  CAST_BAR_MAX_MS,
  castBarAt,
  deriveCastBars,
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
    // The first bar is cut off by the second re-cast; the SUCCESS belongs to
    // the second bar
    expect(bars[0]!).toMatchObject({ toMs: 2000, outcome: "cut" });
    expect(bars[1]!).toMatchObject({ toMs: 4200, outcome: "completed" });
  });

  it("旧存档无 castStarts 字段 → 空数组不炸", () => {
    expect(deriveCastBars(src({ casts: [] }), "u1")).toEqual([]);
  });
});

describe("排队窗口容差(2026-07-25 用户实测 10 例误掐修复)", () => {
  it("SUCCESS 晚于下一技能 start ≤400ms(客户端排队)→ 仍判完成", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 1000, spellId: 19750, spellName: "Flash of Light" },
          { timestamp: 2400, spellId: 51514, spellName: "Hex" },
        ],
        casts: [{ timestamp: 2500, spellId: 19750 }],
      }),
      "u1",
    );
    expect(bars[0]!).toMatchObject({ toMs: 2500, outcome: "completed" });
  });

  it("HAS TEETH:SUCCESS 晚于下一 start >400ms → 照旧判被掐", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 1000, spellId: 19750, spellName: "Flash of Light" },
          { timestamp: 2000, spellId: 51514, spellName: "Hex" },
        ],
        casts: [{ timestamp: 2500, spellId: 19750 }],
      }),
      "u1",
    );
    expect(bars[0]!.outcome).toBe("cut");
  });
});

describe("同技能连读:SUCCESS 只归一条读条(codex R6C-02 #4 / 20-F19-02)", () => {
  it("被踢的读条不配到下一次同技能读条的 SUCCESS", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 1000, spellId: 77472, spellName: "Healing Wave" },
          { timestamp: 9900, spellId: 77472, spellName: "Healing Wave" },
        ],
        casts: [{ timestamp: 11400, spellId: 77472 }],
      }),
      "u1",
    );
    expect(bars[0]!.outcome).toBe("cut");
    expect(bars[1]!).toMatchObject({ toMs: 11400, outcome: "completed" });
  });

  it("同毫秒:SUCCESS 行在下一次 START 行之前 → 归前一条,后一条不成零长", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          {
            timestamp: 108036,
            spellId: 188196,
            spellName: "Lightning Bolt",
            lineIndex: 7100,
          },
          {
            timestamp: 109759,
            spellId: 188196,
            spellName: "Lightning Bolt",
            lineIndex: 7210,
          },
        ],
        casts: [
          { timestamp: 109759, spellId: 188196, lineIndex: 7209 },
          { timestamp: 111500, spellId: 188196, lineIndex: 7300 },
        ],
      }),
      "u1",
    );
    expect(bars[0]!).toMatchObject({ toMs: 109759, outcome: "completed" });
    expect(bars[1]!).toMatchObject({ toMs: 111500, outcome: "completed" });
  });

  it("同毫秒且无行号(旧存档):SUCCESS 归前一条", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          { timestamp: 108036, spellId: 188196, spellName: "Lightning Bolt" },
          { timestamp: 109759, spellId: 188196, spellName: "Lightning Bolt" },
        ],
        casts: [
          { timestamp: 109759, spellId: 188196 },
          { timestamp: 111500, spellId: 188196 },
        ],
      }),
      "u1",
    );
    expect(bars[0]!).toMatchObject({ toMs: 109759, outcome: "completed" });
    expect(bars[1]!).toMatchObject({ toMs: 111500, outcome: "completed" });
  });

  it("HAS TEETH:SUCCESS 行在下一次 START 行之后 → 归后一条", () => {
    const bars = deriveCastBars(
      src({
        castStarts: [
          {
            timestamp: 108036,
            spellId: 188196,
            spellName: "Lightning Bolt",
            lineIndex: 7100,
          },
          {
            timestamp: 109759,
            spellId: 188196,
            spellName: "Lightning Bolt",
            lineIndex: 7209,
          },
        ],
        casts: [{ timestamp: 109759, spellId: 188196, lineIndex: 7210 }],
      }),
      "u1",
    );
    expect(bars[0]!.outcome).toBe("cut");
    expect(bars[1]!).toMatchObject({ toMs: 109759, outcome: "completed" });
  });
});
