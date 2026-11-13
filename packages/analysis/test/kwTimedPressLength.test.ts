import { describe, expect, it } from "vitest";

import { kwTimedPressLengthS } from "../src/utils/offensiveWindows";

// the one reading of "how long a press holds `not defenseless`" the span's
// state machine and corpusFactScan4's defenselessExternalCaster share
describe("kwTimedPressLengthS", () => {
  const unit = {
    id: "p",
    auraEvents: [],
    spellCastEvents: [],
    info: { talents: [], pvpTalents: [] },
  } as never;

  it("一个自保按键按它的官方时长计", () => {
    expect(kwTimedPressLengthS(unit, "45438", 0)).toBe(10); // Ice Block
    expect(kwTimedPressLengthS(unit, "64843", 0)).toBe(5); // Divine Hymn
  });

  it("进攻大招不计时(codex 85-tk-J-T74-1 #1)", () => {
    expect(kwTimedPressLengthS(unit, "31884", 0)).toBeNull(); // Avenging Wrath
  });

  it("只能给队友的外部技能不计时", () => {
    expect(kwTimedPressLengthS(unit, "6940", 0)).toBeNull(); // Blessing of Sacrifice
  });
});
