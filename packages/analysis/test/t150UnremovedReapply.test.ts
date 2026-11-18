import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { observedEffectEndSeconds } from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

/**
 * Pipeline T150 (GH #218): an offensive cooldown's aura APPLIED again with
 * no REMOVED after its official length ran out was up all along — the span
 * runs to the REMOVED the log wrote. Avatar 107574 (20 s) on its caster.
 */
const T0 = 1_000_000;
const AVATAR = "107574";

/** the batch that re-states a unit the log lost sight of: six other auras
 * APPLIED on it in the same millisecond (`isResyncBatchAt`) */
const restatedAt = (s: number) =>
  ["900001", "900002", "900003", "900004", "900005", "900006"].map((id) => ({
    ...makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      id,
      T0 + s * 1000,
      "c1",
      "c1",
      "BUFF",
    ),
    srcUnitName: "Caster",
  }));

function scene(auras: Array<[LogEvent, number]>, restatedS?: number) {
  const caster = makeUnit("c1", {
    name: "Caster",
    spellCastEvents: [makeSpellCastEvent(AVATAR, T0 + 10_000, "c1", "c1")],
    auraEvents: [
      ...auras.map(([ev, s]) => ({
        ms: T0 + s * 1000,
        row: {
          ...makeAuraEvent(ev, AVATAR, T0 + s * 1000, "c1", "c1", "BUFF"),
          srcUnitName: "Caster",
        },
      })),
      ...(restatedS === undefined
        ? []
        : restatedAt(restatedS).map((row) => ({
            ms: T0 + restatedS * 1000,
            row,
          }))),
    ]
      .sort((a, b) => a.ms - b.ms)
      .map((x) => x.row),
  } as never);
  const combat = {
    startTime: T0,
    endTime: T0 + 200_000,
    units: { c1: caster },
  } as never;
  return { caster, combat };
}
const endOf = (
  auras: Array<[LogEvent, number]>,
  restatedS?: number,
  nextSameCastS = Infinity,
) => {
  const { caster, combat } = scene(auras, restatedS);
  return observedEffectEndSeconds(caster, AVATAR, 10, nextSameCastS, combat);
};

describe("T150: a cooldown re-applied with no REMOVED past its official length", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const relisted: Array<[LogEvent, number]> = [
    [LogEvent.SPELL_AURA_APPLIED, 10],
    // official end 30; no REMOVED before this
    [LogEvent.SPELL_AURA_APPLIED, 33],
    [LogEvent.SPELL_AURA_REMOVED, 38],
  ];

  it("the span runs to the logged REMOVED when the run was listed again within one official length of the cap", () => {
    expect(endOf(relisted, 33)).toBe(38);
  });

  it("a second APPLIED that is a row of its own (no re-stating batch) is listed as its own (no press) occurrence, not this press's", () => {
    expect(endOf(relisted)).toBeNull();
  });

  it("a second APPLIED more than one official length after the cap is a separate application (a lost REMOVED reads the same): the official length stands", () => {
    expect(
      endOf(
        [
          [LogEvent.SPELL_AURA_APPLIED, 10],
          [LogEvent.SPELL_AURA_APPLIED, 51],
          [LogEvent.SPELL_AURA_REMOVED, 60],
        ],
        51,
      ),
    ).toBeNull();
  });

  it("an application just ahead of the caster's next press is that press's (codex 85-tk-KICK-T150-1 #1)", () => {
    expect(endOf(relisted, 33, 33.001)).toBeNull();
  });

  it("an application after the combat's end, clamped onto it, continues nothing (codex #2)", () => {
    expect(
      endOf(
        [
          [LogEvent.SPELL_AURA_APPLIED, 10],
          [LogEvent.SPELL_AURA_APPLIED, 230],
          [LogEvent.SPELL_AURA_REMOVED, 240],
        ],
        230,
      ),
    ).toBeNull();
  });

  it("a REMOVED before the second APPLIED ended the run where the log says", () => {
    expect(
      endOf([
        [LogEvent.SPELL_AURA_APPLIED, 10],
        [LogEvent.SPELL_AURA_REMOVED, 30],
        [LogEvent.SPELL_AURA_APPLIED, 33],
        [LogEvent.SPELL_AURA_REMOVED, 38],
      ]),
    ).toBe(30);
  });
});
