/**
 * kick-eaten pressure facts (`kickPressureFor`) — triage 2026-09-29 F-K3 /
 * F-K9b, user rulings A31 and A33 (2026-09-30).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { CRISIS_HP_PCT_RENDERED } from "../src/analysis/crisisDecisionPoints";
import { kickIsHarmless, kickPressureFor } from "../src/analysis/kickPressure";
import { ensureAnalysisData } from "../src/data/ensure";
import { IMMUNITY_IDS } from "../src/utils/enemyDefensives";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const combat = { startTime: T0, endTime: T0 + 200_000 } as never;

/** HP (% of a 100-HP pool) at every whole second 0..120, held between points. */
function hpWalk(points: Record<number, number>) {
  const out = [];
  let cur = points[0] ?? 100;
  for (let s = 0; s <= 120; s++) {
    if (points[s] !== undefined) cur = points[s]!;
    out.push(makeAdvancedAction(T0 + s * 1000, 0, 0, 100, cur));
  }
  return out;
}

const AVENGING_WRATH = "31884";
const ICE_BLOCK = "45438";

function enemyRet(castSeconds: number[]) {
  return makeUnit("e1", {
    name: "Ret",
    spec: CombatUnitSpec.Paladin_Retribution,
    reaction: CombatUnitReaction.Hostile,
    info: {},
    advancedActions: hpWalk({ 0: 100 }),
    spellCastEvents: castSeconds.map((s) =>
      makeSpellCastEvent(
        AVENGING_WRATH,
        T0 + s * 1000,
        "e1",
        "Ret",
        "e1",
        "Ret",
        0,
        "Avenging Wrath",
      ),
    ),
  });
}

function friendlyMage(
  points: Record<number, number>,
  iceBlock?: [number, number],
) {
  return makeUnit("f2", {
    name: "Mage",
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Friendly,
    info: {},
    advancedActions: hpWalk(points),
    auraEvents: iceBlock
      ? [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            ICE_BLOCK,
            T0 + iceBlock[0] * 1000,
            "f2",
            "f2",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            ICE_BLOCK,
            T0 + iceBlock[1] * 1000,
            "f2",
            "f2",
            "BUFF",
          ),
        ]
      : [],
  });
}

const owner = makeUnit("f1", {
  name: "Owner",
  spec: CombatUnitSpec.Priest_Discipline,
  reaction: CombatUnitReaction.Friendly,
  info: {},
  advancedActions: hpWalk({ 0: 100 }),
});

const pressure = (
  mate: ReturnType<typeof friendlyMage>,
  enemy: ReturnType<typeof enemyRet>,
) =>
  kickPressureFor({
    combat,
    owner,
    friends: [owner, mate],
    enemies: [enemy],
  });

