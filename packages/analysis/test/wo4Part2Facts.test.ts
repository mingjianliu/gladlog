/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Work order 2026-10-14d Part 2 (user 2026-10-14: 「擦边不管 落地」) and
 * Part 3 (「飞行不能施法」):
 *  - 2a: one "hit by the burst" predicate (`burstHit.ts`) for the burst
 *    engine and the POSITIONING burst target;
 *  - 2b: a disarm stops the weapon-requiring spells a reader names;
 *  - 2c: a press enters a sync window by its OBSERVED effect end;
 *  - 2d: the owner's own can-act (`actionBlockedAt`) is the shared reading;
 *  - Part 3: Dream Flight and Breath of Eons' second id are own flights.
 */
import {
  CombatUnitReaction,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { evaluateSyncWindow } from "../src/analysis/candidates/cooldownTiming";
import { actionBlockedAt } from "../src/analysis/crisisDecisionPoints";
import { ensureAnalysisData } from "../src/data/ensure";
import { OWN_FLIGHT_AURA_IDS } from "../src/data/occupancyAuras";
import {
  damageTakenBetween,
  hitByAttackers,
  immuneHitTargets,
} from "../src/utils/burstHit";
import {
  cannotCastIntervalsForSpells,
  disarmIntervals,
  intervalBlocksSpell,
} from "../src/utils/cannotCastIntervals";
import { mostPressuredInSpan } from "../src/utils/positionAnalysis";
import { isWeaponRequiredCast } from "../src/utils/spellMechanics";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;
const aura = (
  event: LogEvent,
  spellId: string,
  sec: number,
  src: string,
  dest: string,
) => ({
  logLine: { event, timestamp: S(sec), parameters: [] },
  timestamp: S(sec),
  spellId,
  spellName: spellId,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
});

describe("2a — hit by the burst: landed damage or an IMMUNE miss", () => {
  const hit = (sec: number, src: string, amount: number) => ({
    timestamp: S(sec),
    srcUnitId: src,
    effectiveAmount: -amount,
    logLine: { timestamp: S(sec) },
  });
  const mage = { id: "mage", name: "Mage", damageIn: [hit(12, "war", 50)] };
  const lock = { id: "lock", name: "Lock", damageIn: [hit(12, "dk", 900)] };
  const iceBlocked = { id: "ib", name: "IB", damageIn: [] };
  const war = {
    id: "war",
    missesOut: [
      { missType: "IMMUNE", destUnitId: "ib", timestamp: S(13) },
      { missType: "IMMUNE", destUnitId: "ib", timestamp: S(40) }, // outside
    ],
  };
  const fromWar = (src: string) => src === "war";

  it("damage from the attackers, or an IMMUNE they logged on the unit, inside the span", () => {
    expect(damageTakenBetween(mage, S(10), S(20), fromWar)).toBe(50);
    expect(immuneHitTargets([war], fromWar, S(10), S(20))).toEqual(
      new Set(["ib"]),
    );
    expect(hitByAttackers(mage, [war], fromWar, S(10), S(20))).toBe(true);
    expect(hitByAttackers(iceBlocked, [war], fromWar, S(10), S(20))).toBe(true);
    // hit only by someone else
    expect(hitByAttackers(lock, [war], fromWar, S(10), S(20))).toBe(false);
  });

  it("mostPressuredInSpan with the burst filter: the most-hit friendly the burst's casters reached", () => {
    const f = (id: string, amount: number, src: string) =>
      ({
        id,
        name: id,
        damageIn: [hit(12, src, amount)],
      }) as unknown as ICombatUnit;
    const friends = [f("a", 900, "dk"), f("b", 100, "war")];
    // unfiltered: the warlock-style unit the other enemy hit hardest
    expect(mostPressuredInSpan(friends, S(10), S(20))).toBe("a");
    expect(
      mostPressuredInSpan(friends, S(10), S(20), undefined, (u) =>
        hitByAttackers(u, [], fromWar, S(10), S(20)),
      ),
    ).toBe("b");
  });
});

describe("2b — a disarm stops the weapon-requiring spells a reader names", () => {
  it("DB2 SpellEquippedItems: Mortal Strike needs a weapon, Kingsbane does not (e10c6bea)", () => {
    expect(isWeaponRequiredCast("12294")).toBe(true);
    expect(isWeaponRequiredCast("385627")).toBe(false);
  });

  it("a disarm interval blocks a weapon spell, not another, and never an unasked reader", () => {
    const iv = { lockout: false, spellId: "207777", disarm: true as const };
    expect(intervalBlocksSpell(iv, "12294")).toBe(true);
    expect(intervalBlocksSpell(iv, "385627")).toBe(false);
    expect(intervalBlocksSpell(iv, undefined)).toBe(false);
  });

  it("cannotCastIntervalsForSpells carries a Dismantle for Mortal Strike, not for Kingsbane", () => {
    const victim = makeUnit("v", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "207777", 10, "rogue", "v"),
        aura(LogEvent.SPELL_AURA_REMOVED, "207777", 15, "rogue", "v"),
      ],
    }) as unknown as ICombatUnit;
    const enemies = new Set(["rogue"]);
    expect(disarmIntervals(victim, enemies)).toHaveLength(1);
    expect(
      cannotCastIntervalsForSpells(victim, enemies, ["12294"], undefined),
    ).toMatchObject([{ from: S(10), to: S(15), disarm: true }]);
    expect(
      cannotCastIntervalsForSpells(victim, enemies, ["385627"], undefined),
    ).toEqual([]);
    // unasked: no disarm
    expect(
      cannotCastIntervalsForSpells(victim, enemies, undefined, undefined),
    ).toEqual([]);
  });
});

