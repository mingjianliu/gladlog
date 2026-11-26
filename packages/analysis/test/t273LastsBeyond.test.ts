import {
  CombatUnitPowerType,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { SUPERCHARGED_FINISHERS } from "../src/data/castParamDurations";
import { ensureAnalysisData } from "../src/data/ensure";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import { castParamAt, superchargedPointsAt } from "../src/utils/castParam";
import { pressAuraCandidates, pressDuration } from "../src/utils/offListPress";
import { superchargedFinisherRows } from "../src/utils/superchargedPoints";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

/**
 * Pipeline T273: `lasts Ns` printed on an aura the log shows running longer.
 * Three mechanisms, each a tooltip the duration model did not read:
 * Supercharger's extra combo points on a finisher (Between the Eyes 22 s at 7
 * points), Keep It Rolling's + 30 s on Roll the Bones, Everlasting Elements'
 * + 20 % on Earth Elemental.
 */
const T0 = 1_000_000;
// node, entry, rank
const SUPERCHARGER = (rank: number) => ({
  id1: 90639,
  id2: 112525,
  count: rank,
});
const FORCED_INDUCTION = { id1: 90638, id2: 112523, count: 1 };
const EVERLASTING_ELEMENTS = { id1: 103634, id2: 127916, count: 1 };
const AR = "13750";
const BTE = "315341";
const DISPATCH = "2098";
const ROLL_THE_BONES = "1214909";
const KEEP_IT_ROLLING = "381989";
const ONE_OF_A_KIND = "1214933";
const JACKPOT = "1214937";
const EARTH_ELEMENTAL = "198103";

beforeAll(async () => {
  await ensureAnalysisData();
});

const sample = (s: number, cp: number) => ({
  timestamp: T0 + s * 1000,
  advancedActorPowers: [
    { type: CombatUnitPowerType.ComboPoints, current: cp, max: 7 },
  ],
});
/** [cast id, seconds after T0, combo points on the bar] */
type Press = [string, number, number?];
const unit = (spec: CombatUnitSpec, talents: object[], presses: Press[]) =>
  makeUnit("r", {
    spec,
    info: { talents, pvpTalents: [] },
    spellCastEvents: presses.map(([id, s]) =>
      makeSpellCastEvent(id, T0 + s * 1000, "e"),
    ),
    advancedActions: presses
      .filter((p) => p[2] !== undefined)
      .map(([, s, cp]) => sample(s, cp!)),
  } as unknown as Parameters<typeof makeUnit>[1]);
const at = (s: number) => T0 + s * 1000;

describe("T273: Supercharger — a consumed supercharged point counts as combo points spent", () => {
  it("2d4d9d9d r1: Between the Eyes at 7 points a second after Adrenaline Rush runs 22 s (7 + 2 + 1 points)", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(2), FORCED_INDUCTION],
      [
        [AR, 0],
        [BTE, 1, 7],
      ],
    );
    expect(superchargedPointsAt(u, at(1))).toBe(3);
    expect(castParamAt(u, BTE, at(1))).toBe(10);
    expect(buffFullDurationForCaster(BTE, u, at(1))).toBe(22);
  });

  it("without Forced Induction the point stands for 2", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(1)],
      [
        [AR, 0],
        [BTE, 1, 6],
      ],
    );
    expect(buffFullDurationForCaster(BTE, u, at(1))).toBe(2 + 2 * 8);
  });

  it("one point per rank, one per damaging finisher: the third finisher after the press is plain", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(2), FORCED_INDUCTION],
      [
        [AR, 0],
        [BTE, 1, 7],
        [DISPATCH, 3, 7],
        [BTE, 12, 6],
      ],
    );
    expect(superchargedPointsAt(u, at(3))).toBe(3);
    expect(superchargedPointsAt(u, at(12))).toBe(0);
    expect(buffFullDurationForCaster(BTE, u, at(12))).toBe(14);
  });

  it("rank 1 leaves one point; the next Adrenaline Rush charges again", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(1), FORCED_INDUCTION],
      [
        [AR, 0],
        [DISPATCH, 1, 7],
        [BTE, 2, 7],
        [AR, 20],
        [BTE, 21, 5],
      ],
    );
    expect(buffFullDurationForCaster(BTE, u, at(2))).toBe(16);
    expect(buffFullDurationForCaster(BTE, u, at(21))).toBe(2 + 2 * 8);
  });

  it("no Supercharger in the loadout, or no charging press: the points on the bar", () => {
    const plain = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [],
      [
        [AR, 0],
        [BTE, 1, 7],
      ],
    );
    expect(buffFullDurationForCaster(BTE, plain, at(1))).toBe(16);
    const noPress = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(2), FORCED_INDUCTION],
      [[BTE, 1, 7]],
    );
    expect(buffFullDurationForCaster(BTE, noPress, at(1))).toBe(16);
  });

  it("a spec the table does not list is not charged by Adrenaline Rush's id", () => {
    const sub = unit(
      CombatUnitSpec.Rogue_Subtlety,
      [SUPERCHARGER(2)],
      [
        [AR, 0],
        [BTE, 1, 5],
      ],
    );
    expect(superchargedPointsAt(sub, at(1))).toBe(0);
  });
});

