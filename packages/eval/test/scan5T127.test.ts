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
) {
  const lock = makeUnit("e1", {
    name: "Lock",
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        VOID_SHIELD,
        at(65),
        "p1",
        "e1",
        "BUFF",
      ),
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
            timestamp: at(65),
            logLine: { event: LogEvent.SPELL_STOLEN, timestamp: at(65) },
          },
        ]
      : [],
    absorbsIn: [
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
