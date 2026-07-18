import { describe, expect, it } from "vitest";

import { decodeHpTail } from "../src/l1/decoders";

// 非 advanced SPELL_DAMAGE 尾参 10 个:amount,base,overkill,school,resisted,
// blocked,absorbed,critical,glancing,crushing(parseLine slice(-10) 分支)
const base8 = ["g1", "A", "0x511", "0x0", "g2", "B", "0x10548", "0x0"];
const spell3 = ["116", "Frostbolt", "0x10"];

describe("decodeHpTail", () => {
  it("SPELL_DAMAGE(非 advanced):amount/critical 解出", () => {
    const params = [
      ...base8,
      ...spell3,
      "38000",
      "36000",
      "0",
      "16",
      "0",
      "0",
      "0",
      "1",
      "nil",
      "nil",
    ];
    const r = decodeHpTail("SPELL_DAMAGE", params);
    expect(r).toEqual({
      critical: true,
      amount: 38000,
      effectiveAmount: 38000,
    });
  });

  it("SPELL_PERIODIC_DAMAGE 非暴击 + overkill 扣减", () => {
    const params = [
      ...base8,
      ...spell3,
      "9000",
      "9000",
      "2000",
      "16",
      "0",
      "0",
      "0",
      "nil",
      "nil",
      "nil",
    ];
    const r = decodeHpTail("SPELL_PERIODIC_DAMAGE", params);
    expect(r).toEqual({ critical: false, amount: 9000, effectiveAmount: 7000 });
  });

  it("SPELL_HEAL:尾 5 参,overheal 扣减", () => {
    const params = [...base8, ...spell3, "20000", "20000", "5000", "0", "1"];
    const r = decodeHpTail("SPELL_HEAL", params);
    expect(r).toEqual({
      critical: true,
      amount: 20000,
      effectiveAmount: 15000,
    });
  });

  it("非 hp 事件与参数不足 → null", () => {
    expect(
      decodeHpTail("SPELL_CAST_SUCCESS", [...base8, ...spell3]),
    ).toBeNull();
    expect(decodeHpTail("SPELL_DAMAGE", ["1", "2"])).toBeNull();
    expect(decodeHpTail("SPELL_HEAL", [])).toBeNull();
  });
});
