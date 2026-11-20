/**
 * Pipeline T234 (T228's bound, one predicate): a `damageIn` row is the
 * round's damage when it is a landed hit logged no later than the round's
 * end. A Solo Shuffle round ends at its deciding death; the unit arrays keep
 * the seconds after it.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { isRoundLandedDamageRow } from "../src/utils/incomingPressure";

const END = 1_042_300;
const unit = { id: "victim", reaction: CombatUnitReaction.Friendly };
const row = (ms: number, more: object = {}) => ({
  logLine: { timestamp: ms },
  spellId: "686",
  srcUnitId: "enemy-1",
  srcUnitFlags: 0x548,
  ...more,
});

describe("isRoundLandedDamageRow", () => {
  it("回合结束那一毫秒及之前的命中算,之后的不算", () => {
    expect(isRoundLandedDamageRow(unit, row(END - 1), undefined, END)).toBe(
      true,
    );
    expect(isRoundLandedDamageRow(unit, row(END), undefined, END)).toBe(true);
    expect(isRoundLandedDamageRow(unit, row(END + 1), undefined, END)).toBe(
      false,
    );
  });
  it("回合内队友转移过来的血量不算 (T223 的同一判据)", () => {
    expect(
      isRoundLandedDamageRow(
        unit,
        row(END - 1, {
          spellId: "451963",
          srcUnitId: "mate",
          srcUnitFlags: 0x511,
        }),
        undefined,
        END,
      ),
    ).toBe(false);
  });
  it("没有回合结束时间(手搭的 combat)就不设边界;只带 timestamp 的行也读得到", () => {
    expect(
      isRoundLandedDamageRow(unit, row(END + 5_000), undefined, undefined),
    ).toBe(true);
    expect(
      isRoundLandedDamageRow(
        unit,
        {
          timestamp: END + 1,
          spellId: "686",
          srcUnitId: "enemy-1",
          srcUnitFlags: 0x548,
        },
        undefined,
        END,
      ),
    ).toBe(false);
  });
});
