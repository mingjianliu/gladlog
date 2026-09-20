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
): ICombatUnit =>
  ({
    id,
    name: id,
    spec,
    advancedActions: pos,
    auraEvents,
    actionIn: [],
    deathRecords: [],
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
});
