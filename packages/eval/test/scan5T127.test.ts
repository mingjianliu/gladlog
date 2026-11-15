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

function scan(casterReaction: CombatUnitReaction, which: typeof run) {
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
  which({
    lines: [
      "  [KILL WINDOW] 0:56–1:12 (16s) on Lock (Lock): open (defenseless 0:56–1:12)",
    ],
    start: T,
    byName: new Map([["Lock", lock]]),
    players: [lock, priest],
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, n: details.length };
}

describe("scan5 crossTeamShieldDefenseless", () => {
  it("a span through an other-side caster's pressed shield is a violation", () => {
    expect(scan(CombatUnitReaction.Friendly, run)).toEqual({
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
