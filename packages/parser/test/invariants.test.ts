import { describe, expect, it } from "vitest";

import { checkParserInvariants } from "../src/invariants";
import { GladLogParser } from "../src/api";
import { synthArenaLog } from "../src/testing/synthLog";
import type { GladMatch, GladMatchBase } from "../src/l3/model";

function parseSynth(): GladMatch {
  const parser = new GladLogParser();
  let match: GladMatch | null = null;
  parser.on("match", (m) => (match = m));
  for (const line of synthArenaLog().split("\n")) parser.push(line);
  parser.end();
  if (!match) throw new Error("synth log did not produce a match");
  return match;
}

describe("A2 parser 不变量", () => {
  it("合成日志:零违规(锁死物性断言)", () => {
    const m = parseSynth();
    expect(checkParserInvariants(m)).toEqual([]);
  });

  it("时间戳回退 → monotonic 违规", () => {
    const m = parseSynth();
    const u = Object.values(m.units).find((x) => x.damageOut.length > 1)!;
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const cu = clone.units[u.id]!;
    cu.damageOut[1]!.timestamp = cu.damageOut[0]!.timestamp - 10_000; // 超 5s 容忍(实测抖动最大 2.1s)
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "monotonic")).toBe(true);
  });

  it("HP 超出 [0, maxHp] → hp-range 违规", () => {
    const m = parseSynth();
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u = Object.values(clone.units).find(
      (x) => x.advancedSamples.length > 0,
    )!;
    u.advancedSamples[0]!.hp = u.advancedSamples[0]!.maxHp * 2; // 超 1.75× 上界(实测最大 1.58×)
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "hp-range")).toBe(true);
  });

  it("玩家死亡前 10s 无承伤 → death-has-damage 违规", () => {
    const m = parseSynth();
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const victim = Object.values(clone.units).find(
      (x) => x.kind === "Player" && x.deaths.length > 0,
    )!;
    victim.damageIn = [];
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "death-has-damage")).toBe(true);
  });

  it("lineIndex 错位/缺失 → line-resolves 违规(B2 溯源门规)", () => {
    const m = parseSynth();
    // 正例已由「零违规」用例覆盖(line-resolves 在其中);这里验两种坏法。
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u = Object.values(clone.units).find((x) => x.damageOut.length > 0)!;
    u.damageOut[0]!.lineIndex = (u.damageOut[0]!.lineIndex ?? 0) + 1; // 错位一行
    expect(
      checkParserInvariants(clone).some((x) => x.code === "line-resolves"),
    ).toBe(true);

    const clone2 = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u2 = Object.values(clone2.units).find((x) => x.damageIn.length > 0)!;
    delete u2.damageIn[0]!.lineIndex; // 丢锚点
    expect(
      checkParserInvariants(clone2).some((x) => x.code === "line-resolves"),
    ).toBe(true);
  });

  it("事件 lineIndex 全量对齐 rawLines(不只首个)", () => {
    const m = parseSynth();
    for (const u of Object.values(m.units)) {
      for (const arr of [u.damageOut, u.damageIn, u.auraEvents, u.deaths]) {
        for (const e of arr) {
          expect(e.lineIndex).toBeTypeOf("number");
          const raw = m.rawLines[e.lineIndex!]!;
          expect(raw).toContain(e.eventName);
        }
      }
    }
  });

  it("宠物 ownerId 悬空 → pet-owner-resolves 违规", () => {
    const m = parseSynth();
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const anyId = Object.keys(clone.units)[0]!;
    clone.units[anyId]!.ownerId = "Pet-0-404";
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "pet-owner-resolves")).toBe(true);
  });
});
