/**
 * Pipeline T223: health a unit's own side moved onto it (Void Leech, Spirit
 * Link, Tempered in Battle) is no hit it took. One row test,
 * `isRedistributedDamageRow`, for every reader that sums a side's landed
 * damage — the burst windows, `unitUnderFireAt`, the healing gap — as
 * `incomingPressureEvents` already read it. The crisis's `dmg2s` keeps the
 * moved health until its reference tables are regenerated (T227).
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  incomingPressureEvents,
  isRedistributedDamageRow,
} from "../src/utils/incomingPressure";
import { unitUnderFireAt } from "../src/utils/threatAssessment";
import { makeUnit } from "./ported/testHelpers";

const VOID_LEECH = "451963";
const row = (t: number, amount: number, more: object) =>
  ({
    logLine: { event: "SPELL_DAMAGE", timestamp: t, parameters: [] },
    timestamp: t,
    amount: -amount,
    effectiveAmount: -amount,
    spellId: VOID_LEECH,
    spellName: "Void Leech",
    ...more,
  }) as never;
// a teammate's row (friendly player flags) and the same id from the other side
const fromMate = (t: number, amount: number) =>
  row(t, amount, { srcUnitId: "mate", srcUnitFlags: 0x511 });
const fromEnemy = (t: number, amount: number) =>
  row(t, amount, { srcUnitId: "enemy-1", srcUnitFlags: 0x548 });
const victim = (damageIn: never[]) =>
  makeUnit("victim", { reaction: CombatUnitReaction.Friendly, damageIn });

describe("T223 — 己方转移的血量不算挨打:一个行判据,所有读者", () => {
  it("队友来的 Void Leech 是转移行,敌方来的同一个 id 是命中", () => {
    const u = victim([]);
    expect(isRedistributedDamageRow(u, fromMate(1000, 5) as object)).toBe(true);
    expect(isRedistributedDamageRow(u, fromEnemy(1000, 5) as object)).toBe(
      false,
    );
  });

  it("incomingPressureEvents 与行判据是同一个读法", () => {
    const u = victim([fromMate(1000, 500), fromEnemy(1200, 700)]);
    expect(incomingPressureEvents(u).map((e) => e.amount)).toEqual([700]);
  });

  it("unitUnderFireAt:只被己方转移行「打」的单位不在火力下;对照:敌方同量则在", () => {
    const big = 10_000_000;
    expect(unitUnderFireAt(victim([fromMate(1000, big)]), 1000)).toBe(false);
    expect(unitUnderFireAt(victim([fromEnemy(1000, big)]), 1000)).toBe(true);
  });

  it("有人被魅惑时行上的阵营位不可信:带上名册阵营后,队友的转移行仍是转移 (codex 85-tk-WIN-T223-1 #1)", () => {
    const big = 10_000_000;
    // the teammate's row carries hostile flags while a third player is charmed
    const flagged = row(1000, big, { srcUnitId: "mate", srcUnitFlags: 0x548 });
    const sides = new Map([
      ["victim", CombatUnitReaction.Friendly],
      ["mate", CombatUnitReaction.Friendly],
    ]);
    expect(unitUnderFireAt(victim([flagged]), 1000, undefined, sides)).toBe(
      false,
    );
    // mutation: by the flags alone it reads as an enemy hit
    expect(unitUnderFireAt(victim([flagged]), 1000)).toBe(true);
  });
});
