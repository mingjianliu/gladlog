/**
 * Pipeline T228: an aligned burst window's pressured-unit pick reads the
 * same rows as the window's damage total — landed, and inside the round.
 * A Solo Shuffle round's `endTime` is the deciding death; the unit arrays
 * keep the rows of the seconds after it, and the pick alone read them
 * (605: s2/102 r5 2:29–2:41, a unit named by 92k it took after the round
 * was decided, over the unit that took the most inside it).
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const hit = (s: number, amount: number) => ({
  logLine: { timestamp: at(s) },
  effectiveAmount: -amount,
});

function pick(lateOnB: number): string | undefined {
  const cast = (id: string, spell: string, name: string, s: number) =>
    makeSpellCastEvent(spell, at(s), id, "Self", id, name);
  const e1 = makeUnit("e1", {
    name: "Warrior",
    spec: CombatUnitSpec.Warrior_Arms,
    spellCastEvents: [cast("e1", "107574", "Warrior", 10)],
  });
  const e2 = makeUnit("e2", {
    name: "Mage",
    spec: CombatUnitSpec.Mage_Fire,
    spellCastEvents: [cast("e2", "190319", "Mage", 12)],
  });
  const owner = makeUnit("h1", {
    name: "Healer",
    spec: CombatUnitSpec.Priest_Holy,
  });
  // A took the most inside the round; B took less inside it and more after
  const a = makeUnit("fa", {
    name: "A",
    damageIn: [hit(13, 200_000)] as never,
  });
  const b = makeUnit("fb", {
    name: "B",
    damageIn: [hit(13, 150_000), hit(17, lateOnB)] as never,
  });
  // the round was decided at 15 s; the window runs past it
  const res = reconstructEnemyCDTimeline(
    [e1, e2] as never,
    { startTime: T0, endTime: at(15) } as never,
    owner as never,
    [a, b] as never,
  );
  expect(res.alignedBurstWindows).toHaveLength(1);
  expect(res.alignedBurstWindows[0]!.toSeconds).toBeGreaterThan(15);
  return res.alignedBurstWindows[0]!.mostPressuredTarget?.unitName;
}

describe("T228 — 被压单位的选取止于回合结束,与窗口伤害总量同一个界", () => {
  it("回合结束后的伤害不参与选取", () => {
    expect(pick(100_000)).toBe("A");
  });
  it("对照:没有回合后的伤害时同样选 A(回合内最多的)", () => {
    expect(pick(0)).toBe("A");
  });
});
