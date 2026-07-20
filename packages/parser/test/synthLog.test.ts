import { GladLogParser } from "../src/api";
import type { GladMatch } from "../src/l3/model";
import { synthArenaLog } from "../src/testing/synthLog";

function parse(text: string): GladMatch[] {
  const out: GladMatch[] = [];
  const p = new GladLogParser({ timezone: "UTC" });
  p.on("match", (m) => out.push(m));
  for (const line of text.split("\n")) {
    if (line.trim()) {
      p.push(line);
    }
  }
  p.end();
  return out;
}

describe("synthArenaLog", () => {
  it("默认产出恰好一场可解析的 3v3", () => {
    const matches = parse(synthArenaLog());
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bracket).toBe("3v3");
  });

  it("含 6 名玩家、伤害与治疗、至少一次死亡", () => {
    const m = parse(synthArenaLog())[0]!;
    const units = Object.values(m.units);
    expect(units.filter((u) => u.kind === "Player")).toHaveLength(6);
    expect(units.some((u) => (u.damageOut ?? []).length > 0)).toBe(true);
    expect(units.some((u) => (u.healOut ?? []).length > 0)).toBe(true);
    expect(units.some((u) => (u.deaths ?? []).length > 0)).toBe(true);
  });

  it("确定性:同参数两次生成逐字节相同", () => {
    expect(synthArenaLog()).toBe(synthArenaLog());
  });

  it("eventsPerRound 可放大体积(供预算测试造大日志)", () => {
    const small = synthArenaLog({ eventsPerRound: 50 });
    const big = synthArenaLog({ eventsPerRound: 500 });
    expect(big.length).toBeGreaterThan(small.length * 5);
    expect(parse(big)).toHaveLength(1);
  });
});
