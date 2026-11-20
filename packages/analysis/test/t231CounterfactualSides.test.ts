/**
 * Pipeline T231, codex 85-tk-WIN-T231-1 #1: the percentage counterfactuals
 * (`windowDamage`, the mitigation audit, the missed-save pricing) read the
 * round's roster sides, as the Time Dilation path does — a teammate's moved
 * health is no hit even when the row's flags were written from a charmed
 * recorder's point of view.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { windowDamage } from "../src/utils/counterfactual";
import { buildRosterSides } from "../src/utils/rosterSide";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const row = (s: number, amount: number, more: object) =>
  ({
    logLine: { event: "SPELL_DAMAGE", timestamp: at(s), parameters: [] },
    timestamp: at(s),
    amount: -amount,
    effectiveAmount: -amount,
    spellSchoolId: "0x20",
    ...more,
  }) as never;

describe("T231 — 反事实的伤害读法带上队伍归属", () => {
  // the mate's Void Leech row carries hostile flags (the recorder was
  // charmed when it was written): only the roster says it is the victim's
  // own side
  const victim = makeUnit("victim", {
    reaction: CombatUnitReaction.Friendly,
    damageIn: [
      row(10, 400_000, {
        spellId: "686",
        spellName: "Shadow Bolt",
        srcUnitId: "enemy-1",
        srcUnitFlags: 0x548,
      }),
      row(11, 400_000, {
        spellId: "451963",
        spellName: "Void Leech",
        srcUnitId: "mate",
        srcUnitFlags: 0x548,
      }),
    ],
  });
  const sides = buildRosterSides([
    victim,
    makeUnit("mate", { reaction: CombatUnitReaction.Friendly }),
    makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile }),
  ]);
  it("有名册:队友转移的 400k 不算,只剩敌方的 400k", () => {
    expect(windowDamage(victim, 9, 12, 0x7f, T0, sides)).toBe(400_000);
  });
  it("对照:不给名册时只能按行的标记读,两行都算", () => {
    expect(windowDamage(victim, 9, 12, 0x7f, T0)).toBe(800_000);
  });
});
