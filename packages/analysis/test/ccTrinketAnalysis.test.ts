import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  analyzePlayerCCAndTrinket,
  bindBreakToWindow,
  findBrokenCC,
  ICCBreakableWindow,
  ICCInstance,
  TRINKET_BREAK_TOLERANCE_MS,
} from "../src/utils/ccTrinketAnalysis";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

describe("bindBreakToWindow and findBrokenCC", () => {
  describe("bindBreakToWindow", () => {
    it("exports TRINKET_BREAK_TOLERANCE_MS as 250", () => {
      expect(TRINKET_BREAK_TOLERANCE_MS).toBe(250);
    });

    it("binds a break cast within the active window", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      const bound = bindBreakToWindow([window], 12_000);
      expect(bound).toBe(window);
    });

    it("binds a break cast within ±250ms of the active window boundaries", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      // 200ms before apply
      expect(bindBreakToWindow([window], 9_800)).toBe(window);
      // 200ms after remove
      expect(bindBreakToWindow([window], 16_200)).toBe(window);
    });

    it("binds to the window with the longest duration when multiple windows overlap", () => {
      const shortWindow: ICCBreakableWindow = { applyMs: 10_000, removeMs: 13_000 }; // 3s
      const longWindow: ICCBreakableWindow = { applyMs: 10_500, removeMs: 16_500 }; // 6s
      const mediumWindow: ICCBreakableWindow = { applyMs: 9_000, removeMs: 14_000 }; // 5s

      // Cast at 11_000 when all three are active
      const bound = bindBreakToWindow([shortWindow, longWindow, mediumWindow], 11_000);
      expect(bound).toBe(longWindow);
    });

    it("returns undefined when cast is outside ±250ms tolerance", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      // Well before apply
      expect(bindBreakToWindow([window], 9_000)).toBeUndefined();
      // Well after remove
      expect(bindBreakToWindow([window], 17_000)).toBeUndefined();
    });

    it("matches exactly at the 250ms tolerance boundary, but not at 251ms", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };

      // Exactly at -250ms (9_750ms) -> matches
      expect(bindBreakToWindow([window], 9_750)).toBe(window);
      // At -251ms (9_749ms) -> undefined
      expect(bindBreakToWindow([window], 9_749)).toBeUndefined();

      // Exactly at +250ms (16_250ms) -> matches
      expect(bindBreakToWindow([window], 16_250)).toBe(window);
      // At +251ms (16_251ms) -> undefined
      expect(bindBreakToWindow([window], 16_251)).toBeUndefined();
    });
  });

  describe("findBrokenCC", () => {
    const makeCC = (atSeconds: number, durationSeconds: number, spellName: string): ICCInstance => ({
      atSeconds,
      durationSeconds,
      spellId: "118",
      spellName,
      sourceName: "Mage",
      sourceId: "Player-1",
      sourceSpec: "Frost Mage",
      damageTakenDuring: 0,
      trinketState: "used",
      drInfo: null,
      distanceYards: null,
      losBlocked: null,
    });

    it("finds the broken CC instance matching the cast timestamp", () => {
      const matchStartMs = 1_000_000;
      const cc1 = makeCC(10.0, 6.0, "Polymorph"); // 10_000ms to 16_000ms from matchStart
      const cc2 = makeCC(25.0, 4.0, "Kidney Shot"); // 25_000ms to 29_000ms from matchStart

      // Cast at matchStartMs + 12_000ms
      const broken = findBrokenCC([cc1, cc2], matchStartMs, matchStartMs + 12_000);
      expect(broken).toBe(cc1);

      // Cast outside any CC
      const none = findBrokenCC([cc1, cc2], matchStartMs, matchStartMs + 20_000);
      expect(none).toBeUndefined();
    });

    it("picks the longest duration CC when multiple instances overlap at cast time", () => {
      const matchStartMs = 1_000_000;
      const shortCC = makeCC(10.0, 3.0, "Cheap Shot"); // 10s to 13s
      const longCC = makeCC(10.5, 6.0, "Blind"); // 10.5s to 16.5s

      const broken = findBrokenCC([shortCC, longCC], matchStartMs, matchStartMs + 11_000);
      expect(broken).toBe(longCC);
    });
  });
});

