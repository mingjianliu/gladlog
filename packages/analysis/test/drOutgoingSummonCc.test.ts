/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reliability audit C6 (2026-09-25): a CC applied by a friendly summon is the
 * owner's CC in the outgoing chains. 4ef486f5 r1: Intimidation ×3 and
 * Capacitor Totem ×2 on the enemy healer were rendered in [CC ON ENEMY] (by
 * X's pet) but dropped from `analyzeOutgoingCCChains`, so the enemy-healer CC
 * windows, kill-attempt openers and the next player stun's DR label (Full)
 * were all built without them.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";

import { analyzeOutgoingCCChains } from "../src/utils/drAnalysis";
import { makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;

const aura = (event: LogEvent, spellId: string, sec: number, src: string) => ({
  logLine: { event, timestamp: S(sec), parameters: [] },
  timestamp: S(sec),
  spellId,
  spellName: spellId,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: "heal",
  destUnitName: "Heal",
  effectiveAmount: 0,
});

const build = (totemOwner: string) => {
  const shaman = makeUnit("sham");
  const pal = makeUnit("pal");
  const enemySham = makeUnit("esham");
  const totem = makeUnit("totem");
  (totem as any).ownerId = totemOwner;
  const heal = makeUnit("heal", {
    spec: CombatUnitSpec.Priest_Holy,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, "118905", 50.2, "totem"), // Capacitor stun
      aura(LogEvent.SPELL_AURA_REMOVED, "118905", 53.2, "totem"),
      aura(LogEvent.SPELL_AURA_APPLIED, "853", 55.0, "pal"), // Hammer of Justice
      aura(LogEvent.SPELL_AURA_REMOVED, "853", 57.5, "pal"),
    ],
  });
  (heal as any).type = CombatUnitType.Player;
  const combat = {
    startTime: T0,
    endTime: T0 + 300_000,
    startInfo: { zoneId: "0" },
    units: { sham: shaman, pal, esham: enemySham, totem, heal },
  } as any;
  return analyzeOutgoingCCChains(
    [shaman, pal] as any,
    [heal] as any,
    combat,
  )[0]!.applications;
};

describe("outgoing chains credit summon-sourced CC to the owner (C6)", () => {
  it("a friendly Capacitor Totem stun is in the chain, credited to its owner, and puts the next Hammer on 50 % DR", () => {
    const apps = build("sham");
    expect(apps.map((a) => [a.spellId, a.casterName, a.drInfo.level])).toEqual([
      ["118905", "sham", "Full"],
      ["853", "pal", "50%"],
    ]);
    expect(apps[0]!.durationSeconds).toBeCloseTo(3, 5);
  });

  it("an ENEMY-owned totem's stun on its own teammate is not ours", () => {
    const apps = build("esham");
    expect(apps.map((a) => [a.spellId, a.drInfo.level])).toEqual([
      ["853", "Full"],
    ]);
  });
});
