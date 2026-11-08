/**
 * WO3 #16 (r1008-57, 3df6ccf8 1:10): an enemy Ultimate Penitence names the
 * friendly its SUCCESS targets and what the channel dealt them — landed plus
 * absorbed, beside everything they took over the channel.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { channelTargetClause } from "../src/context/timelineSections/enemyDef";

const T0 = 1_000_000;
const enemy: any = {
  id: "e1",
  name: "Disc-R-US",
  spellCastEvents: [
    {
      spellId: "421453",
      spellName: "终极苦修",
      destUnitId: "f1",
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 70_065 },
    },
  ],
};
const hit = (
  s: number,
  src: string,
  spellId: string,
  spellName: string,
  amount: number,
) => ({
  srcUnitId: src,
  spellId,
  spellName,
  effectiveAmount: -amount,
  logLine: { timestamp: T0 + s * 1000 },
});
const target: any = {
  id: "f1",
  name: "Dk-R-US",
  damageIn: [
    hit(71, "e1", "421543", "终极苦修", 100_000),
    hit(72, "e2", "1", "Fireball", 30_000),
    hit(80, "e1", "421543", "终极苦修", 50_000), // after the channel
  ],
  absorbsIn: [
    {
      timestamp: T0 + 73_000,
      logLine: { timestamp: T0 + 73_000 },
      attackerId: "e1",
      attackSpellId: "421543",
      attackSpellName: "终极苦修",
      absorbedAmount: 20_000,
    },
  ],
};
const d = {
  spellId: "421453",
  atSeconds: 70.065,
  pressSeconds: 70.065,
  observedSeconds: 6.495,
};

describe("channelTargetClause", () => {
  it("names the target and the channel's landed + absorbed damage among all it took", () => {
    expect(
      channelTargetClause(
        enemy,
        d,
        [target],
        T0,
        T0 + 200_000,
        (n) => `[${n}]`,
      ),
    ).toBe(
      " — its bolts hit [Dk-R-US]: 120k of the 150k damage they took over it",
    );
  });
  it("no friendly hit, or no length, says nothing", () => {
    expect(channelTargetClause(enemy, d, [], T0, T0 + 200_000, (n) => n)).toBe(
      "",
    );
    expect(
      channelTargetClause(
        enemy,
        { ...d, observedSeconds: undefined },
        [target],
        T0,
        T0 + 200_000,
        (n) => n,
      ),
    ).toBe("");
  });
  it("a save that is no channel says nothing: Blazing Barrier's reactive hits are no bolts (pipeline T02, fact12 D15 / D24)", () => {
    const mage = {
      id: "e1",
      name: "Mage-R-US",
      spellCastEvents: [
        {
          spellId: "235313",
          spellName: "Blazing Barrier",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: T0 + 45_040,
          },
        },
      ],
    } as unknown as Parameters<typeof channelTargetClause>[0];
    const meleeAttacker = {
      id: "f1",
      name: "Dk-R-US",
      damageIn: [hit(45.5, "e1", "235314", "Blazing Barrier", 1_500)],
      absorbsIn: [],
    } as unknown as Parameters<typeof channelTargetClause>[2][number];
    expect(
      channelTargetClause(
        mage,
        {
          spellId: "235313",
          atSeconds: 45.04,
          pressSeconds: 45.04,
          observedSeconds: 1.39,
        },
        [meleeAttacker],
        T0,
        T0 + 200_000,
        (n) => n,
      ),
    ).toBe("");
  });
  it("clipped at the round's end", () => {
    expect(
      channelTargetClause(enemy, d, [target], T0, T0 + 71_500, (n) => n),
    ).toBe(
      " — its bolts hit Dk-R-US: 100k of the 100k damage they took over it",
    );
  });
  it("names where the bolts landed, largest first, and the cast row's target when it is someone else (work order 2026-10-14d #2, f94a7604 1:05)", () => {
    const hunter: any = {
      id: "f1",
      name: "Hunter-R-US",
      damageIn: [hit(71, "e1", "421543", "终极苦修", 9_329)],
      absorbsIn: [],
    };
    const priest: any = {
      id: "f2",
      name: "Priest-R-US",
      damageIn: [
        hit(72, "e1", "421543", "终极苦修", 600_000),
        hit(73, "e1", "421543", "终极苦修", 73_000),
        hit(74, "e2", "1", "Fireball", 27_000),
      ],
      absorbsIn: [],
    };
    expect(
      channelTargetClause(
        enemy,
        d,
        [hunter, priest],
        T0,
        T0 + 200_000,
        (n) => n,
      ),
    ).toBe(
      " — its bolts hit Priest-R-US: 673k of the 700k damage they took over it; Hunter-R-US: 9k of the 9k damage they took over it (its cast row names Hunter-R-US)",
    );
  });
  it("what they took is the damage-taken predicate: their own rows count, a deferral shield's hold does not (fact12 D19, 66bd381b 1:40)", () => {
    // the rogue's own deferred Time Dilation tick lands as self → self
    // damage; a reflected spell is logged as the victim's own; Time
    // Dilation's SPELL_ABSORBED only held the hit back
    const rogue = {
      id: "f1",
      name: "Rogue-R-US",
      damageIn: [
        hit(71, "e1", "421543", "终极苦修", 321_000),
        hit(72, "f1", "361029", "Time Dilation", 149_000),
        hit(73, "f1", "445468", "Wither", 38_000),
        hit(74, "e2", "1", "Fireball", 197_000),
      ],
      absorbsIn: [
        {
          timestamp: T0 + 72_500,
          logLine: { timestamp: T0 + 72_500 },
          spellId: "357170",
          attackerId: "e2",
          attackSpellId: "1",
          attackSpellName: "Fireball",
          absorbedAmount: 90_000,
        },
      ],
    } as never;
    expect(
      channelTargetClause(enemy, d, [rogue], T0, T0 + 200_000, (n) => n),
    ).toBe(
      " — its bolts hit Rogue-R-US: 321k of the 705k damage they took over it",
    );
  });
});
