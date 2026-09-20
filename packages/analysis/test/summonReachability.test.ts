import {
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  SUMMON_REACH_MIN_S,
  summonReach,
} from "../src/utils/summonReachability";

const T0 = 1_000_000;
// one sample per second: the product treats a position older than
// LOS_SWEEP_GAP_MS (3 s) as unknown, so a sparse fixture reads as "no claim"
const at = (x: number, y: number, fromS = -5, toS = 30) =>
  Array.from({ length: toS - fromS + 1 }, (_, k) => ({
    timestamp: T0 + (fromS + k) * 1000,
    advancedActorPositionX: x,
    advancedActorPositionY: y,
  }));
const psyfiend = (spellId = "199824", pos = at(0, 0)): ICombatUnit =>
  ({
    id: "Creature-0-1-1-1-101398-0001",
    actionIn: [
      { spellId, logLine: { event: LogEvent.SPELL_SUMMON, timestamp: T0 } },
    ],
    advancedActions: pos,
    deathRecords: [],
  }) as unknown as ICombatUnit;
const player = (
  id: string,
  spec: CombatUnitSpec,
  pos: ReturnType<typeof at>,
  auraEvents: unknown[] = [],
  actionIn: unknown[] = [],
  deathRecords: unknown[] = [],
): ICombatUnit =>
  ({
    id,
    name: id,
    spec,
    advancedActions: pos,
    auraEvents,
    actionIn,
    deathRecords,
  }) as unknown as ICombatUnit;
const combat = { endTime: T0 + 60_000 };

describe("summonReach (GH #100: feasibility travels with the [ENEMY SUMMON] fact)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("window is the summoning spell's OFFICIAL duration; a ranged DPS 30 yd away is in reach for all of it", () => {
    const r = summonReach(
      psyfiend(),
      combat,
      [player("Hunter", CombatUnitSpec.Hunter_Marksmanship, at(30, 0))],
      [],
    );
    expect(r?.windowSeconds).toBe(12); // DB2 199824 Psyfiend = 12 s
    expect(r?.best?.seconds).toBe(12);
    expect(r?.best?.melee).toBe(false);
    expect(r!.best!.seconds).toBeGreaterThanOrEqual(SUMMON_REACH_MIN_S);
  });

  it("a melee 30 yd away is NOT in reach; one at 8 yd is", () => {
    const far = summonReach(
      psyfiend(),
      combat,
      [player("War", CombatUnitSpec.Warrior_Arms, at(30, 0))],
      [],
    );
    expect(far?.best).toBeNull();
    const near = summonReach(
      psyfiend(),
      combat,
      [player("War", CombatUnitSpec.Warrior_Arms, at(8, 0))],
      [],
    );
    expect(near?.best?.seconds).toBe(12);
    expect(near?.best?.melee).toBe(true);
  });

  it("healers are never named, and the round's end clips the window", () => {
    const r = summonReach(
      psyfiend(),
      { endTime: T0 + 5_000 },
      [player("Priest", CombatUnitSpec.Priest_Holy, at(10, 0))],
      [],
    );
    expect(r?.windowSeconds).toBe(5);
    expect(r?.best).toBeNull();
  });

  it("no official duration, no SPELL_SUMMON, or no position for the summon → no claim at all", () => {
    const hunter = player(
      "Hunter",
      CombatUnitSpec.Hunter_Marksmanship,
      at(30, 0),
    );
    expect(summonReach(psyfiend("999999999"), combat, [hunter], [])).toBeNull();
    expect(
      summonReach(
        { ...psyfiend(), actionIn: [] } as unknown as ICombatUnit,
        combat,
        [hunter],
        [],
      ),
    ).toBeNull();
    expect(
      summonReach(psyfiend("199824", []), combat, [hunter], []),
    ).toBeNull();
  });

  it("sub-second CC (e.g. 0.4s) that does not cover the sample midpoint is blocked via interval intersection (W0b)", () => {
    // CC from T0 + 50 to T0 + 450 (400ms duration). Midpoint of [T0, T0+1000] is T0 + 500.
    // Point sampling at T0 + 500 would miss it; interval intersection correctly catches it.
    const enemy = player("Enemy1", CombatUnitSpec.Priest_Shadow, at(0, 0));
    const stunAuras = [
      {
        spellId: "853", // Hammer of Justice (Stun)
        timestamp: T0 + 50,
        srcUnitId: "Enemy1",
        logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 50, parameters: [] },
      },
      {
        spellId: "853",
        timestamp: T0 + 450,
        srcUnitId: "Enemy1",
        logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 450, parameters: [] },
      },
    ];
    const hunter = player(
      "Hunter",
      CombatUnitSpec.Hunter_Marksmanship,
      at(30, 0),
      stunAuras,
    );
    const r = summonReach(psyfiend(), combat, [hunter], [enemy]);
    // 12s total window, second 0 is blocked, remaining 11s are free
    expect(r?.windowSeconds).toBe(12);
    expect(r?.best?.seconds).toBe(11);
  });

  it("sub-second CC spanning across the 1-second boundary blocks both seconds (W0b)", () => {
    // CC from T0 + 600 to T0 + 1500 (900ms duration).
    // Midpoints are T0 + 500 and T0 + 1500.
    // Interval intersection detects that both [T0, T0+1000] and [T0+1000, T0+2000] overlap the CC.
    const enemy = player("Enemy1", CombatUnitSpec.Priest_Shadow, at(0, 0));
    const stunAuras = [
      {
        spellId: "853",
        timestamp: T0 + 600,
        srcUnitId: "Enemy1",
        logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 600, parameters: [] },
      },
      {
        spellId: "853",
        timestamp: T0 + 1500,
        srcUnitId: "Enemy1",
        logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 1500, parameters: [] },
      },
    ];
    const hunter = player(
      "Hunter",
      CombatUnitSpec.Hunter_Marksmanship,
      at(30, 0),
      stunAuras,
    );
    const r = summonReach(psyfiend(), combat, [hunter], [enemy]);
    // 12s total window, seconds 0 and 1 are blocked, remaining 10s are free
    expect(r?.windowSeconds).toBe(12);
    expect(r?.best?.seconds).toBe(10);
  });

  it("death during the window excludes subsequent seconds", () => {
    const hunter = player(
      "Hunter",
      CombatUnitSpec.Hunter_Marksmanship,
      at(30, 0),
      [],
      [],
      [{ timestamp: T0 + 4_000 }], // dies at 4s
    );
    const r = summonReach(psyfiend(), combat, [hunter], []);
    // Only seconds where secEnd <= death timestamp count (4s: [0,1], [1,2], [2,3], [3,4])
    expect(r?.best?.seconds).toBe(4);
  });
});
