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
      " — channelled at [Dk-R-US]: it dealt 120k of the 150k damage they took over it",
    );
  });
  it("a SUCCESS on no friendly, or no length, says nothing", () => {
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
  it("clipped at the round's end", () => {
    expect(
      channelTargetClause(enemy, d, [target], T0, T0 + 71_500, (n) => n),
    ).toBe(
      " — channelled at Dk-R-US: it dealt 100k of the 100k damage they took over it",
    );
  });
});
