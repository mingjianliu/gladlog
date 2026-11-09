/**
 * fact12 D32 (f13566f0 r0 2:17): the game strips a dying unit's auras in the
 * millisecond of the lethal hit and can write UNIT_DIED later — the Obsidian
 * Scales copy's REMOVED, PARTY_KILL and the Bladestorm with overkill at
 * 37.841, UNIT_DIED at 37.966. The end cause read "removed early".
 */
import { describe, expect, it } from "vitest";

import {
  deathTeardownWindowsMs,
  LETHAL_HIT_DEATH_LAG_MS,
  removedByDeath,
  removedInDeathTeardown,
} from "../src/utils/unitDeath";

const hit = (ms: number, overkill: number) => ({
  overkill,
  logLine: { timestamp: ms },
});
const reading = (ms: number, hp: number) => ({
  logLine: { timestamp: ms },
  advancedActorCurrentHp: hp,
});
type Unit = Parameters<typeof deathTeardownWindowsMs>[0];
const unit = (
  deaths: number[],
  hits: ReturnType<typeof hit>[],
  readings: ReturnType<typeof reading>[] = [],
): Unit =>
  ({
    deathRecords: deaths.map((timestamp) => ({ timestamp })),
    damageIn: hits,
    advancedActions: readings,
  }) as unknown as Unit;

describe("deathTeardownWindowsMs / removedInDeathTeardown", () => {
  const scales = unit([37_966], [hit(37_841, 2_327)]);
  it("UNIT_DIED 125 ms after the lethal hit: the window runs from the hit", () => {
    expect(deathTeardownWindowsMs(scales)).toEqual([
      { fromMs: 37_841, deathMs: 37_966 },
    ]);
  });
  it("a removal in the lethal hit's ms, or between it and UNIT_DIED, is the teardown", () => {
    const w = deathTeardownWindowsMs(scales);
    expect(removedInDeathTeardown(w, 37_841)).toBe(true);
    // codex 85-tk-A-T08-2 #2: logged 1 ms after the hit, 124 ms before UNIT_DIED
    expect(removedInDeathTeardown(w, 37_842)).toBe(true);
    // the cascade's slack before the hit (a teardown logged ahead of the
    // overkill row: Touch of Death 12 ms after the strips)
    expect(removedInDeathTeardown(w, 37_741)).toBe(true);
    expect(removedInDeathTeardown(w, 37_740)).toBe(false);
    expect(removedInDeathTeardown(w, 37_967)).toBe(false);
    // on UNIT_DIED alone it was not (125 ms > DEATH_CASCADE_MS)
    expect(removedByDeath([37_966], 37_841)).toBe(false);
  });
  it("the aura's own natural end is never the teardown", () => {
    expect(
      removedInDeathTeardown(deathTeardownWindowsMs(scales), 37_850, 37_850),
    ).toBe(false);
  });
  it("overkill the unit survived — a reading above 0 HP after it — starts no window (codex 85-tk-A-T08-2 #1)", () => {
    const u = unit([9_500], [hit(9_000, 6_392)], [reading(9_329, 1_141)]);
    expect(deathTeardownWindowsMs(u)).toEqual([
      { fromMs: 9_500, deathMs: 9_500 },
    ]);
    expect(removedInDeathTeardown(deathTeardownWindowsMs(u), 8_990)).toBe(
      false,
    );
  });
  it("a hit with no overkill, or one the death trails by more than the bound, adds nothing", () => {
    expect(deathTeardownWindowsMs(unit([37_966], [hit(37_841, 0)]))).toEqual([
      { fromMs: 37_966, deathMs: 37_966 },
    ]);
    expect(
      deathTeardownWindowsMs(
        unit([37_966], [hit(37_966 - LETHAL_HIT_DEATH_LAG_MS - 1, 500)]),
      ),
    ).toEqual([{ fromMs: 37_966, deathMs: 37_966 }]);
  });
  it("overkill with no UNIT_DIED: no window", () => {
    expect(deathTeardownWindowsMs(unit([], [hit(37_841, 500)]))).toEqual([]);
  });
  it("no lethal hit: the window is removedByDeath's reading", () => {
    const w = deathTeardownWindowsMs(unit([37_966], []));
    for (const ms of [37_865, 37_866, 37_966, 37_967])
      expect(removedInDeathTeardown(w, ms)).toBe(removedByDeath([37_966], ms));
  });
});