describe("analyzePlayerCCAndTrinket — structured data contract (N4)", () => {
  const MATCH_START = 1_000_000;
  const MATCH_END = 1_300_000;

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  function makeCombat() {
    return {
      startTime: MATCH_START,
      endTime: MATCH_END,
      startInfo: { zoneId: "1672" },
    };
  }

  it("populates ICCInstance structured fields with exact properties and null coordinates", () => {
    const enemy1 = makeUnit("enemy-1", {
      name: "EnemyMage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
    });
    // Another enemy with the SAME name to verify attribution binds to GUID/ID
    const enemy2 = makeUnit("enemy-2", {
      name: "EnemyMage",
      spec: CombatUnitSpec.Mage_Fire,
      reaction: CombatUnitReaction.Hostile,
    });

    const applyAura = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "118",
      MATCH_START + 10_000,
      "enemy-1",
      "player-1",
    );
    applyAura.srcUnitName = "EnemyMage";

    const removeAura = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "118",
      MATCH_START + 16_000,
      "enemy-1",
      "player-1",
    );
    removeAura.srcUnitName = "EnemyMage";

    const player = makeUnit("player-1", {
      name: "PlayerWarrior",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [applyAura, removeAura],
      damageIn: [
        // Damage within CC window
        makeDamageEvent(MATCH_START + 11_000, 15_000, "player-1"),
        makeDamageEvent(MATCH_START + 13_000, 25_000, "player-1"),
        // Damage outside CC window (before and after)
        makeDamageEvent(MATCH_START + 5_000, 50_000, "player-1"),
        makeDamageEvent(MATCH_START + 17_000, 50_000, "player-1"),
      ],
    });

    const result = analyzePlayerCCAndTrinket(player, [enemy1, enemy2], makeCombat());

    expect(result.ccInstances).toHaveLength(1);
    expect(result.ccInstances[0]).toEqual({
      atSeconds: 10,
      durationSeconds: 6,
      spellId: "118",
      spellName: "Polymorph",
      sourceName: "EnemyMage",
      sourceId: "enemy-1",
      sourceSpec: "Frost Mage",
      damageTakenDuring: 40_000,
      trinketState: "available_unused",
      trinketCDSecondsLeft: undefined,
      drInfo: {
        category: "Incapacitate",
        level: "Full",
        sequenceIndex: 0,
      },
      distanceYards: null,
      losBlocked: null,
    });
    expect(result.ccAvoidedInstances).toHaveLength(0);
    expect(result.interruptInstances).toHaveLength(0);
    expect(result.rootInstances).toHaveLength(0);
    expect(result.disarmInstances).toHaveLength(0);
    expect(result.missedTrinketWindows).toHaveLength(1);
    expect(result.missedTrinketWindows[0]).toBe(result.ccInstances[0]);
  });

  it("distinguishes racial_break from used and populates breakRacialName", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyRogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
    });

    // Human player breaks stun with Will to Survive (59752)
    const racialPlayer = makeUnit("player-1", {
      name: "PlayerHuman",
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "853", // Hammer of Justice (stun)
          MATCH_START + 20_000,
          "enemy-1",
          "player-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "853",
          MATCH_START + 20_800,
          "enemy-1",
          "player-1",
        ),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "59752",
          MATCH_START + 20_800,
          "player-1",
          "PlayerHuman",
          "player-1",
          "PlayerHuman",
          0,
          "Will to Survive",
        ),
      ],
    });

    const racialResult = analyzePlayerCCAndTrinket(racialPlayer, [enemy], makeCombat());
    expect(racialResult.ccInstances).toHaveLength(1);
    expect(racialResult.ccInstances[0].trinketState).toBe("racial_break");
    expect(racialResult.ccInstances[0].breakRacialName).toBe("Will to Survive");

    // Standard PvP trinket break (336126)
    const trinketPlayer = makeUnit("player-2", {
      name: "PlayerOrc",
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "853",
          MATCH_START + 30_000,
          "enemy-1",
          "player-2",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "853",
          MATCH_START + 30_500,
          "enemy-1",
          "player-2",
        ),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "336126",
          MATCH_START + 30_500,
          "player-2",
          "PlayerOrc",
          "player-2",
          "PlayerOrc",
          0,
          "Gladiator's Medallion",
        ),
      ],
    });

    const trinketResult = analyzePlayerCCAndTrinket(trinketPlayer, [enemy], makeCombat());
    expect(trinketResult.ccInstances).toHaveLength(1);
    expect(trinketResult.ccInstances[0].trinketState).toBe("used");
    expect(trinketResult.ccInstances[0].breakRacialName).toBeUndefined();
  });

  it("populates ICCAvoidedInstance structured fields including avoidance spell and source", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyMage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          "118", // Polymorph
          MATCH_START + 15_200,
          "player-1",
          "PlayerPriest",
          "enemy-1",
          "EnemyMage",
          0,
          "Polymorph",
        ),
      ],
    });

    // Player Priest uses Phase Shift (408558) right as Polymorph lands
    const player = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "408558", // Phase Shift
          MATCH_START + 15_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "408558",
          MATCH_START + 16_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0]).toEqual({
      atSeconds: 15.2,
      spellId: "118",
      spellName: "Polymorph",
      avoidanceSpellName: "Phase Shift",
      avoidanceSpellId: "408558",
      // GH #103 A6: who applied the avoidance aura (fixture srcUnitName)
      avoidanceSourceName: "Source",
      sourceName: "EnemyMage",
      sourceId: "enemy-1",
      sourceSpec: "Frost Mage",
    });
  });

  it("populates IInterruptInstance structured fields, distinguishing switchWasHardCast null vs false", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyRogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
    });

    // Case A: Interrupted with NO subsequent spell cast -> switchWasHardCast is null
    const playerNoSwitch = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "1766",
          "Kick",
          "2061",
          "Flash Heal",
          MATCH_START + 10_000,
          "enemy-1",
          "EnemyRogue",
        ),
      ],
    });

    const resNoSwitch = analyzePlayerCCAndTrinket(playerNoSwitch, [enemy], makeCombat());
    expect(resNoSwitch.interruptInstances).toHaveLength(1);
    expect(resNoSwitch.interruptInstances[0]).toEqual({
      atSeconds: 10,
      kickSpellId: "1766",
      kickSpellName: "Kick",
      sourceName: "EnemyRogue",
      sourceId: "enemy-1",
      sourceSpec: "Subtlety Rogue",
      interruptedSpellId: "2061",
      interruptedSpellName: "Flash Heal",
      lockoutDurationSeconds: 3,
      postKick: "idle",
      kickDepthPct: null,
      kickersInRange: null,
      nearestKickerDistYd: null,
      firstActionDelayS: null,
      switchDelayS: null,
      switchSpellName: null,
      switchWasHardCast: null,
    });

    // Case B: Interrupted on Holy (2060 Heal) followed by instant Shadow (589 Shadow Word: Pain)
    // with castStartEvents present -> switchWasHardCast is false, postKick is "switched"
    const playerInstantSwitch = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "1766",
          "Kick",
          "2061",
          "Flash Heal",
          MATCH_START + 20_000,
          "enemy-1",
          "EnemyRogue",
        ),
      ],
      castStartEvents: [
        // Dummy cast start for a different spell so haveCastStarts is true
        {
          logLine: {
            event: LogEvent.SPELL_CAST_START,
            timestamp: MATCH_START + 5_000,
            parameters: [],
          },
          spellId: "2060",
        } as any,
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "589",
          MATCH_START + 21_000,
          "enemy-1",
          "EnemyRogue",
          "player-1",
          "PlayerPriest",
          0,
          "Shadow Word: Pain",
        ),
      ],
    });

    const resInstantSwitch = analyzePlayerCCAndTrinket(playerInstantSwitch, [enemy], makeCombat());
    expect(resInstantSwitch.interruptInstances).toHaveLength(1);
    expect(resInstantSwitch.interruptInstances[0].switchSpellName).toBe("Shadow Word: Pain");
    expect(resInstantSwitch.interruptInstances[0].switchDelayS).toBe(1);
    expect(resInstantSwitch.interruptInstances[0].switchWasHardCast).toBe(false);
    expect(resInstantSwitch.interruptInstances[0].postKick).toBe("switched");
  });
});
