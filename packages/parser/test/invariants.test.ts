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
    // beyond the 5s tolerance (measured jitter peaks at 2.1s)
    cu.damageOut[1]!.timestamp = cu.damageOut[0]!.timestamp - 10_000;
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "monotonic")).toBe(true);
  });

  it("HP 超出 [0, maxHp] → hp-range 违规", () => {
    const m = parseSynth();
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u = Object.values(clone.units).find(
      (x) => x.advancedSamples.length > 0,
    )!;
    // beyond the 1.75× upper bound (measured maximum is 1.58×)
    u.advancedSamples[0]!.hp = u.advancedSamples[0]!.maxHp * 2;
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "hp-range")).toBe(true);
  });

  it("healAbsorbsIn (no eventName field) resolves to its SPELL_HEAL_ABSORBED line", () => {
    const m = parseSynth();
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u = Object.values(clone.units).find((x) => x.kind === "Player")!;
    const ts = clone.units[u.id]!.damageIn[0]?.timestamp ?? clone.startTime;
    const d = new Date(ts);
    const stamp = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}0`;
    clone.rawLines.push(
      `${stamp}  SPELL_HEAL_ABSORBED,Player-1-A,"A-X",0x548,0x80000000,${u.id},"B-X",0x512,0x80000000,356528,"Necrotic Wound",0x20,Player-3-C,"C-X",0x512,0x80000000,33110,"Prayer of Mending",0x2,3130,39135`,
    );
    u.healAbsorbsIn = [
      {
        timestamp: ts,
        absorbSpellId: 356528,
        absorbSpellName: "Necrotic Wound",
        absorbCasterId: "Player-1-A",
        healerId: "Player-3-C",
        healSpellId: 33110,
        healSpellName: "Prayer of Mending",
        absorbedAmount: 3130,
        totalAmount: 39135,
        lineIndex: clone.rawLines.length - 1,
      },
    ];
    const v = checkParserInvariants(clone);
    expect(v.filter((x) => x.code === "line-resolves")).toEqual([]);
    // negative control: pointing it at a different line still fails
    u.healAbsorbsIn[0]!.lineIndex = 0;
    expect(
      checkParserInvariants(clone).some((x) => x.code === "line-resolves"),
    ).toBe(true);
  });

  it("non-finite damage amount → hp-amount-finite violation", () => {
    const m = parseSynth();
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u = Object.values(clone.units).find((x) => x.damageIn.length > 0)!;
    u.damageIn[0]!.amount = NaN;
    const v = checkParserInvariants(clone);
    expect(v.some((x) => x.code === "hp-amount-finite")).toBe(true);
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
    // The positive case is already covered by the "zero violations" test
    // (line-resolves is part of it); here we verify the two ways it can break.
    const clone = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u = Object.values(clone.units).find((x) => x.damageOut.length > 0)!;
    u.damageOut[0]!.lineIndex = (u.damageOut[0]!.lineIndex ?? 0) + 1; // off by one line
    expect(
      checkParserInvariants(clone).some((x) => x.code === "line-resolves"),
    ).toBe(true);

    const clone2 = JSON.parse(JSON.stringify(m)) as GladMatchBase;
    const u2 = Object.values(clone2.units).find((x) => x.damageIn.length > 0)!;
    delete u2.damageIn[0]!.lineIndex; // anchor dropped
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