describe("2c — a press enters a sync window by its observed effect end", () => {
  const cd = (castEndS?: Map<number, number>) =>
    ({
      spellId: "274837",
      spellName: "Feral Frenzy",
      casts: [{ timeSeconds: 88 }],
      cooldownSeconds: 45,
      neverUsed: false,
      ...(castEndS ? { castEndS } : {}),
    }) as any;
  const w = { fromSeconds: 94, toSeconds: 99 };

  it("an effect observed running into the lock entered it (user: an edge counts)", () => {
    expect(evaluateSyncWindow(w, [cd(new Map([[88_000, 94.4]]))]).entered).toBe(
      true,
    );
    // observed to end before the lock: not entered
    expect(evaluateSyncWindow(w, [cd(new Map([[88_000, 93.6]]))]).entered).toBe(
      false,
    );
  });
});

describe("2d — the owner's own can-act is the shared cannot-cast reading", () => {
  const owner = (over: Record<string, unknown>) =>
    makeUnit("o", { reaction: CombatUnitReaction.Friendly, ...over }) as any;
  const combatWith = (o: any) => ({
    startTime: T0,
    endTime: S(300),
    units: {
      o,
      e: { id: "e", name: "e", reaction: CombatUnitReaction.Hostile },
    },
  });

  it("a kick locks for its modelled lockout, not 1.5 s after it", () => {
    const o = owner({
      actionIn: [
        {
          logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: S(10) },
          timestamp: S(10),
          spellId: "1766",
          extraSpellId: "2061",
          srcUnitId: "e",
          destUnitId: "o",
        },
      ],
    });
    const r = actionBlockedAt(o, combatWith(o), S(12));
    expect(r.lockedOut).toBe(true);
    expect(r.blocked).toBe(true);
  });

  it("the owner's own flight blocks", () => {
    const o = owner({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "357210", 20, "o", "o"),
        aura(LogEvent.SPELL_AURA_REMOVED, "357210", 23, "o", "o"),
      ],
    });
    expect(actionBlockedAt(o, combatWith(o), S(21)).blocked).toBe(true);
    expect(actionBlockedAt(o, combatWith(o), S(24)).blocked).toBe(false);
  });
});

describe("Part 3 — the DB2 flight auras are own flights (user 2026-10-14 「飞行不能施法」)", () => {
  it("Deep Breath ×2, Breath of Eons ×2, Dream Flight", () => {
    expect([...OWN_FLIGHT_AURA_IDS].sort()).toEqual(
      ["357210", "359816", "403631", "433874", "442204"].sort(),
    );
  });
});
