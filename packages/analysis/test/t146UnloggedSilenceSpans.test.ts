/**
 * Pipeline T146 (fact14 D5) — a silence the log writes no aura for is
 * cannot-cast time for as long as the owner's refused presses prove it.
 * 3c8cd2a3 r0 0:29: `[INACTIVITY] … inactive 6.2s (6.2s of it un-CC'd/free
 * to cast)` beside `pressed but rejected (silenced×14)`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { detectHealingGaps } from "../src/utils/healingGaps";
import type { RawStreams } from "../src/utils/rawStreams";
import {
  unloggedSilencesOnOwner,
  unloggedSilenceSpansOnOwner,
} from "../src/utils/unloggedSilence";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const SOLAR_BEAM = "78675";
const FLASH_HEAL = "2061"; // a silence stops it
const SILENCED = "Can't do that while silenced";

beforeAll(async () => {
  await ensureAnalysisData();
});

const druid = (beamAtS: number[]): ICombatUnit =>
  makeUnit("e1", {
    name: "Druid",
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: beamAtS.map((s) =>
      makeSpellCastEvent(SOLAR_BEAM, at(s), "h", "Me", "e1", "Druid"),
    ) as never,
  });
const healerWith = (castsAtS: number[]): ICombatUnit =>
  makeUnit("h", {
    name: "Me",
    spec: CombatUnitSpec.Priest_Holy,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: castsAtS.map((s) =>
      makeSpellCastEvent(FLASH_HEAL, at(s), "f1", "Mate", "h", "Me"),
    ) as never,
  });
const raw = (
  refusals: Array<[number, string]>,
  available = true,
): RawStreams => ({
  available,
  manaSamples: [],
  castFailed: refusals.map(([s, reason]) => ({
    tSeconds: s,
    unitGuid: "h",
    spellId: Number(FLASH_HEAL),
    spellName: "Flash Heal",
    reason,
  })),
});
const spans = (
  owner: ICombatUnit,
  enemy: ICombatUnit,
  rawStreams: RawStreams,
) =>
  unloggedSilenceSpansOnOwner({
    owner,
    allUnits: [owner, enemy],
    enemies: [enemy],
    matchStartMs: T0,
    roundEndAtMs: at(200),
    rawStreams,
  }).map((s) => [s.from - T0, s.to - T0]);

describe("T146 — the proven span of an aura-less silence", () => {
  it("runs from the first refusal to the last under one cast", () => {
    expect(
      spans(
        healerWith([29, 35.971]),
        druid([29.667]),
        raw([
          [31.938, SILENCED],
          [33.2, SILENCED],
          [35.707, SILENCED],
        ]),
      ),
    ).toEqual([[31_938, 35_707]]);
  });
  it("claims nothing for one refusal: the log gives the silence no length", () => {
    const owner = healerWith([29]);
    const enemy = druid([29.667]);
    const streams = raw([[31.938, SILENCED]]);
    expect(spans(owner, enemy, streams)).toEqual([]);
    // …while the [SILENCE] line still has its silence
    expect(
      unloggedSilencesOnOwner({
        owner,
        allUnits: [owner, enemy],
        enemies: [enemy],
        matchStartMs: T0,
        roundEndAtMs: at(200),
        rawStreams: streams,
      }),
    ).toHaveLength(1);
  });
  it("is cut where a spell a silence stops went out between two refusals", () => {
    expect(
      spans(
        healerWith([29, 33.5]),
        druid([29.667]),
        raw([
          [31.9, SILENCED],
          [33.0, SILENCED],
          [34.0, SILENCED],
          [35.0, SILENCED],
        ]),
      ),
    ).toEqual([
      [31_900, 33_000],
      [34_000, 35_000],
    ]);
  });
  it("reads only refusals as silenced, and only under such a cast", () => {
    expect(
      spans(
        healerWith([29]),
        druid([29.667]),
        raw([
          [31, "Not yet recovered"],
          [32, "Not yet recovered"],
        ]),
      ),
    ).toEqual([]);
    expect(
      spans(
        healerWith([29]),
        druid([]),
        raw([
          [31, SILENCED],
          [32, SILENCED],
        ]),
      ),
    ).toEqual([]);
  });
  it("is empty for a unit that did not record the log", () => {
    expect(
      spans(
        healerWith([29]),
        druid([29.667]),
        raw(
          [
            [31, SILENCED],
            [33, SILENCED],
          ],
          false,
        ),
      ),
    ).toEqual([]);
  });
});

describe("T146 — a healing gap's free-to-cast time leaves the span out", () => {
  const friend = makeUnit("f1", {
    name: "Mate",
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    damageIn: [
      { logLine: { timestamp: at(32) }, effectiveAmount: -500_000 },
    ] as never,
  });
  const gaps = (rawStreams?: RawStreams) => {
    const healer = healerWith([29.5, 35.7]);
    const enemy = druid([29.667]);
    return detectHealingGaps(
      healer,
      [healer, friend],
      [enemy],
      {
        startTime: T0,
        endTime: at(120),
        units: { h: healer, f1: friend, e1: enemy },
      },
      rawStreams ? { rawStreams } : {},
    ).map((g) => [g.durationSeconds, g.freeCastSeconds]);
  };
  const refusals = raw([
    [31.9, SILENCED],
    [33.0, SILENCED],
    [35.6, SILENCED],
  ]);

  it("6.2 s idle, 3.7 s of it between refusals as silenced: 2.5 s free", () => {
    const [[duration, free]] = gaps(refusals) as [[number, number]];
    expect(duration).toBeCloseTo(6.2, 5);
    expect(free).toBeCloseTo(2.5, 5);
  });
  it("without the refusals (no raw streams) the whole gap reads free", () => {
    const [[duration, free]] = gaps() as [[number, number]];
    expect(free).toBeCloseTo(duration, 5);
  });
  it("a gap with less than the minimum left free is no gap", () => {
    expect(
      gaps(
        raw([
          [29.9, SILENCED],
          [35.6, SILENCED],
        ]),
      ),
    ).toEqual([]);
  });
});
