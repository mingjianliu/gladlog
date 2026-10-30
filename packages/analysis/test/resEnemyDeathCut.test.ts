/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #167 (fact6 leftovers): an enemy offensive effect its holder's death
 * cut short. 121afd91 r6 1:55 printed `Dark Transformation (5s left)`
 * because the observed aura ended in the Death Knight's 2:00 death — a
 * death the 1:55 row cannot know. The row keeps the effect until the death
 * and states the official time left.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_000_000;
const AVATAR = "107574"; // 20 s

function scene(deathS: number) {
  const warrior = makeUnit("e1", {
    name: "Warrior",
    spec: CombatUnitSpec.Warrior_Arms,
    spellCastEvents: [
      makeSpellCastEvent(
        AVATAR,
        START + 10_000,
        "e1",
        "Warrior",
        "e1",
        "Warrior",
      ),
    ],
    auraEvents: [
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          AVATAR,
          START + 10_000,
          "e1",
          "e1",
          "BUFF",
        ),
        srcUnitName: "Warrior",
      },
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          AVATAR,
          START + 15_000,
          "e1",
          "e1",
          "BUFF",
        ),
        srcUnitName: "Warrior",
      },
    ],
  } as any);
  (warrior as any).deathRecords = [{ timestamp: START + deathS * 1000 }];
  const combat = {
    startTime: START,
    endTime: START + 200_000,
    units: { e1: warrior },
  } as any;
  return reconstructEnemyCDTimeline([warrior], combat);
}

const enemyField = (timeline: any, t: number) =>
  buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Restoration Druid",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: timeline,
    matchStartMs: START,
  }).match(/enemy:(.+)$/)?.[1];

describe("[RES] enemy: time left of an effect its holder's death cut short (GH #167)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("removed in the death cascade → the row before the death states the official 20 s", () => {
    const tl = scene(15.04);
    const cd = tl.players[0]!.offensiveCDs[0]!;
    expect(cd.buffEndSeconds).toBeCloseTo(15, 3);
    expect(cd.deathCutOfficialEndSeconds).toBeCloseTo(30, 3);
    expect(enemyField(tl, 12)).toContain("(18s left)");
    // shown until the death, as before
    expect(enemyField(tl, 16)).toBeUndefined();
  });

  it("control: removed long before the holder died → the observed end stands", () => {
    const tl = scene(40);
    const cd = tl.players[0]!.offensiveCDs[0]!;
    expect(cd.deathCutOfficialEndSeconds).toBeUndefined();
    expect(enemyField(tl, 12)).toContain("(3s left)");
  });
});
