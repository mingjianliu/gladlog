/**
 * SPLIT PUSH states what was checked (acceptance 7e2a3c95 #5). The detector
 * read two samples in the push window's first 10 s (from + 2 s and the middle
 * of the evaluated span), then printed the window's WHOLE length as "stayed
 * >20yd away": c2058ed4 `2:33–3:33`, samples 22.0 / 20.8 yd, while the named
 * melee Lava Lashed the target from ~1 yd at 3:06.9. The line now prints the
 * evaluated span, and every instant the positioning gate samples inside it
 * (`positionSampleInstants`) must be beyond the radius.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
} from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
const END = T0 + 60_000;

/** A unit sampled every 500 ms, standing at x(s). */
function unit(
  id: string,
  name: string,
  spec: CombatUnitSpec,
  x: (s: number) => number,
): any {
  const advancedActions = [];
  for (let ms = 0; ms <= 60_000; ms += 500)
    advancedActions.push({
      timestamp: T0 + ms,
      logLine: { timestamp: T0 + ms },
      advanced: true,
      advancedActorId: id,
      advancedActorCurrentHp: 80,
      advancedActorMaxHp: 100,
      advancedActorPositionX: x(ms / 1000),
      advancedActorPositionY: 0,
      advancedActorPowers: [],
    });
  return {
    id,
    name,
    spec,
    advancedActions,
    deathRecords: [],
    damageOut: [],
    damageIn: [],
  };
}

const target = () =>
  unit("e1", "Target-R-US", CombatUnitSpec.Priest_Discipline, () => 0);
const onTarget = () =>
  unit("f1", "Rogue-R-US", CombatUnitSpec.Rogue_Assassination, () => 3);

const run = (away: any) =>
  computeOwnerPositionEvents({
    owner: onTarget(),
    enemies: [target()],
    combat: { startTime: T0, endTime: END },
    burstWindows: [],
    ownerCooldowns: [],
    isHealer: false,
    ownerIsMelee: true,
    friends: [onTarget(), away],
    offensiveWindows: [
      {
        fromSeconds: 20,
        toSeconds: 50,
        targetUnitId: "e1",
        targetName: "Target-R-US",
        friendlyOffensives: [
          { playerName: "Rogue-R-US" },
          { playerName: "Warrior-R-US" },
        ],
      },
    ],
  }).filter((e) => e.type === "SPLIT_PUSH");

describe("SPLIT PUSH — the printed span is the checked span", () => {
  it("away at every instant of the first 10 s: printed 0:20–0:30, not to the window's end", () => {
    const warrior = unit(
      "f2",
      "Warrior-R-US",
      CombatUnitSpec.Warrior_Arms,
      () => 30,
    );
    const evs = run(warrior);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.toSeconds).toBe(30);
    expect(formatPositionEventsForContext(evs as any).join("\n")).toContain(
      "0:20–0:30 push on Target-R-US: Warrior-R-US stayed >20yd away",
    );
  });
  it("both samples beyond 20 yd but on the target in between: no claim", () => {
    // 30 yd away except 23.5–24.5 s, when the warrior walks in to 1 yd — the two
    // samples (22 s, 25 s) both read 30 yd
    const warrior = unit(
      "f2",
      "Warrior-R-US",
      CombatUnitSpec.Warrior_Arms,
      (s) => (s >= 23.5 && s <= 24.5 ? 1 : 30),
    );
    expect(run(warrior)).toHaveLength(0);
  });
});
