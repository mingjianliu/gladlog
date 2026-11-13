/**
 * Pipeline T72 attempt 2: a press with no effect aura and no official length
 * runs to the delivery the log shows (`pressDeliveryEndSeconds`), and a burst
 * is said to have dealt no damage only when it had a window
 * (`burstSaysNoDamage`). Seen on 605 at 387cc6a70: 114 owner presses (Meteor
 * 80, Soul Fire 34) delivered 0.2–2.38 s after a zero-length burst window.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { burstSaysNoDamage } from "../src/utils/burstLedger";
import {
  PRESS_DELIVERY_REACH_S,
  pressDeliveryEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const METEOR = "153561";
const cast = (s: number) => ({
  spellId: METEOR,
  spellName: "Meteor",
  srcUnitId: "u",
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});
const hit = (
  s: number,
  destUnitId = "v",
  spellId = "351140",
  spellName = "Meteor",
) => ({
  spellId,
  spellName,
  srcUnitId: "u",
  destUnitId,
  effectiveAmount: 120_000,
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + s * 1000 },
});
const mage = (casts: unknown[], damageOut: unknown[]) =>
  ({
    id: "u",
    name: "Mage",
    type: CombatUnitType.Player,
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Fire,
    spellCastEvents: casts,
    auraEvents: [],
    damageIn: [],
    damageOut,
    healOut: [],
    healIn: [],
  }) as never;
const other = (id: string, type: CombatUnitType, hostile: boolean) => ({
  id,
  type,
  reaction: hostile ? CombatUnitReaction.Hostile : CombatUnitReaction.Friendly,
  auraEvents: [],
});
const spanOf = (casts: unknown[], damageOut: unknown[], n = 0) => {
  const u = mage(casts, damageOut);
  const combat = {
    startTime: T0,
    endTime: T0 + 300_000,
    units: {
      u,
      v: other("v", CombatUnitType.Player, true),
      pet: other("pet", CombatUnitType.Guardian, true),
      mate: other("mate", CombatUnitType.Player, false),
    },
  } as never;
  const cd = reconstructEnemyCDTimeline([u], combat).players[0]!.offensiveCDs[
    n
  ]!;
  return { from: cd.castTimeSeconds, to: cd.buffEndSeconds };
};

describe("pressDeliveryEndSeconds", () => {
  it("Meteor pressed at 9.2 with its impact at 11.49 runs to the impact", () => {
    const s = spanOf([cast(9.2)], [hit(11.49), hit(11.49)]);
    expect(s.from).toBeCloseTo(9.2, 3);
    expect(s.to).toBeCloseTo(11.49, 3);
  });

  it("a press the log shows no row of stays the press instant", () => {
    const s = spanOf([cast(9.2)], []);
    expect(s.to).toBeCloseTo(9.2, 3);
  });

  it("a differently named part of the button is not read (Meteor Burn)", () => {
    const s = spanOf(
      [cast(9.2)],
      [hit(11.49), hit(15.5, "v", "155158", "Meteor Burn")],
    );
    expect(s.to).toBeCloseTo(11.49, 3);
  });

  it("a hit a shield ate whole is the delivery, by its attack spell (codex 81-tk-G-T72-2 #1)", () => {
    const eaten = (s: number, attackSpellId?: string, attackName?: string) => ({
      // the row's own spell is the shield's
      spellId: "17",
      spellName: "Power Word: Shield",
      attackSpellId,
      attackSpellName: attackName,
      srcUnitId: "u",
      destUnitId: "v",
      effectiveAmount: 120_000,
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: T0 + s * 1000 },
    });
    expect(
      spanOf([cast(9.2)], [eaten(11.49, "351140", "Meteor")]).to,
    ).toBeCloseTo(11.49, 3);
    // another attack into the shield, or a swing (no attack spell): not it
    expect(
      spanOf([cast(9.2)], [eaten(11.49, "133", "Fireball"), eaten(11.6)]).to,
    ).toBeCloseTo(9.2, 3);
  });

  it("only rows on a player of the other side count", () => {
    const s = spanOf([cast(9.2)], [hit(11.4, "pet"), hit(11.5, "mate")]);
    expect(s.to).toBeCloseTo(9.2, 3);
  });

  it("a row past the bound, or after the button's next press, is not this press's", () => {
    expect(
      spanOf([cast(9.2)], [hit(9.2 + PRESS_DELIVERY_REACH_S + 0.1)]).to,
    ).toBeCloseTo(9.2, 3);
    // two presses 3 s apart: the first reads up to the second press only
    const rows = [hit(11.4), hit(14.6)];
    expect(spanOf([cast(9.2), cast(12.2)], rows, 0).to).toBeCloseTo(11.4, 3);
    expect(spanOf([cast(9.2), cast(12.2)], rows, 1).to).toBeCloseTo(14.6, 3);
  });

  it("reads the row at the bound and not the press's own instant", () => {
    const u = mage([], [hit(9.2), hit(9.2 + PRESS_DELIVERY_REACH_S)]);
    const units = [u, other("v", CombatUnitType.Player, true)] as never;
    expect(
      pressDeliveryEndSeconds(u, units, "Meteor", 9.2, Infinity, T0),
    ).toBeCloseTo(9.2 + PRESS_DELIVERY_REACH_S, 3);
    const only = mage([], [hit(9.2)]);
    expect(
      pressDeliveryEndSeconds(only, units, "Meteor", 9.2, Infinity, T0),
    ).toBeUndefined();
  });
});

describe("burstSaysNoDamage", () => {
  it("a zero-length burst says nothing; one with a window and no rows says so", () => {
    expect(
      burstSaysNoDamage({ dominantTarget: null, fromSeconds: 8, toSeconds: 8 }),
    ).toBe(false);
    expect(
      burstSaysNoDamage({
        dominantTarget: null,
        fromSeconds: 8,
        toSeconds: 10.3,
      }),
    ).toBe(true);
    expect(
      burstSaysNoDamage({
        dominantTarget: {} as never,
        fromSeconds: 8,
        toSeconds: 10.3,
      }),
    ).toBe(false);
  });
});
