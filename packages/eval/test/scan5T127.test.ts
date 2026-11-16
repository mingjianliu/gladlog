/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/t127 `crossTeamShieldDefenseless` (T127): scan5/allyShield's check
 * with the shield's caster on the target's other side.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run as runAlly } from "../scripts/scan5/allyShield";
import { run } from "../scripts/scan5/t127";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const VOID_SHIELD = "1253593";

function scan(
  casterReaction: CombatUnitReaction,
  which: typeof run,
  stolen = false,
  /** batch review 80-PIPE-97-B85: press 65.0 (no target), theft 65.5,
   * absorbing from 65.7, the APPLIED re-stated at 66.2 in a six-aura resync
   * batch */
  resync = false,
) {
  const appliedS = resync ? 66.2 : 65;
  const stolenS = resync ? 65.5 : 65;
  const fillers = resync
    ? ["1126", "21562", "6673", "1459", "462854"].map((id) =>
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          id,
          at(appliedS),
          "x9",
          "e1",
          "BUFF",
        ),
      )
    : [];
  const lock = makeUnit("e1", {
    name: "Lock",
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        VOID_SHIELD,
        at(appliedS),
        "p1",
        "e1",
        "BUFF",
      ),
      ...fillers,
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        VOID_SHIELD,
        at(70),
        "p1",
        "e1",
        "BUFF",
      ),
    ],
    actionOut: stolen
      ? [
          {
            srcUnitId: "e1",
            spellId: "30449",
            extraSpellId: VOID_SHIELD,
            timestamp: at(stolenS),
            logLine: { event: LogEvent.SPELL_STOLEN, timestamp: at(stolenS) },
          },
        ]
      : [],
    absorbsIn: [
      ...(resync
        ? [
            {
              spellId: VOID_SHIELD,
              srcUnitId: "p1",
              absorbedAmount: 20_000,
              timestamp: at(65.7),
              logLine: { timestamp: at(65.7) },
            },
          ]
        : []),
      {
        spellId: VOID_SHIELD,
        srcUnitId: "p1",
        absorbedAmount: 33_459,
        timestamp: at(68),
        logLine: { timestamp: at(68) },
      },
    ],
  });
  const priest = makeUnit("p1", {
    name: "Priest",
    reaction: casterReaction,
    spellCastEvents: [
      makeSpellCastEvent(
        VOID_SHIELD,
        at(65) - 1,
        "0000000000000000",
        "nil",
        "p1",
        "Priest",
      ),
    ],
  });
  let checked = 0;
  const details: string[] = [];
  const other: string[] = [];
  which({
    lines: [
      "  [KILL WINDOW] 0:56–1:12 (16s) on Lock (Lock): open (defenseless 0:56–1:12)",
    ],
    start: T,
    byName: new Map([["Lock", lock]]),
    players: [lock, priest],
    bump: () => checked++,
    violate: (_c: string, k: string, _t: number, _f: string, d: string) => {
      if (k === "pressed") details.push(d);
      else other.push(k);
    },
  } as any);
  return stolen
    ? { checked, n: details.length, other }
    : { checked, n: details.length };
}

describe("scan5 crossTeamShieldDefenseless", () => {
  it("a span through an other-side caster's pressed shield is a violation", () => {
    expect(scan(CombatUnitReaction.Friendly, run)).toEqual({
      checked: 1,
      n: 1,
    });
  });
  // batch review 80-PIPE-87-B78: the producer's reading — a stolen copy
  // keeps its victim's caster as its source and does not count
  it("a copy the target stole is counted as `stolen`, not a violation", () => {
    expect(scan(CombatUnitReaction.Friendly, run, true)).toEqual({
      checked: 1,
      n: 0,
      other: ["stolen"],
    });
  });
  // batch review 80-PIPE-97-B85: the theft is read against the
  // reconstructed start (the first absorb), not the late-logged APPLIED
  it("a stolen copy whose APPLIED a resync batch re-stated late is `stolen`", () => {
    expect(scan(CombatUnitReaction.Friendly, run, true, true)).toEqual({
      checked: 1,
      n: 0,
      other: ["stolen"],
    });
    // the same rows without the theft: the reconstructed run's press is found
    expect(scan(CombatUnitReaction.Friendly, run, false, true)).toEqual({
      checked: 1,
      n: 1,
    });
  });
  it("a same-side caster's is allyShield's, not this check's", () => {
    expect(scan(CombatUnitReaction.Hostile, run)).toEqual({ checked: 1, n: 0 });
    expect(scan(CombatUnitReaction.Hostile, runAlly)).toEqual({
      checked: 1,
      n: 1,
    });
    expect(scan(CombatUnitReaction.Friendly, runAlly)).toEqual({
      checked: 1,
      n: 0,
    });
  });
});
