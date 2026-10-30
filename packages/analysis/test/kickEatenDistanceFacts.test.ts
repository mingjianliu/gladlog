/**
 * Re-eval 2026-10-08, F07 — the distances behind a kick-eaten row:
 *  - `kickLandedFromYd`: the kicker → player distance at the kick's own
 *    instant (0068182d r5 @72.5: a 5 yd Rebuke that landed from 10.6 yd);
 *  - `sourceDistSampleGapS` / `nearestKickerSampleGapS`: set when a
 *    cast-start distance was read across position samples more than
 *    `INTERP_MAX_GAP_MS` apart (eb8041ce: `sourceDistYd=1.3` over samples
 *    7.8 s and 36 yd apart);
 *  - `positionSampleSpanMs`, the reading both rest on.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { positionSampleSpanMs } from "../src/utils/losAnalysis";
import { INTERP_MAX_GAP_MS } from "../src/utils/positionSampling";
import { makeInterruptEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const combat = {
  startTime: START,
  endTime: START + 300_000,
  startInfo: { zoneId: "1672" },
};
const samples = (rows: Array<[ms: number, x: number, y: number]>) =>
  rows.map(([timestamp, x, y]) => ({
    timestamp,
    advancedActorPositionX: x,
    advancedActorPositionY: y,
  })) as never;

const CAST_START = START + 70_000;
const KICK = START + 72_500;

/** The owner starts Polymorph at 70.0 and is kicked at 72.5 by a 5 yd melee
 * kick (a Rogue's baseline Kick: the fixture has no talent list, and a
 * talented Rebuke would not make its Paladin a confirmed kicker); both
 * units' position samples are the caller's. */
const scene = (
  ownerSamples: Array<[number, number, number]>,
  kickerSamples: Array<[number, number, number]>,
) => {
  const owner = makeUnit("player-1", {
    name: "Owner",
    spec: CombatUnitSpec.Mage_Arcane,
    actionIn: [
      makeInterruptEvent(
        "1766",
        "Kick",
        "118",
        "Polymorph",
        KICK,
        "enemy-1",
        "Rogue",
      ),
    ],
    castStartEvents: [
      {
        spellId: "118",
        logLine: { event: LogEvent.SPELL_CAST_START, timestamp: CAST_START },
      },
    ] as never,
    advancedActions: samples(ownerSamples),
  });
  const rogue = makeUnit("enemy-1", {
    name: "Rogue",
    reaction: CombatUnitReaction.Hostile,
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Assassination,
    advancedActions: samples(kickerSamples),
  });
  return analyzePlayerCCAndTrinket(owner, [rogue], combat)
    .interruptInstances[0]!;
};

describe("positionSampleSpanMs", () => {
  const unit = makeUnit("u", {
    advancedActions: samples([
      [1_000, 0, 0],
      [1_400, 0, 4],
      [9_000, 0, 40],
    ]),
  });
  it("is the spacing of the two samples around the instant, 0 on a sample, the age past the last one, null before the first", () => {
    expect(positionSampleSpanMs(unit, 1_200)).toBe(400);
    expect(positionSampleSpanMs(unit, 5_000)).toBe(7_600);
    expect(positionSampleSpanMs(unit, 1_400)).toBe(0);
    expect(positionSampleSpanMs(unit, 9_000)).toBe(0);
    expect(positionSampleSpanMs(unit, 10_250)).toBe(1_250);
    expect(positionSampleSpanMs(unit, 999)).toBeNull();
    expect(
      positionSampleSpanMs(makeUnit("v", { advancedActions: [] }), 1_200),
    ).toBeNull();
  });
});

describe("kick-eaten F07 — where the kick landed from", () => {
  it("0068182d @72.5 (there a Rebuke): the kicker's own row at the kick and the Mage sampled 73 ms before — 10.6 yd for a 5 yd kick", () => {
    const inst = scene(
      [
        [CAST_START, 3.3, 0],
        [KICK - 73, 3.3, 9.5],
        [KICK + 75, 3.6, 10.6],
      ],
      [
        [CAST_START, 0, -6],
        [KICK - 4, 0, 0],
        [KICK + 600, 2, 4.8],
      ],
    );
    expect(inst.kickLandedFromYd).toBeGreaterThan(10);
    expect(inst.kickLandedFromYd).toBeLessThan(11);
    // one decimal, like every distance the row prints
    expect(inst.kickLandedFromYd).toBe(
      Math.round(inst.kickLandedFromYd! * 10) / 10,
    );
  });

  it("no landing distance off a position read across samples more than INTERP_MAX_GAP_MS apart, or with no position at all", () => {
    const wide = INTERP_MAX_GAP_MS + 500;
    expect(
      scene(
        [
          [CAST_START, 0, 0],
          [KICK - 100, 0, 9],
          [KICK + 100, 0, 10],
        ],
        // the kicker's two samples around the kick are too far apart
        [
          [KICK - wide / 2, 0, -20],
          [KICK + wide / 2, 0, 0],
        ],
      ).kickLandedFromYd,
    ).toBeNull();
    expect(
      scene(
        [
          [CAST_START, 0, 0],
          [KICK, 0, 9],
        ],
        [],
      ).kickLandedFromYd,
    ).toBeNull();
  });
});

describe("kick-eaten F07 — a cast-start distance read across a wide sample gap is marked", () => {
  it("tight samples on both units: the distance, no gap", () => {
    const inst = scene(
      [
        [CAST_START - 200, 0, 0],
        [CAST_START + 200, 0, 0],
        [KICK, 0, 0],
      ],
      [
        [CAST_START - 300, 0, 18],
        [CAST_START + 300, 0, 17],
        [KICK, 0, 4],
      ],
    );
    expect(inst.sourceDistYd).toBe(17.5);
    expect(inst.sourceDistSampleGapS).toBeNull();
    expect(inst.nearestKickerDistYd).toBe(17.5);
    expect(inst.nearestKickerSampleGapS).toBeNull();
  });

  it("the kicker's position at cast start sits between two samples 2.3 s apart: the distance is still read, with the spacing", () => {
    const inst = scene(
      [
        [CAST_START - 200, 0, 0],
        [CAST_START + 200, 0, 0],
        [KICK, 0, 0],
      ],
      [
        [CAST_START - 1_150, 0, 30],
        [CAST_START + 1_150, 0, 8],
        [KICK, 0, 4],
      ],
    );
    expect(inst.sourceDistYd).toBe(19);
    expect(inst.sourceDistSampleGapS).toBeCloseTo(2.3, 5);
    expect(inst.nearestKickerSampleGapS).toBeCloseTo(2.3, 5);
  });

  it("the owner's own samples count too", () => {
    const inst = scene(
      [
        [CAST_START - 1_000, 0, 0],
        [CAST_START + 1_000, 0, 4],
        [KICK, 0, 4],
      ],
      [
        [CAST_START, 0, 20],
        [KICK, 0, 8],
      ],
    );
    expect(inst.sourceDistSampleGapS).toBeCloseTo(2.0, 5);
  });
});
