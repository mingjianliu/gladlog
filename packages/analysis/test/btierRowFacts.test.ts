/**
 * B-tier row facts (user rulings 2026-10-06), the predicates behind them:
 *  - B4a `lastTrinketPressBefore`: the trinket press behind a `trinket: ON CD`
 *    note and what it broke (8930cb36: 0:42 Kidney Shot, trinket used 0:16 on
 *    Dismantle);
 *  - B13d `ownerRemovedOtherCopy`: the owner took the same caster's other copy
 *    of the buff while this one sat unpurged (0068182d 0:17 / 0:20).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { lastTrinketPressBefore } from "../src/utils/ccTrinketAnalysis";
import { ownerRemovedOtherCopy } from "../src/utils/dispelAnalysis";

const T0 = 1_000_000;

describe("lastTrinketPressBefore (B4a)", () => {
  const cc = (atSeconds: number, durationSeconds: number, spellName: string) =>
    ({
      atSeconds,
      durationSeconds,
      spellId: spellName,
      spellName,
      trinketState: "used",
    }) as any;
  const summary = (over: Record<string, unknown> = {}) =>
    ({
      trinketType: "Gladiator",
      trinketCooldownSeconds: 120,
      trinketUseTimes: [16.4],
      ccInstances: [],
      disarmInstances: [
        {
          atSeconds: 15.2,
          durationSeconds: 1.2,
          spellId: "207777",
          spellName: "Dismantle",
          sourceName: "Rogue-E",
        },
      ],
      ...over,
    }) as any;

  it("names the press and the disarm it broke while its cooldown runs", () => {
    expect(lastTrinketPressBefore(summary(), 42.3, T0)).toEqual({
      atSeconds: 16.4,
      brokeSpellName: "Dismantle",
    });
  });

  it("a control the press broke is named before a disarm", () => {
    const s = summary({ ccInstances: [cc(14, 2.4, "Psychic Scream")] });
    expect(lastTrinketPressBefore(s, 42.3, T0)?.brokeSpellName).toBe(
      "Psychic Scream",
    );
  });

  it("a press the log ties to nothing carries no `on X`", () => {
    const s = summary({ disarmInstances: [] });
    expect(lastTrinketPressBefore(s, 42.3, T0)).toEqual({ atSeconds: 16.4 });
  });

  it("null once that press's own cooldown is over, with no press yet, and for a trinket nobody presses", () => {
    expect(lastTrinketPressBefore(summary(), 137, T0)).toBeNull();
    expect(lastTrinketPressBefore(summary(), 10, T0)).toBeNull();
    expect(
      lastTrinketPressBefore(summary({ trinketType: "Relentless" }), 42, T0),
    ).toBeNull();
  });

  it("a trinket locked only by a racial press was not 'last used'", () => {
    const s = summary({
      trinketUseTimes: [],
      racialTrinketLocks: [{ atSeconds: 30, lockSeconds: 90 }],
    });
    expect(lastTrinketPressBefore(s, 42, T0)).toBeNull();
  });

  it("of two presses, the later one that is still cooling down", () => {
    const s = summary({ trinketUseTimes: [16.4, 150] });
    expect(lastTrinketPressBefore(s, 200, T0)?.atSeconds).toBe(150);
  });
});

describe("ownerRemovedOtherCopy (B13d)", () => {
  const FREEDOM = "1044";
  const applied = (s: number, src: string, dest: string): any => ({
    spellId: FREEDOM,
    spellName: "Blessing of Freedom",
    timestamp: T0 + s * 1000,
    srcUnitId: src,
    destUnitId: dest,
    logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + s * 1000 },
  });
  const enemies = (warriorSrc = "pal"): any[] => [
    { name: "Paladin-E", auraEvents: [applied(17.1, "pal", "pal")] },
    { name: "Warrior-E", auraEvents: [applied(18.0, warriorSrc, "war")] },
  ];
  const miss = {
    timeSeconds: 17.1,
    durationSeconds: 8,
    enemyName: "Paladin-E",
    spellId: FREEDOM,
  };
  const steal = (over: Record<string, unknown> = {}): any => ({
    timeSeconds: 20.3,
    removedSpellId: FREEDOM,
    sourceName: "Mage-O",
    targetName: "Warrior-E",
    isSpellSteal: true,
    ...over,
  });

  it("the same caster's copy on another enemy, stolen inside the window (0068182d)", () => {
    expect(
      ownerRemovedOtherCopy(miss, "Mage-O", [steal()], enemies(), T0),
    ).toEqual({ atSeconds: 20.3, isSpellSteal: true });
  });

  it("not when another caster applied that copy, or its source is not in the log", () => {
    expect(
      ownerRemovedOtherCopy(miss, "Mage-O", [steal()], enemies("pal2"), T0),
    ).toBeNull();
    const unknown = enemies();
    unknown[1].auraEvents = [];
    expect(
      ownerRemovedOtherCopy(miss, "Mage-O", [steal()], unknown, T0),
    ).toBeNull();
  });

  it("not a teammate's removal, another buff, the same unit's, or one outside the window", () => {
    const none = (p: any) =>
      expect(
        ownerRemovedOtherCopy(miss, "Mage-O", [p], enemies(), T0),
      ).toBeNull();
    none(steal({ sourceName: "Shaman-O" }));
    none(steal({ removedSpellId: "1022" }));
    none(steal({ targetName: "Paladin-E" }));
    none(steal({ timeSeconds: 25.2 }));
    none(steal({ timeSeconds: 17.0 }));
  });

  it("a purge that is not a steal says so", () => {
    expect(
      ownerRemovedOtherCopy(
        miss,
        "Mage-O",
        [steal({ isSpellSteal: false })],
        enemies(),
        T0,
      )?.isSpellSteal,
    ).toBe(false);
  });
});
