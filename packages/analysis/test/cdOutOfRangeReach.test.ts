/**
 * Reliability round 2 W1f (2026-09-26): CD_OUT_OF_RANGE measures each
 * offensive cooldown against its own reach, and abstains where distance at
 * the press cannot prove a wasted press.
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { SUMMON_SPELL_IDS } from "../src/data/summonGenerated";
import {
  beyondReachThroughout,
  cdOutOfRangeReachYards,
  cdRangeSweepSeconds,
} from "../src/utils/positionAnalysis";
import { RANGE_HITBOX_SLACK_YD } from "../src/utils/spellRange";
import { makeAdvancedAction, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cdOutOfRangeReachYards", () => {
  it("abstains on a summon (DB2 SpellEffect 28): Grimoire: Imp Lord, Summon Infernal", () => {
    const lock = makeUnit("p1", {
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Demonology,
    });
    expect(SUMMON_SPELL_IDS.has("1276452")).toBe(true);
    expect(cdOutOfRangeReachYards(lock, "1276452")).toBeNull();
    expect(cdOutOfRangeReachYards(lock, "1122")).toBeNull();
  });

  it("abstains on a self-buff that hits no enemy itself: Avatar, Combustion", () => {
    const warrior = makeUnit("p1", {
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
    });
    expect(cdOutOfRangeReachYards(warrior, "107574")).toBeNull();
    const mage = makeUnit("p2", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Fire,
    });
    expect(cdOutOfRangeReachYards(mage, "190319")).toBeNull();
  });

  it("measures a targeted cooldown against its own range plus the hitbox slack: Colossus Smash is melee, not 15 yd", () => {
    const warrior = makeUnit("p1", {
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
    });
    const reach = cdOutOfRangeReachYards(warrior, "167105");
    expect(reach).not.toBeNull();
    expect(reach!).toBeGreaterThan(RANGE_HITBOX_SLACK_YD);
    expect(reach!).toBeLessThan(15);
  });
});

describe("cdRangeSweepSeconds", () => {
  it("samples every rendered whole second after an off-grid press (codex review: 10.5 s press, connection at 11.0)", () => {
    const t = cdRangeSweepSeconds(10.5);
    expect(t[0]).toBe(10.5);
    expect(t).toContain(11);
    expect(t).toContain(15);
    expect(t[t.length - 1]).toBe(15.5);
    // half-second spacing: no gap between samples wider than 0.5 s
    for (let i = 1; i < t.length; i++)
      expect(t[i]! - t[i - 1]!).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("an on-grid press samples its own second and every half second through +5 s", () => {
    expect(cdRangeSweepSeconds(10)).toEqual([
      10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15,
    ]);
  });
});

describe("beyondReachThroughout (exact closest approach between position events)", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const every = (from: number, to: number, x: number) =>
    Array.from({ length: (to - from) * 2 + 1 }, (_, i) =>
      makeAdvancedAction(at(from + i / 2), x, 0),
    );
  const owner = () =>
    makeUnit("p1", { advancedActions: every(0, 30, 0) }) as never;
  const enemy = (extra: ReturnType<typeof makeAdvancedAction>[] = []) =>
    makeUnit("e1", {
      advancedActions: [...every(0, 30, 7.5), ...extra].sort(
        (a, b) => a.timestamp - b.timestamp,
      ),
    }) as never;

  it("stays beyond a 7 yd reach at 7.5 yd for the whole window → true", () => {
    expect(beyondReachThroughout(owner(), [enemy()], T0, 10.5, 7)).toBe(true);
  });

  it("codex's counterexample: 7.5 yd at 11.0 and 11.5, 6.5 yd at 11.25 → the dip is found → false", () => {
    const dip = [makeAdvancedAction(at(11.25), 6.5, 0)];
    expect(beyondReachThroughout(owner(), [enemy(dip)], T0, 10.5, 7)).toBe(
      false,
    );
  });

  it("a crossing between two position events is caught by the closest approach (enemy passes the owner)", () => {
    const pass = makeUnit("e2", {
      advancedActions: [
        makeAdvancedAction(at(0), 20, 5),
        makeAdvancedAction(at(12), 20, 5),
        makeAdvancedAction(at(13), -20, 5), // passes 5 yd from the owner mid-segment
        makeAdvancedAction(at(30), -20, 5),
      ],
    }) as never;
    expect(beyondReachThroughout(owner(), [pass], T0, 10.5, 7)).toBe(false);
  });

  it("a position gap inside the window is not bridged: events at 10.1 and 13.4 leave 11.6–11.9 unknown → false (codex review)", () => {
    const gappy = makeUnit("e4", {
      advancedActions: [
        ...every(0, 10, 7.5),
        makeAdvancedAction(at(10.1), 7.5, 0),
        makeAdvancedAction(at(13.4), 7.5, 0),
        ...every(14, 30, 7.5),
      ],
    }) as never;
    expect(beyondReachThroughout(owner(), [gappy], T0, 10.5, 7)).toBe(false);
  });

  it("an enemy with no position in the window → false (the claim needs every enemy observed)", () => {
    const ghost = makeUnit("e3", { advancedActions: [] }) as never;
    expect(beyondReachThroughout(owner(), [enemy(), ghost], T0, 10.5, 7)).toBe(
      false,
    );
  });
});