describe("kickPressureFor", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const calm = friendlyMage({ 0: 100 });

  it("names an enemy cooldown that was already running when the kick landed", () => {
    const p = pressure(
      calm,
      enemyRet([70]),
    )({
      atSeconds: 72.5,
      lockoutDurationSeconds: 3,
    });
    expect(p.ours.burstAgainst).toEqual(["Avenging Wrath"]);
    expect(kickIsHarmless(p)).toBe(false);
  });

  it("does not name a cooldown pressed after the kick, inside the lockout (ruling A31, 141470d0 @60.4)", () => {
    // pressed 2.8 s after the kick, 0.2 s before the 3 s lock ends
    const p = pressure(
      calm,
      enemyRet([75.3]),
    )({
      atSeconds: 72.5,
      lockoutDurationSeconds: 3,
    });
    expect(p.ours.burstAgainst).toEqual([]);
    // nothing else was going on and no burst of ours was ready: not listed
    expect(kickIsHarmless(p)).toBe(true);
  });

  it("a cooldown pressed in the kick's own millisecond counts as running", () => {
    const p = pressure(
      calm,
      enemyRet([72.5]),
    )({
      atSeconds: 72.5,
      lockoutDurationSeconds: 3,
    });
    expect(p.ours.burstAgainst).toEqual(["Avenging Wrath"]);
  });

  it("a teammate at the crisis line during the lockout is our side's low", () => {
    const low = CRISIS_HP_PCT_RENDERED;
    const p = pressure(
      friendlyMage({ 0: 100, 72: low, 76: 80 }),
      enemyRet([]),
    )({ atSeconds: 72.5, lockoutDurationSeconds: 3 });
    expect(p.ours.low).toEqual({ unit: "Mage", pct: low, atSec: 72 });
  });

  it("the same teammate inside Ice Block is not our side's low (ruling A33, 0068182d @72.5)", () => {
    expect(IMMUNITY_IDS.has(ICE_BLOCK)).toBe(true);
    const low = CRISIS_HP_PCT_RENDERED;
    // Ice Block 69.6 → 75.9: the ticks at 72..75 are skipped, the tick at 76
    // (after it) reads 80 %
    const p = pressure(
      friendlyMage({ 0: 100, 72: low, 76: 80 }, [69.559, 75.865]),
      enemyRet([]),
    )({ atSeconds: 72.5, lockoutDurationSeconds: 3 });
    expect(p.ours.low).toBeUndefined();
  });

  it("a tick after the immunity ended still counts", () => {
    const low = CRISIS_HP_PCT_RENDERED;
    // Ice Block ends at 73.2: the tick at 74 is read again
    const p = pressure(
      friendlyMage({ 0: 100, 72: low }, [69.559, 73.2]),
      enemyRet([]),
    )({ atSeconds: 72.5, lockoutDurationSeconds: 3 });
    expect(p.ours.low).toEqual({ unit: "Mage", pct: low, atSec: 74 });
  });
});

/**
 * The burst span has no 10 s floor (ruling A14, G16): what that does to the
 * pressure facts for a cooldown with no tracked buff. Soul Fire 6353 is the
 * one admitted offensive cooldown with no duration.
 */
describe("kickPressureFor with a zero-length cooldown (Soul Fire)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const SOUL_FIRE = "6353";
  const lock = (
    id: string,
    reaction: CombatUnitReaction,
    castSeconds: number[],
  ) =>
    makeUnit(id, {
      name: "Lock",
      spec: CombatUnitSpec.Warlock_Destruction,
      reaction,
      info: {},
      advancedActions: hpWalk({ 0: 100 }),
      spellCastEvents: castSeconds.map((s) =>
        makeSpellCastEvent(
          SOUL_FIRE,
          T0 + s * 1000,
          id,
          "Lock",
          id,
          "Lock",
          0,
          "Soul Fire",
        ),
      ),
    });
  const kick = { atSeconds: 60.9, lockoutDurationSeconds: 3 };

  it("is never 'running': an enemy Soul Fire in the kick's own millisecond is no enemyBurst", () => {
    const p = kickPressureFor({
      combat,
      owner,
      friends: [owner],
      enemies: [lock("e9", CombatUnitReaction.Hostile, [60.9])],
    })(kick);
    expect(p.ours.burstAgainst).toEqual([]);
  });

  it("a teammate's Soul Fire that was up is 'ready'; one pressed 0.7 s before the kick, in the kick's own second, is spent — not ready (pre-review of the batch)", () => {
    const ready = kickPressureFor({
      combat,
      owner,
      friends: [owner, lock("f9", CombatUnitReaction.Friendly, [10])],
      enemies: [enemyRet([])],
    })(kick);
    expect(ready.burstReady).toEqual(["Lock: Soul Fire"]);
    const spent = kickPressureFor({
      combat,
      owner,
      friends: [owner, lock("f9", CombatUnitReaction.Friendly, [10, 60.2])],
      enemies: [enemyRet([])],
    })(kick);
    expect(spent.burstReady).toEqual([]);
    expect(kickIsHarmless(spent)).toBe(true);
  });
});