describe("T273: one walk of the supercharged points for the press and the cooldown ledger", () => {
  it("1ce02e10 r6: Adrenaline Rush, Dispatch, a 5-point Between the Eyes — 18 s, and the ledger counts the same 8 points", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(2), FORCED_INDUCTION],
      [
        [AR, 0],
        [DISPATCH, 1, 7],
        [BTE, 2, 5],
      ],
    );
    expect(buffFullDurationForCaster(BTE, u, at(2))).toBe(18);
    const used = superchargedFinisherRows(
      u.spellCastEvents,
      SUPERCHARGED_FINISHERS.bySpec["260"]!.chargeCastIds,
      SUPERCHARGED_FINISHERS.bySpec["260"]!.finisherCastIds,
      2,
    );
    expect([...used].map((c) => c.spellId)).toEqual([DISPATCH, BTE]);
  });

  it("a second charging press with a point in hand adds to it", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [SUPERCHARGER(1)],
      [
        [AR, 0],
        [AR, 1],
        [DISPATCH, 2, 7],
        [BTE, 3, 7],
        [BTE, 4, 7],
      ],
    );
    expect(superchargedPointsAt(u, at(3))).toBe(2);
    expect(superchargedPointsAt(u, at(4))).toBe(0);
  });
});

describe("T273: Keep It Rolling adds 30 s to the enhancement of the roll it is pressed in", () => {
  it("0cf7193d r1: pressed 1.3 s into the roll, 60 s", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [],
      [
        [ROLL_THE_BONES, 0],
        [KEEP_IT_ROLLING, 1.3],
      ],
    );
    expect(buffFullDurationForCaster(ONE_OF_A_KIND, u, T0)).toBe(60);
  });

  it("no press inside the roll: 30 s; a press after it ran out adds nothing", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [],
      [
        [ROLL_THE_BONES, 0],
        [KEEP_IT_ROLLING, 31],
      ],
    );
    expect(buffFullDurationForCaster(ONE_OF_A_KIND, u, T0)).toBe(30);
  });

  it("52816a5f r1: re-rolled at 22.1 s, Keep It Rolling 2 s later — the first roll is not extended, the second is (codex 85-tk-L1-T273-1 #1)", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [],
      [
        [ROLL_THE_BONES, 0],
        [ROLL_THE_BONES, 22.138],
        [KEEP_IT_ROLLING, 24.107],
      ],
    );
    expect(buffFullDurationForCaster(ONE_OF_A_KIND, u, T0)).toBe(30);
    expect(buffFullDurationForCaster(JACKPOT, u, at(22.138))).toBe(60);
    // …also when the re-roll gives the same enhancement again (the rows
    // merge into one run)
    expect(buffFullDurationForCaster(JACKPOT, u, T0)).toBe(30);
  });

  it("1ce02e10 r3: the press reads the enhancement's row, not the Roll the Bones marker's (codex 85-tk-L1-T273-1 #2)", () => {
    const u = unit(
      CombatUnitSpec.Rogue_Outlaw,
      [],
      [
        [ROLL_THE_BONES, 0],
        [KEEP_IT_ROLLING, 5],
      ],
    );
    const row = (id: string, ms: number) =>
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, id, T0 + ms, "r", "r");
    (u as { auraEvents: unknown[] }).auraEvents = [
      row(ROLL_THE_BONES, 0),
      row(ONE_OF_A_KIND, 1),
    ];
    const cast = u.spellCastEvents[0]!;
    const picked = pressAuraCandidates(u, cast, [u]);
    expect(picked.map((c) => c.row.spellId)).toEqual([ONE_OF_A_KIND]);
    expect(pressDuration(u, cast, [u], u.spellCastEvents)).toMatchObject({
      durationSeconds: 60,
      row: picked[0]!.row,
    });
    // the marker is a plain 30 s aura
    expect(buffFullDurationForCaster(ROLL_THE_BONES, u, T0)).toBe(30);
  });
});

describe("T273: Everlasting Elements, + 20 % on Earth Elemental", () => {
  it("2c8867a8: a holder's runs 36 s, an Elemental Shaman without it 30 s", () => {
    const holder = unit(
      CombatUnitSpec.Shaman_Elemental,
      [EVERLASTING_ELEMENTS],
      [[EARTH_ELEMENTAL, 0]],
    );
    const other = unit(
      CombatUnitSpec.Shaman_Elemental,
      [],
      [[EARTH_ELEMENTAL, 0]],
    );
    expect(buffFullDurationForCaster(EARTH_ELEMENTAL, holder, T0)).toBe(36);
    expect(buffFullDurationForCaster(EARTH_ELEMENTAL, other, T0)).toBe(30);
  });
});
