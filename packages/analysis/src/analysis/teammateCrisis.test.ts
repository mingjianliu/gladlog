/**
 * `teammateCrisisPoints` (GH #95, 2026-09-17): the healer-side reading of a
 * teammate's crisis. Fixtures follow crisisDecisionPoints.test.ts (samples
 * carry both `timestamp` and `logLine.timestamp` + `advancedActorId` so the
 * [STATE] sampler and this module's own sampler agree), on Nagrand ("1505")
 * so `hasLineOfSight` answers true/false instead of unknown.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  CRISIS_EXTERNAL_IDS,
  CRISIS_OFFENSIVE_CD_IDS,
} from "./crisisDecisionPoints";
import { isEnemyCdWindowSpell } from "../utils/enemyCDs";
import {
  TEAMMATE_CRISIS_CUE_MIN_S,
  TEAMMATE_CRISIS_REACH_YARDS,
  teammateCrisisPoints,
} from "./teammateCrisis";

const T0 = 1_000_000;
// Nagrand Arena bounds: x -2091..-1998, y 6605..6704
const X = -2050;
const Y = 6650;
const EXTERNAL = [...CRISIS_EXTERNAL_IDS][0]!;
// the burst FACT needs a real cooldown (TEAMMATE_CRISIS_BURST_MIN_CD_S) —
// pick one from the canonical set rather than the first entry, which may be
// a debuffs_offensive row with no cooldown (Curse of Weakness)
const BURST = [...CRISIS_OFFENSIVE_CD_IDS].find((id) => isEnemyCdWindowSpell(id))!;
const NO_CD_BURST = [...CRISIS_OFFENSIVE_CD_IDS].find((id) => !isEnemyCdWindowSpell(id));

const sample = (
  actorId: string,
  t: number,
  cur: number,
  x = X,
  y = Y,
  manaPct = 80,
) => ({
  timestamp: T0 + t,
  logLine: { timestamp: T0 + t },
  advancedActorId: actorId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: 100,
  advancedActorPositionX: x,
  advancedActorPositionY: y,
  advancedActorPowers: [{ type: 0, current: manaPct, max: 100 }],
});
const cast = (t: number, spellId: string, destUnitId?: string) => ({
  timestamp: T0 + t,
  spellId,
  destUnitId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + t },
});

function healer(over: Record<string, unknown> = {}) {
  const samples = [];
  for (let t = 0; t <= 20_000; t += 1000) samples.push(sample("H", t, 100));
  return {
    id: "H",
    name: "Heals-R",
    spec: CombatUnitSpec.Paladin_Holy,
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    advancedActions: samples,
    damageIn: [],
    healIn: [],
    healOut: [],
    // a cast 10 s before and 10 s after the window: not an inactive stretch
    spellCastEvents: [cast(-9000, "1", "H"), cast(15_000, "1", "H")],
    castStartEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    ...over,
  };
}
function mate(over: Record<string, unknown> = {}) {
  return {
    id: "M",
    name: "Mate-R",
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    advancedActions: [
      sample("M", 0, 100),
      sample("M", 1000, 70),
      sample("M", 2000, 38),
      sample("M", 3000, 35),
      sample("M", 4000, 35),
      sample("M", 6000, 35),
    ],
    damageIn: [
      {
        timestamp: T0 + 1500,
        srcUnitId: "E1",
        amount: -30,
        effectiveAmount: -30,
      },
    ],
    healIn: [],
    healOut: [],
    spellCastEvents: [],
    castStartEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    ...over,
  };
}
const enemy = (extra: Record<string, unknown> = {}) => ({
  id: "E1",
  name: "Foe-R",
  spec: CombatUnitSpec.Warrior_Arms,
  reaction: CombatUnitReaction.Hostile,
  info: { teamId: "1" },
  spellCastEvents: [],
  advancedActions: [],
  auraEvents: [],
  ...extra,
});
function combat(units: any[], over: Record<string, unknown> = {}) {
  const map: Record<string, any> = {};
  for (const u of units) map[u.id] = u;
  return {
    startTime: T0,
    endTime: T0 + 60_000,
    units: map,
    zoneId: "1505",
    startInfo: { bracket: "3v3", zoneId: "1505" },
    ...over,
  };
}

describe("teammateCrisisPoints", () => {
  it("a healer who cast nothing, free, in reach and in LoS, with mana → clean idle", () => {
    const h = healer();
    const [p] = teammateCrisisPoints(h, combat([h, mate(), enemy()]), []);
    expect(p).toBeDefined();
    expect(p!.tSec).toBe(2);
    expect(p!.hpPct).toBe(38);
    expect(p!.dmg2s).toBe(0.3);
    expect(p!.attackerNames).toEqual(["Foe-R"]);
    expect(p!.excluded).toBeNull();
    expect(p!.healerAnswered).toBe(false);
    expect(p!.healerIdle).toBe(true);
    expect(p!.idleReason).toBeNull();
    expect(p!.cleanIdle).toBe(true);
    expect(p!.distanceYd).toBe(0);
    expect(p!.manaPct).toBe(80);
    expect(p!.enemyBurst).toBeNull();
  });

  it("an external cast ON the teammate inside the window answers; a cast on someone else is busyElsewhere", () => {
    const h = healer({
      spellCastEvents: [
        cast(-9000, "1", "H"),
        cast(2500, EXTERNAL, "M"),
        cast(15_000, "1", "H"),
      ],
    });
    const [p] = teammateCrisisPoints(h, combat([h, mate(), enemy()]), []);
    expect(p!.healerAnswers).toEqual(["external"]);
    expect(p!.cleanIdle).toBe(false);

    const other = {
      ...healer(),
      id: "F",
      name: "Friend-R",
      spec: CombatUnitSpec.Warrior_Arms,
    };
    other.advancedActions = [
      sample("F", 0, 100),
      sample("F", 2000, 30),
      sample("F", 4000, 30),
    ];
    const h2 = healer({
      spellCastEvents: [
        cast(-9000, "1", "H"),
        cast(2500, "999", "F"),
        cast(15_000, "1", "H"),
      ],
    });
    const [q] = teammateCrisisPoints(
      h2,
      combat([h2, mate(), other, enemy()]),
      [],
    );
    expect(q!.healerAnswered).toBe(false);
    expect(q!.idleReason).toBe("busyElsewhere");
    expect(q!.cleanIdle).toBe(false);
    // user question 4 (2026-09-17): whom was the healer casting on, and were
    // they in crisis themselves? Friend-R sat at 30 % → yes.
    expect(q!.busyOn).toEqual({
      name: "Friend-R",
      hpPct: 30,
      spellName: "999",
    });
    expect(q!.misprioritized).toBe(false);
    expect(q!.busyOnInCrisis).toBe(true);
    // the same cast on a friendly at 80 % is the triage population
    // (user ruling 2026-09-17): healer busy on someone NOT in crisis
    const healthy = { ...other };
    healthy.advancedActions = [
      sample("F", 0, 100),
      sample("F", 2000, 80),
      sample("F", 4000, 80),
    ];
    const [r] = teammateCrisisPoints(
      h2,
      combat([h2, mate(), healthy, enemy()]),
      [],
    );
    expect(r!.busyOn).toEqual({
      name: "Friend-R",
      hpPct: 80,
      spellName: "999",
    });
    expect(r!.busyOnInCrisis).toBe(false);
    expect(r!.misprioritized).toBe(true);
  });

  it("a HoT placed before the window whose ticks land in it answers as carriedHeal (user ruling 2026-09-15); a tick of a spell cast on the mate in the window is a fresh heal", () => {
    const m = mate({
      healIn: [
        {
          timestamp: T0 + 2500,
          srcUnitId: "H",
          spellId: "774",
          amount: 5,
          effectiveAmount: 5,
        },
      ],
    });
    const h = healer();
    const [p] = teammateCrisisPoints(h, combat([h, m, enemy()]), []);
    expect(p!.healerAnswers).toEqual(["carriedHeal"]);
    expect(p!.carriedHealPct).toBe(5);
    expect(p!.cleanIdle).toBe(false);

    const h2 = healer({
      spellCastEvents: [
        cast(-9000, "1", "H"),
        cast(2200, "774", "M"),
        cast(15_000, "1", "H"),
      ],
    });
    const [q] = teammateCrisisPoints(
      h2,
      combat([h2, mate({ healIn: m.healIn }), enemy()]),
      [],
    );
    expect(q!.healerAnswers).toEqual(["freshHeal"]);
    expect(q!.carriedHealPct).toBe(0);
  });

  it("feasibility exclusions: dead healer, out of reach, unknown LoS, out of mana", () => {
    const dead = healer({ deathRecords: [{ timestamp: T0 + 1000 }] });
    expect(
      teammateCrisisPoints(dead, combat([dead, mate(), enemy()]), [])[0]!
        .excluded,
    ).toBe("healerBlocked");

    const far = healer();
    far.advancedActions = far.advancedActions.map((s: any) => ({
      ...s,
      advancedActorPositionX: X + TEAMMATE_CRISIS_REACH_YARDS + 5,
    }));
    const [f] = teammateCrisisPoints(far, combat([far, mate(), enemy()]), []);
    expect(f!.excluded).toBe("outOfReach");
    expect(f!.distanceYd).toBe(45);

    const h = healer();
    const [u] = teammateCrisisPoints(
      h,
      combat([h, mate(), enemy()], {
        zoneId: "",
        startInfo: { bracket: "3v3" },
      }),
      [],
    );
    expect(u!.excluded).toBe("losUnknown");

    const oom = healer();
    oom.advancedActions = oom.advancedActions.map((s: any) => ({
      ...s,
      advancedActorPowers: [{ type: 0, current: 5, max: 100 }],
    }));
    const [o] = teammateCrisisPoints(oom, combat([oom, mate(), enemy()]), []);
    expect(o!.excluded).toBe("outOfMana");
    expect(o!.manaPct).toBe(5);
  });

  it("a healer with no cast for 15 s on either side is an inactive stretch, never clean idle", () => {
    const h = healer({ spellCastEvents: [] });
    const [p] = teammateCrisisPoints(h, combat([h, mate(), enemy()]), []);
    expect(p!.excluded).toBeNull();
    expect(p!.idleReason).toBe("inactiveStretch");
    expect(p!.cleanIdle).toBe(false);
  });

  it("the enemy's offensive-cooldown press before the crossing is a fact with its seconds; externals off cooldown are listed", () => {
    const e = enemy({ spellCastEvents: [cast(-1000, BURST, "M")] });
    const h = healer();
    const ledger = [
      {
        spellId: EXTERNAL,
        spellName: "Ext",
        casts: [],
        cooldownSeconds: 120,
        neverUsed: true,
      },
    ] as any;
    const [p] = teammateCrisisPoints(h, combat([h, mate(), e]), ledger);
    expect(p!.enemyBurst).toEqual({
      casterName: "Foe-R",
      spellId: BURST,
      spellName: expect.any(String),
      secondsBefore: 3,
    });
    expect(p!.enemyBurst!.secondsBefore).toBeGreaterThanOrEqual(
      TEAMMATE_CRISIS_CUE_MIN_S,
    );
    expect(p!.externalsReady).toEqual([
      { spellId: EXTERNAL, spellName: "Ext" },
    ]);
    // a canonical-table entry WITHOUT a cooldown (a curse / DoT) is not a
    // burst fact — nothing on a cooldown tracker shows it
    if (NO_CD_BURST) {
      const e2 = enemy({ spellCastEvents: [cast(-1000, NO_CD_BURST, "M")] });
      const h2 = healer();
      expect(
        teammateCrisisPoints(h2, combat([h2, mate(), e2]), [])[0]!.enemyBurst,
      ).toBeNull();
    }
  });

  it("a non-healer owner yields nothing", () => {
    const dps = { ...healer(), spec: CombatUnitSpec.Warrior_Arms };
    expect(
      teammateCrisisPoints(dps, combat([dps, mate(), enemy()]), []),
    ).toEqual([]);
  });
});
