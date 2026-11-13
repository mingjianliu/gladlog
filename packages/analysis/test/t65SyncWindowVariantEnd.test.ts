/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T65 (GH #167 item 28): `syncWindowCdFor` reads each press's observed end
 * off the cooldown timeline. The timeline lists a press under the id it
 * logged — an override variant, or an activation of the cooldown's effect
 * (Radiant Glory's Avenging Wrath 454351 on the 31884 row) — so the ends
 * are keyed on the cooldown, not on the ledger row's exact id.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  syncWindowCdFor,
  timelinePressMsOf,
} from "../src/analysis/candidates/cooldownTiming";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;
const combat = { startTime: START, endTime: START + 120_000 } as any;

describe("T65 — a press's observed end is keyed on its cooldown", () => {
  const ret = (castId: string) =>
    makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [
        makeSpellCastEvent(castId, START + 20_000, "p1", "Self", "p1"),
      ],
    });
  const row = {
    spellId: "31884",
    spellName: "Avenging Wrath",
    casts: [{ timeSeconds: 20 }],
  };
  const endsOf = (owner: any) =>
    (syncWindowCdFor(row, owner, [], new Set(), START, [owner], combat) as any)
      .castEndS as Map<number, number> | undefined;

  it("the activation 454351 gives the 31884 row its 8 s end", () => {
    expect(endsOf(ret("454351"))?.get(20_000)).toBe(28);
  });

  it("another cooldown's press in the same ms gives it none", () => {
    // Wake of Ashes is no press of Avenging Wrath
    expect(endsOf(ret("255937"))?.get(20_000)).toBeUndefined();
  });

  // codex 85-tk-H-T65-1 #1: the ledger stamps an activation at its aura
  // (19.9 s), the timeline at its cast row (20.0 s)
  describe("timelinePressMsOf", () => {
    const ends = new Map([
      [20_000, 28],
      [80_000, 90],
    ]);
    const cd = (...casts: number[]) => ({
      castEndS: ends,
      casts: casts.map((timeSeconds) => ({ timeSeconds })),
    });
    it("finds the timeline press a ledger activation 0.1 s earlier stands for", () => {
      expect(timelinePressMsOf(cd(19.9), 19.9)).toBe(20_000);
      expect(timelinePressMsOf(cd(20), 20)).toBe(20_000);
    });
    it("takes the nearest press, and none past the cast-to-aura pairing", () => {
      expect(timelinePressMsOf(cd(79.2), 79.2)).toBe(80_000);
      expect(timelinePressMsOf(cd(22), 22)).toBeUndefined();
      // no timeline at all: the press's own ms
      expect(timelinePressMsOf({ casts: [{ timeSeconds: 20 }] }, 20)).toBe(
        20_000,
      );
    });
    // codex 85-tk-H-T65-1b: a second charge the timeline folded away
    it("never takes the timeline press of another ledger press", () => {
      expect(timelinePressMsOf(cd(20, 20.8), 20.8)).toBeUndefined();
      expect(timelinePressMsOf(cd(20, 20.8), 20)).toBe(20_000);
    });
  });
});
