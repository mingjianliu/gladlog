import {
  AtomicArenaCombat,
  CombatUnitReaction,
  CombatUnitSpec,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { computeHealerExposureEvents,DMG_SPIKE_THRESHOLD } from "../src";

// An ICombatUnit stub with every field correctly named (mirrors mkFullUnit in
// deepDive.window.test.ts — computeHealerExposureEvents' self-computing path has
// to run analyzePlayerCCAndTrinket / reconstructEnemyCDTimeline, so the field
// names must match the real interface; mismatched shorthand fields won't do).
const mkUnit = (
  id: string,
  name: string,
  friendly: boolean,
  spec: string,
): ICombatUnit =>
  ({
    id,
    name,
    ownerId: "",
    info: { specId: spec },
    spec,
    class: 0,
    reaction: friendly
      ? CombatUnitReaction.Friendly
      : CombatUnitReaction.Hostile,
    advancedActions: [],
    damageOut: [],
    damageIn: [],
    healOut: [],
    healIn: [],
    absorbsOut: [],
    absorbsIn: [],
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
  }) as unknown as ICombatUnit;

function mkCombatNoAdvanced(): AtomicArenaCombat {
  return {
    startTime: 0,
    endTime: 90_000,
    startInfo: { zoneId: "1552" },
    playerId: "o",
    units: {
      o: mkUnit("o", "Healer-Area52", true, CombatUnitSpec.Priest_Holy),
      e: mkUnit("e", "Emage-Area52", false, CombatUnitSpec.Mage_Frost),
    },
  } as unknown as AtomicArenaCombat;
}

function mkCombatNoHealer(): AtomicArenaCombat {
  return {
    startTime: 0,
    endTime: 90_000,
    startInfo: { zoneId: "1552" },
    playerId: "o",
    units: {
      o: mkUnit("o", "Warr-Area52", true, CombatUnitSpec.Warrior_Arms),
      e: mkUnit("e", "Emage-Area52", false, CombatUnitSpec.Mage_Frost),
    },
  } as unknown as AtomicArenaCombat;
}

describe("computeHealerExposureEvents", () => {
  it("无位置数据(无 advancedActions)→ 空数组,不抛", () => {
    const combat = mkCombatNoAdvanced();
    expect(computeHealerExposureEvents(combat)).toEqual([]);
  });

  it("无治疗(全 DPS 队)→ 空数组", () => {
    const combat = mkCombatNoHealer();
    expect(computeHealerExposureEvents(combat)).toEqual([]);
  });

  it("pre 注入路径与自算路径同型(buildMatchContext 等价性烟测)", () => {
    // Getting the self-computing path to run is enough here (we assert on the
    // result's shape); exact equivalence is covered by context's existing tests
    const combat = mkCombatNoAdvanced();
    const r = computeHealerExposureEvents(combat, undefined);
    expect(Array.isArray(r)).toBe(true);
  });
});

describe("DMG_SPIKE_THRESHOLD 单源导出", () => {
  it("package index 导出且与 timelineHelpers 同值", async () => {
    const helpers = await import("../src/context/timelineHelpers");
    expect(DMG_SPIKE_THRESHOLD).toBe(helpers.DMG_SPIKE_THRESHOLD);
  });
});
