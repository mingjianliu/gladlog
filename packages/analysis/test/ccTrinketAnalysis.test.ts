import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AURA_KEYED_BREAK_RACIALS,
  breakRemovesCc,
  CC_BREAK_CAST_IDS,
  ccBreakAbilityName,
  CLASS_CC_BREAK_ABILITIES,
} from "../src/data/ccBreakAbilities";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  BREAK_RACIAL_SPELL_IDS,
  RACIAL_ABILITIES,
} from "../src/data/racialAbilities";
import { ccFullDurationSeconds } from "../src/data/spellEffectData";
import {
  analyzePlayerCCAndTrinket,
  bindBreakToWindow,
  breakAbilityPresses,
  castEndedCcWindow,
  findBrokenCC,
  ICCBreakableWindow,
  ICCInstance,
  TRINKET_BREAK_TOLERANCE_MS,
} from "../src/utils/ccTrinketAnalysis";
import { mechanicsBrokenBy } from "../src/utils/spellMechanics";
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

    it("binds a break cast up to 250 ms before the apply and up to 50 ms after the removal (trinketBreakOrderScan 2026-09-26)", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      // 200ms before apply
      expect(bindBreakToWindow([window], 9_800)).toBe(window);
      // 40ms after remove — the trinket's own removal lands within ±25 ms
      expect(bindBreakToWindow([window], 16_040)).toBe(window);
      // 200ms after remove — the CC had already ended some other way (dece)
      expect(bindBreakToWindow([window], 16_200)).toBeUndefined();
    });

    it("binds to the window with the longest duration when multiple windows overlap", () => {
      const shortWindow: ICCBreakableWindow = {
        applyMs: 10_000,
        removeMs: 13_000,
      }; // 3s
      const longWindow: ICCBreakableWindow = {
        applyMs: 10_500,
        removeMs: 16_500,
      }; // 6s
      const mediumWindow: ICCBreakableWindow = {
        applyMs: 9_000,
        removeMs: 14_000,
      }; // 5s

      // Cast at 11_000 when all three are active
      const bound = bindBreakToWindow(
        [shortWindow, longWindow, mediumWindow],
        11_000,
      );
      expect(bound).toBe(longWindow);
    });

    // Triage 2026-09-29, enemy-def F-E15: with official ends on the windows,
    // the break belongs to the CC with the most official time left.
    it("binds to the window with the most official time left, not the longest-active one (bd790c92 1:38)", () => {
      // Leg Sweep 94.901 (4 s official, 0.09 s left at the 98.813 trinket);
      // Cyclone 97.976 (5 s official, 4.16 s left). Both removed by the trinket.
      const legSweep: ICCBreakableWindow = {
        applyMs: 94_901,
        removeMs: 98_812,
        officialEndMs: 98_901,
      };
      const cyclone: ICCBreakableWindow = {
        applyMs: 97_976,
        removeMs: 98_812,
        officialEndMs: 102_976,
      };
      expect(bindBreakToWindow([legSweep, cyclone], 98_813)).toBe(cyclone);
      expect(bindBreakToWindow([cyclone, legSweep], 98_813)).toBe(cyclone);
    });

    it("the DR-shortened length decides: a 50 % DR Psychic Scream (3 s) loses to a full Dragon's Breath with more left", () => {
      // Dragon's Breath 22.0 (4 s at Full DR → ends 26.0); Psychic Scream 22.5
      // at 50 % DR (6 s × 0.5 → ends 25.5). Trinket at 24.4: 1.6 s vs 1.1 s left.
      const breath: ICCBreakableWindow = {
        applyMs: 22_000,
        removeMs: 24_400,
        officialEndMs: 26_000,
      };
      const scream: ICCBreakableWindow = {
        applyMs: 22_500,
        removeMs: 24_400,
        officialEndMs: 25_500,
      };
      expect(bindBreakToWindow([breath, scream], 24_400)).toBe(breath);
    });

    it("a CC with no official duration counts as 0 s left: it wins only when no known-length CC had time left (24b6a229 0:43)", () => {
      // Maim scales with combo points → no official end; Cyclone had 4.55 s left.
      const maim: ICCBreakableWindow = { applyMs: 38_799, removeMs: 43_803 };
      const cyclone: ICCBreakableWindow = {
        applyMs: 43_358,
        removeMs: 43_803,
        officialEndMs: 48_358,
      };
      expect(bindBreakToWindow([maim, cyclone], 43_803)).toBe(cyclone);
      // a known-length CC that had already run out ties at 0 → the longer
      // observed window wins, the pre-F-E15 rule
      const expired: ICCBreakableWindow = {
        applyMs: 41_000,
        removeMs: 43_803,
        officialEndMs: 43_000,
      };
      expect(bindBreakToWindow([maim, expired], 43_803)).toBe(maim);
    });

    // 7a24f4b3 0:59: the trinket ends a Kidney Shot and a Cheap Shot lands
    // 173 ms later. The Cheap Shot is "active at the cast" (the 250 ms
    // tolerance) with all of its official time left — and is not what the
    // trinket broke.
    it("a CC that ended at the cast beats one that landed just after it, whatever its time left", () => {
      const kidney: ICCBreakableWindow = {
        applyMs: 56_000,
        removeMs: 59_000,
        officialEndMs: 62_000,
      };
      const cheapShot: ICCBreakableWindow = {
        applyMs: 59_173,
        removeMs: 61_335,
        officialEndMs: 63_173,
      };
      expect(bindBreakToWindow([kidney, cheapShot], 59_000)).toBe(kidney);
      expect(bindBreakToWindow([cheapShot, kidney], 59_000)).toBe(kidney);
      expect(castEndedCcWindow(kidney, 59_000)).toBe(true);
      expect(castEndedCcWindow(cheapShot, 59_000)).toBe(false);
      // nothing ended at the cast → the ranking alone, as before
      expect(bindBreakToWindow([cheapShot], 59_000)).toBe(cheapShot);
    });

    // Review finding: the 10–50 ms band. A Maim removed 30 ms before the press
    // is inside the binder's own after-removal tolerance but outside the
    // 10 ms "ended at the cast" lag, and has no official length (0 s left).
    // It was on the unit; the Cheap Shot that lands 100 ms AFTER the press
    // was not — and must not take the label on its 4 s of official time.
    it("a CC that was on the unit at the cast beats one that landed after it, even with no time left", () => {
      const maim: ICCBreakableWindow = { applyMs: 55_000, removeMs: 58_970 };
      const lateCheapShot: ICCBreakableWindow = {
        applyMs: 59_100,
        removeMs: 61_300,
        officialEndMs: 63_100,
      };
      expect(castEndedCcWindow(maim, 59_000)).toBe(false);
      expect(bindBreakToWindow([maim, lateCheapShot], 59_000)).toBe(maim);
      expect(bindBreakToWindow([lateCheapShot, maim], 59_000)).toBe(maim);
    });

    it("returns undefined when cast is outside ±250ms tolerance", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      // Well before apply
      expect(bindBreakToWindow([window], 9_000)).toBeUndefined();
      // Well after remove
      expect(bindBreakToWindow([window], 17_000)).toBeUndefined();
    });

    it("matches exactly at the 250 ms before-apply boundary (not 251), and at 50 ms after the removal (not 51)", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };

      // Exactly at -250ms (9_750ms) -> matches
      expect(bindBreakToWindow([window], 9_750)).toBe(window);
      // At -251ms (9_749ms) -> undefined
      expect(bindBreakToWindow([window], 9_749)).toBeUndefined();

      // After the removal the bound is 50 ms (TRINKET_BREAK_AFTER_REMOVAL_MS)
      expect(bindBreakToWindow([window], 16_050)).toBe(window);
      expect(bindBreakToWindow([window], 16_051)).toBeUndefined();
    });
  });

  describe("findBrokenCC", () => {
    const makeCC = (
      atSeconds: number,
      durationSeconds: number,
      spellName: string,
    ): ICCInstance => ({
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
      const broken = findBrokenCC(
        [cc1, cc2],
        matchStartMs,
        matchStartMs + 12_000,
      );
      expect(broken).toBe(cc1);

      // Cast outside any CC
      const none = findBrokenCC(
        [cc1, cc2],
        matchStartMs,
        matchStartMs + 20_000,
      );
      expect(none).toBeUndefined();
    });

    it("with official durations on the instances, names the CC with the most time left (F-E15, 0777a8e0 0:51)", () => {
      const matchStartMs = 1_000_000;
      // Hammer of Justice 46.943 (5 s official → 0.13 s left at 51.814);
      // Psychic Scream 49.679 (6 s official → 3.87 s left). The trinket ends both.
      const hoj = {
        ...makeCC(46.943, 4.868, "Hammer of Justice"),
        expectedDurationSeconds: 5,
      };
      const scream = {
        ...makeCC(49.679, 2.132, "Psychic Scream"),
        expectedDurationSeconds: 6,
      };
      expect(
        findBrokenCC([hoj, scream], matchStartMs, matchStartMs + 51_814),
      ).toBe(scream);
    });

    it("picks the longest duration CC when multiple instances overlap at cast time", () => {
      const matchStartMs = 1_000_000;
      const shortCC = makeCC(10.0, 3.0, "Cheap Shot"); // 10s to 13s
      const longCC = makeCC(10.5, 6.0, "Blind"); // 10.5s to 16.5s

      const broken = findBrokenCC(
        [shortCC, longCC],
        matchStartMs,
        matchStartMs + 11_000,
      );
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

    const result = analyzePlayerCCAndTrinket(
      player,
      [enemy1, enemy2],
      makeCombat(),
    );

    expect(result.ccInstances).toHaveLength(1);
    expect(result.ccInstances[0]).toEqual({
      atSeconds: 10,
      durationSeconds: 6,
      // the official PvP length of Polymorph at Full DR (F-E15: what the
      // break binder ranks "time left" by)
      expectedDurationSeconds: ccFullDurationSeconds("118"),
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

    const racialResult = analyzePlayerCCAndTrinket(
      racialPlayer,
      [enemy],
      makeCombat(),
    );
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

    const trinketResult = analyzePlayerCCAndTrinket(
      trinketPlayer,
      [enemy],
      makeCombat(),
    );
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

    const resNoSwitch = analyzePlayerCCAndTrinket(
      playerNoSwitch,
      [enemy],
      makeCombat(),
    );
    expect(resNoSwitch.interruptInstances).toHaveLength(1);
    expect(resNoSwitch.interruptInstances[0]).toEqual({
      atSeconds: 10,
      castStartS: null,
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
      channelS: null,
      kickersInRange: null,
      kickImmunityEnded: null,
      maxKickRangeYd: null,
      maxKickRangeSlackYd: null,
      maxKickRangeLateYd: null,
      nearestKickerDistYd: null,
      nearestKickerName: null,
      ownerImmobileBy: null,
      sourceDistYd: null,
      sourceGapCloser: null,
      sourceKickReadyInS: null,
      firstActionDelayS: null,
      lockEndedBySuccessS: null,
      switchDelayS: null,
      switchSpellName: null,
      switchWasEmpowered: null,
      switchWasHardCast: null,
      ccInWindowS: 0,
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

    const resInstantSwitch = analyzePlayerCCAndTrinket(
      playerInstantSwitch,
      [enemy],
      makeCombat(),
    );
    expect(resInstantSwitch.interruptInstances).toHaveLength(1);
    expect(resInstantSwitch.interruptInstances[0].switchSpellName).toBe(
      "Shadow Word: Pain",
    );
    expect(resInstantSwitch.interruptInstances[0].switchDelayS).toBe(1);
    expect(resInstantSwitch.interruptInstances[0].switchWasHardCast).toBe(
      false,
    );
    expect(resInstantSwitch.interruptInstances[0].postKick).toBe("switched");
  });

  // Triage 2026-09-29 kick-eaten F-K5a / F-K5b / F-K5d / F-K6d.
  describe("kicker facts at the kicked cast's start", () => {
    const CAST_START = MATCH_START + 18_500;
    const KICK_AT = MATCH_START + 20_000;
    const pos = (x: number, y: number) =>
      [
        {
          timestamp: CAST_START,
          advancedActorPositionX: x,
          advancedActorPositionY: y,
        },
      ] as any;
    const castStart = [
      {
        spellId: "116",
        logLine: { event: LogEvent.SPELL_CAST_START, timestamp: CAST_START },
      },
    ] as any;
    const aura = (
      event: LogEvent,
      spellId: string,
      atMs: number,
      src: string,
      dest: string,
    ) => ({
      ...makeAuraEvent(event, spellId, atMs, src, dest),
      spellName: spellId,
    });
    /** Owner hard-casting Frostbolt from 18.5 s, kicked at 20 s by the Rogue
     * (5 yd away, Kick 5 yd); a Warrior with Pummel stands 2 yd away. */
    const scene = (o: {
      ownerAuras?: any[];
      ownerActionIn?: any[];
      rogueCasts?: any[];
      warriorAuras?: any[];
      warriorActionIn?: any[];
      warriorCasts?: any[];
      /** the second enemy as a Mage (Counterspell, a silenceable kick) */
      secondIsMage?: boolean;
      /** where the second enemy stands (default 2 yd away) */
      secondPos?: [number, number];
    }) => {
      const owner = makeUnit("player-1", {
        actionIn: [
          makeInterruptEvent(
            "1766",
            "Kick",
            "116",
            "Frostbolt",
            KICK_AT,
            "enemy-1",
            "Rogue",
          ),
          ...(o.ownerActionIn ?? []),
        ],
        castStartEvents: castStart,
        advancedActions: pos(0, 0),
        auraEvents: o.ownerAuras ?? [],
      });
      const rogue = makeUnit("enemy-1", {
        name: "Rogue",
        reaction: CombatUnitReaction.Hostile,
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Assassination,
        advancedActions: pos(3, 4),
        spellCastEvents: o.rogueCasts ?? [],
      });
      const warrior = makeUnit("enemy-2", {
        name: "Warrior",
        reaction: CombatUnitReaction.Hostile,
        class: o.secondIsMage ? CombatUnitClass.Mage : CombatUnitClass.Warrior,
        spec: o.secondIsMage
          ? CombatUnitSpec.Mage_Frost
          : CombatUnitSpec.Warrior_Arms,
        advancedActions: pos(...(o.secondPos ?? [0, 2])),
        auraEvents: o.warriorAuras ?? [],
        actionIn: o.warriorActionIn ?? [],
        spellCastEvents: o.warriorCasts ?? [],
      });
      return analyzePlayerCCAndTrinket(
        owner,
        [rogue, warrior],
        makeCombat(),
      ).interruptInstances.find((i) => i.atSeconds === 20)!;
    };

    it("the source's own distance is a fact of its own; the nearest ready kicker is named (F-K5a)", () => {
      const k = scene({});
      expect(k.sourceDistYd).toBe(5);
      expect(k.nearestKickerDistYd).toBe(2);
      expect(k.nearestKickerName).toBe("Warrior");
      expect(k.kickersInRange).toBe(2);
      expect(k.maxKickRangeYd).toBe(5);
    });

    it("a kicker stunned at cast start is neither counted nor the nearest (F-K5d, 3306e8ee @18.4)", () => {
      const k = scene({
        warriorAuras: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            "853",
            MATCH_START + 18_000,
            "friend-1",
            "enemy-2",
          ),
          aura(
            LogEvent.SPELL_AURA_REMOVED,
            "853",
            MATCH_START + 19_500,
            "friend-1",
            "enemy-2",
          ),
        ],
      });
      expect(k.kickersInRange).toBe(1);
      expect(k.nearestKickerDistYd).toBe(5);
      expect(k.nearestKickerName).toBe("Rogue");
    });

    it("a silence stops a silenceable kick only: a silenced Warrior still has Pummel, a silenced Mage has no Counterspell (6062daf2 @32.7)", () => {
      const silence = [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "1330",
          MATCH_START + 18_000,
          "friend-1",
          "enemy-2",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "1330",
          MATCH_START + 19_500,
          "friend-1",
          "enemy-2",
        ),
      ];
      const melee = scene({ warriorAuras: silence });
      expect(melee.kickersInRange).toBe(2);
      expect(melee.nearestKickerName).toBe("Warrior");
      const caster = scene({ warriorAuras: silence, secondIsMage: true });
      expect(caster.kickersInRange).toBe(1);
      expect(caster.nearestKickerName).toBe("Rogue");
      // and unsilenced, the Mage counts
      expect(scene({ secondIsMage: true }).kickersInRange).toBe(2);
    });

    it("a kicker under a school lockout is still a kicker — only auras count (codex fixture: fa5e6c66's Frost-locked Mage)", () => {
      const k = scene({
        warriorActionIn: [
          {
            ...makeInterruptEvent(
              "2139",
              "Counterspell",
              "116",
              "Frostbolt",
              MATCH_START + 17_500,
              "friend-1",
              "Friend",
            ),
            destUnitId: "enemy-2",
          },
        ],
      });
      expect(k.kickersInRange).toBe(2);
      expect(k.nearestKickerName).toBe("Warrior");
    });

    it("the source's kick still on cooldown at cast start: not a ready kicker, and `sourceKickReadyInS` says when it came back (F-K5b, 1bad0a5c @27.4)", () => {
      // Kick (15 s) cast at 5 s → back at 20.0 s, the instant it landed
      const k = scene({
        rogueCasts: [
          makeSpellCastEvent(
            "1766",
            MATCH_START + 5_000,
            "player-1",
            "Owner",
            "enemy-1",
            "Rogue",
            0,
            "Kick",
          ),
        ],
      });
      expect(k.sourceKickReadyInS).toBeCloseTo(1.5, 5);
      expect(k.sourceDistYd).toBe(5); // the source's distance does not depend on readiness
      expect(k.kickersInRange).toBe(1); // only the Warrior
      expect(k.nearestKickerName).toBe("Warrior");
    });

    it("a modelled cooldown that would end after the kick landed is not claimed", () => {
      // Kick cast at 10 s → the 15 s model says 25 s, but it landed at 20 s
      const k = scene({
        rogueCasts: [
          makeSpellCastEvent(
            "1766",
            MATCH_START + 10_000,
            "player-1",
            "Owner",
            "enemy-1",
            "Rogue",
            0,
            "Kick",
          ),
        ],
      });
      expect(k.sourceKickReadyInS).toBeNull();
    });

    it("the owner rooted at cast start is immobile (F-K6d, 9c9d8601 @63.9)", () => {
      const k = scene({
        ownerAuras: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            "339",
            MATCH_START + 17_000,
            "enemy-1",
            "player-1",
          ),
          aura(
            LogEvent.SPELL_AURA_REMOVED,
            "339",
            MATCH_START + 19_000,
            "enemy-1",
            "player-1",
          ),
        ],
      });
      expect(k.ownerImmobileBy).toBe("Entangling Roots");
    });

    it("the owner's roots are the shared predicate (`rootIntervalsOf`): an Ice Nova or the 12.x Entangling Roots id holds like the old one (pre-review: this file's own root list lacks them)", () => {
      for (const [id, name] of [
        ["157997", "Ice Nova"],
        ["1287975", "Entangling Roots"],
      ]) {
        const k = scene({
          ownerAuras: [
            aura(
              LogEvent.SPELL_AURA_APPLIED,
              id!,
              MATCH_START + 17_000,
              "enemy-1",
              "player-1",
            ),
            aura(
              LogEvent.SPELL_AURA_REMOVED,
              id!,
              MATCH_START + 19_500,
              "enemy-1",
              "player-1",
            ),
          ],
        });
        expect(k.ownerImmobileBy).toBe(name);
      }
    });

    it("a kick-lockout aura on a kicker is not hard CC: a Warrior under Shambling Rush 91807 is still a kicker (pre-review)", () => {
      const k = scene({
        warriorAuras: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            "91807",
            MATCH_START + 18_000,
            "friend-1",
            "enemy-2",
          ),
          aura(
            LogEvent.SPELL_AURA_REMOVED,
            "91807",
            MATCH_START + 19_500,
            "friend-1",
            "enemy-2",
          ),
        ],
      });
      expect(k.kickersInRange).toBe(2);
      expect(k.nearestKickerName).toBe("Warrior");
    });

    it("the source's gap-closer is read over the whole cast: a Shadowstep pressed between the cast's start and the Kick closes (pre-review)", () => {
      const k = scene({
        rogueCasts: [
          makeSpellCastEvent(
            "36554",
            MATCH_START + 19_200,
            "enemy-1",
            "Rogue",
            "player-1",
            "Owner",
            0,
            "Shadowstep",
          ),
        ],
      });
      expect(k.sourceGapCloser).toMatchObject({
        state: "used-during",
        spellName: "Shadowstep",
      });
      expect(
        k.sourceGapCloser?.state === "used-during"
          ? k.sourceGapCloser.afterS
          : NaN,
      ).toBeCloseTo(0.7, 3);
      // and nothing when the source cast no gap-closer this round
      expect(scene({}).sourceGapCloser).toBeNull();
    });

    it("`maxKickRangeSlackYd` counts a second kicker just past its nominal range, `maxKickRangeYd` and `kickersInRange` do not (pre-review: condition 4 had no hitbox slack)", () => {
      const past = scene({ secondIsMage: true, secondPos: [0, 41.5] });
      expect(past.kickersInRange).toBe(1); // only the Rogue, at 5 yd
      expect(past.maxKickRangeYd).toBe(5);
      expect(past.maxKickRangeSlackYd).toBe(40);
      const far = scene({ secondIsMage: true, secondPos: [0, 43] });
      expect(far.maxKickRangeSlackYd).toBe(5);
    });

    it("`maxKickRangeLateYd`: another kicker whose kick came back between the cast's start and this kick is not 'ready at cast start', and the verdict still hears of it (Fable review)", () => {
      const pummel = (atS: number) =>
        makeSpellCastEvent(
          "6552",
          MATCH_START + atS * 1000,
          "player-1",
          "Owner",
          "enemy-2",
          "Warrior",
          0,
          "Pummel",
        );
      // Pummel (15 s) pressed at 4 s → back at 19 s; the cast ran 18.5 → 20
      const back = scene({ warriorCasts: [pummel(4)] });
      expect(back.kickersInRange).toBe(1); // the Rogue only
      expect(back.nearestKickerName).toBe("Rogue");
      expect(back.maxKickRangeLateYd).toBe(5);
      // back only after the kick landed: not a kicker of this cast
      expect(
        scene({ warriorCasts: [pummel(6)] }).maxKickRangeLateYd,
      ).toBeNull();
      // back in time but beyond its range and the hitbox slack
      expect(
        scene({ warriorCasts: [pummel(4)], secondPos: [0, 9] })
          .maxKickRangeLateYd,
      ).toBeNull();
      // ready at cast start: the cast-start facts carry it, not this one
      expect(scene({}).maxKickRangeLateYd).toBeNull();
      // stunned at cast start (18.5 s) but free when the Pummel came back
      // (19 s): still a kicker of this cast
      const stun = (fromS: number, toS: number) => [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "853",
          MATCH_START + fromS * 1000,
          "friend-1",
          "enemy-2",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "853",
          MATCH_START + toS * 1000,
          "friend-1",
          "enemy-2",
        ),
      ];
      expect(
        scene({ warriorCasts: [pummel(4)], warriorAuras: stun(18, 18.8) })
          .maxKickRangeLateYd,
      ).toBe(5);
      // held from before the Pummel came back until after the kick landed
      expect(
        scene({ warriorCasts: [pummel(4)], warriorAuras: stun(18, 20.5) })
          .maxKickRangeLateYd,
      ).toBeNull();
    });

    it("a silence or a school lockout on the owner does not stop movement (codex fixture)", () => {
      const silenced = scene({
        ownerAuras: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            "15487",
            MATCH_START + 17_000,
            "enemy-1",
            "player-1",
          ),
          aura(
            LogEvent.SPELL_AURA_REMOVED,
            "15487",
            MATCH_START + 19_000,
            "enemy-1",
            "player-1",
          ),
        ],
      });
      expect(silenced.ownerImmobileBy).toBeNull();
      const locked = scene({
        ownerActionIn: [
          makeInterruptEvent(
            "6552",
            "Pummel",
            "133",
            "Fireball",
            MATCH_START + 17_000,
            "enemy-2",
            "Warrior",
          ),
        ],
      });
      expect(locked.ownerImmobileBy).toBeNull();
    });
  });

  // Triage 2026-09-29 kick-eaten F-K13 / F-K14b.
  describe("empowered switch, immunity that ran out", () => {
    const enemy = makeUnit("enemy-1", {
      name: "Rogue",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Assassination,
    });
    const start = (spellId: string, s: number) =>
      ({
        spellId,
        logLine: {
          event: LogEvent.SPELL_CAST_START,
          timestamp: MATCH_START + s * 1000,
        },
      }) as any;
    const success = (spellId: string, s: number) =>
      makeSpellCastEvent(
        spellId,
        MATCH_START + s * 1000,
        "enemy-1",
        "Rogue",
        "player-1",
        "Owner",
      );
    const kickAt = (interrupted: string, s: number) =>
      makeInterruptEvent(
        "1766",
        "Kick",
        interrupted,
        interrupted,
        MATCH_START + s * 1000,
        "enemy-1",
        "Rogue",
      );

    it("a switching cast with a SPELL_EMPOWER_END after it is an empowered cast (F-K13, 02c8e3ac @33.9)", () => {
      // Disintegrate 356995 (Spellfrost) kicked; Fire Breath 357208 (Fire)
      // begins 2.4 s later — SUCCESS at the start of the hold, END at release
      const mk = (empowerEnds: any[] | undefined) =>
        analyzePlayerCCAndTrinket(
          {
            ...makeUnit("player-1", {
              actionIn: [kickAt("356995", 33.93)],
              castStartEvents: [start("356995", 33.0)],
              spellCastEvents: [success("357208", 36.333)],
            }),
            empowerEnds,
          } as any,
          [enemy],
          makeCombat(),
        ).interruptInstances[0]!;
      const empowered = mk([
        { spellId: "357208", timestamp: MATCH_START + 37_015, level: 1 },
      ]);
      expect(empowered.postKick).toBe("switched");
      expect(empowered.switchWasHardCast).toBe(false);
      expect(empowered.switchWasEmpowered).toBe(true);
      expect(mk([]).switchWasEmpowered).toBe(false);
      // an old archive carries no empower data: nothing is claimed
      expect(mk(undefined).switchWasEmpowered).toBeNull();
    });

    it("a cast begun under Obsidian Scales with Obsidian Mettle, the buff gone before the kick (F-K14b, 3306e8ee @40.3)", () => {
      const mk = (pvpTalents: string[], removedAtS: number) =>
        analyzePlayerCCAndTrinket(
          makeUnit("player-1", {
            info: { pvpTalents },
            actionIn: [kickAt("395160", 40.322)],
            castStartEvents: [start("395160", 39.286)],
            auraEvents: [
              makeAuraEvent(
                LogEvent.SPELL_AURA_APPLIED,
                "363916",
                MATCH_START + 25_614,
                "player-1",
                "player-1",
                "BUFF",
              ),
              makeAuraEvent(
                LogEvent.SPELL_AURA_REMOVED,
                "363916",
                MATCH_START + removedAtS * 1000,
                "player-1",
                "player-1",
                "BUFF",
              ),
            ],
          }),
          [enemy],
          makeCombat(),
        ).interruptInstances[0]!;
      const k = mk(["378444"], 39.444);
      expect(k.kickImmunityEnded?.auraName).toBe("Obsidian Scales");
      expect(k.kickImmunityEnded?.intoCastS).toBeCloseTo(0.158, 3);
      // without the PvP talent Obsidian Scales grants no interrupt immunity
      expect(mk([], 39.444).kickImmunityEnded).toBeNull();
      // the buff ended before the cast began: the cast never was immune
      expect(mk(["378444"], 39.0).kickImmunityEnded).toBeNull();
    });
  });

  // Triage 2026-09-29 kick-eaten F-K7b / F-K7a (rulings C5, A23).
  describe("post-kick school rule and the first-success cut", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyRogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
    });
    // Kick at 10 s on `interrupted`, then the owner's casts (id, seconds after
    // the kick); `auraRemovedAt` = a Stasis-ready aura removal (seconds after).
    const kicked = (
      interrupted: [string, string],
      casts: Array<[string, number]>,
      stasisRemovedAfterS?: number,
    ) => {
      const player = makeUnit("player-1", {
        name: "Owner",
        spec: CombatUnitSpec.Shaman_Restoration,
        reaction: CombatUnitReaction.Friendly,
        actionIn: [
          makeInterruptEvent(
            "1766",
            "Kick",
            interrupted[0],
            interrupted[1],
            MATCH_START + 10_000,
            "enemy-1",
            "EnemyRogue",
          ),
        ],
        spellCastEvents: casts.map(([id, dt]) =>
          makeSpellCastEvent(
            id,
            MATCH_START + 10_000 + dt * 1000,
            "player-1",
            "Owner",
            "player-1",
            "Owner",
            0,
            `spell-${id}`,
          ),
        ),
        auraEvents:
          stasisRemovedAfterS === undefined
            ? []
            : [
                {
                  logLine: {
                    event: LogEvent.SPELL_AURA_REMOVED,
                    timestamp:
                      MATCH_START + 10_000 + stasisRemovedAfterS * 1000,
                    parameters: [],
                  },
                  timestamp: MATCH_START + 10_000 + stasisRemovedAfterS * 1000,
                  spellId: "370562",
                  spellName: "Stasis",
                  srcUnitId: "player-1",
                  destUnitId: "player-1",
                } as any,
              ],
      });
      return analyzePlayerCCAndTrinket(player, [enemy], makeCombat())
        .interruptInstances[0]!;
    };

    it("a spell with one school outside the lock is a switch (Starsurge, Arcane + Nature, under a Nature lock)", () => {
      // Cyclone 33786 = Nature (8); Starsurge 78674 = Arcane + Nature (72)
      const k = kicked(["33786", "Cyclone"], [["78674", 0.8]]);
      expect(k.postKick).toBe("switched");
      expect(k.switchDelayS).toBeCloseTo(0.8, 5);
      // … and it does not end the lock: it was never locked
      expect(k.lockEndedBySuccessS).toBeNull();
    });

    it("a fully locked spell is not a switch; its success inside the lockout ends the lock for the text", () => {
      // Riptide 61295 = Nature, silenceable
      const k = kicked(["33786", "Cyclone"], [["61295", 1.0]]);
      expect(k.postKick).toBe("acted");
      expect(k.lockEndedBySuccessS).toBeCloseTo(1.0, 5);
      // the modelled lockout is untouched ([RES], CONSEQ, cannot-cast)
      expect(k.lockoutDurationSeconds).toBe(3);
    });

    it("a locked-school success at or after the modelled lockout end is not a cut", () => {
      const k = kicked(["33786", "Cyclone"], [["61295", 3.0]]);
      expect(k.lockEndedBySuccessS).toBeNull();
    });

    it("Demonic Circle: Teleport inside a Shadow lock does not prove the lock ended (FLAG, LOCK_IGNORING_CAST_IDS)", () => {
      // Fear 5782 = Shadow; Demonic Circle: Teleport 48020 = Shadow, silenceable
      const k = kicked(["5782", "Fear"], [["48020", 2.6]]);
      expect(k.postKick).toBe("acted");
      expect(k.lockEndedBySuccessS).toBeNull();
    });

    it("Holy Fire inside a Holy lock does not prove the lock ended, nor do the rows a passive writes (LOCK_IGNORING_CAST_IDS, forward check 2026-10-01)", () => {
      // Smite 585 = Holy; Holy Fire 14914 = Holy, silenceable — 50ebee26:
      // it went out at +0.14 while Smite stayed rejected to +2.77
      expect(
        kicked(["585", "Smite"], [["14914", 0.14]]).lockEndedBySuccessS,
      ).toBeNull();
      // Frostbolt 116 = Frost; Snowdrift 390171 / 389823 = Frost passive rows
      expect(
        kicked(["116", "Frostbolt"], [["390171", 0.4]]).lockEndedBySuccessS,
      ).toBeNull();
      expect(
        kicked(["116", "Frostbolt"], [["389823", 0.4]]).lockEndedBySuccessS,
      ).toBeNull();
      // Sanctified Ground 289655 = Holy passive row
      expect(
        kicked(["585", "Smite"], [["289655", 0.5]]).lockEndedBySuccessS,
      ).toBeNull();
      // control: another Holy press does cut (Flash Heal 2061)
      expect(
        kicked(["585", "Smite"], [["2061", 1.2]]).lockEndedBySuccessS,
      ).toBeCloseTo(1.2, 5);
    });

    it("a cast DB2 does not mark silenceable is not evidence (Shadowy Apparition has no SpellCategories row)", () => {
      const k = kicked(["5782", "Fear"], [["341263", 0.5]]);
      expect(k.lockEndedBySuccessS).toBeNull();
    });

    it("a Stasis replay is not a press: locked-school casts right after the ready aura's removal do not cut (141470d0 @198)", () => {
      // Verdant Embrace 360995 = Nature. Replays at +1.04 / +1.76 / +2.42 s,
      // the ready aura removed at +1.02 s.
      const replayed = kicked(
        ["33786", "Cyclone"],
        [
          ["360995", 1.04],
          ["360995", 1.76],
          ["360995", 2.42],
        ],
        1.02,
      );
      expect(replayed.lockEndedBySuccessS).toBeNull();
      // without the removal the same casts are presses
      const pressed = kicked(["33786", "Cyclone"], [["360995", 1.04]]);
      expect(pressed.lockEndedBySuccessS).toBeCloseTo(1.04, 5);
    });
  });

  it("A3 (2026-09-25): a PvP trinket pressed in the post-kick window is a CC break, not 'acting on another school'; ccInWindowS counts the CC", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyRogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
    });
    const poly = (event: LogEvent, t: number) => {
      const a = makeAuraEvent(
        event,
        "118",
        MATCH_START + t,
        "enemy-1",
        "player-1",
      );
      a.srcUnitName = "EnemyRogue";
      return a;
    };
    const player = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "1766",
          "Kick",
          "2061",
          "Flash Heal",
          MATCH_START + 30_000,
          "enemy-1",
          "EnemyRogue",
        ),
      ],
      auraEvents: [
        poly(LogEvent.SPELL_AURA_APPLIED, 31_000),
        poly(LogEvent.SPELL_AURA_REMOVED, 33_000),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "336126",
          MATCH_START + 31_500,
          "player-1",
          "PlayerPriest",
          "player-1",
          "PlayerPriest",
          0,
          "Gladiator's Medallion",
        ),
        makeSpellCastEvent(
          "589",
          MATCH_START + 34_000,
          "enemy-1",
          "EnemyRogue",
          "player-1",
          "PlayerPriest",
          0,
          "Shadow Word: Pain",
        ),
      ],
    });
    const inst = analyzePlayerCCAndTrinket(player, [enemy], makeCombat())
      .interruptInstances[0]!;
    expect(inst.switchSpellName).toBe("Shadow Word: Pain");
    expect(inst.firstActionDelayS).toBe(4);
    expect(inst.ccInWindowS).toBe(2);
  });

  it("GH #108: a passive proc (Reclamation) in the post-kick window is not the first cast (825ca842 @303)", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyShaman",
      spec: CombatUnitSpec.Shaman_Enhancement,
      reaction: CombatUnitReaction.Hostile,
    });
    const player = makeUnit("player-1", {
      name: "PlayerPaladin",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "57994",
          "Wind Shear",
          "19750",
          "Flash of Light",
          MATCH_START + 30_000,
          "enemy-1",
          "EnemyShaman",
        ),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "415388",
          MATCH_START + 30_500,
          "player-1",
          "PlayerPaladin",
          "player-1",
          "PlayerPaladin",
          0,
          "Reclamation",
        ),
        makeSpellCastEvent(
          "20473",
          MATCH_START + 33_200,
          "player-1",
          "PlayerPaladin",
          "player-1",
          "PlayerPaladin",
          0,
          "Holy Shock",
        ),
      ],
    });
    const inst = analyzePlayerCCAndTrinket(player, [enemy], makeCombat())
      .interruptInstances[0]!;
    expect(inst.firstActionDelayS).toBeCloseTo(3.2, 5);
  });

  it("W1k: a kick after the spell's own SPELL_CAST_SUCCESS hit the channel — channelS set, no cast depth (1bad0a5c Mind Control)", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyShaman",
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
    });
    const MC = "605";
    const player = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      castStartEvents: [
        {
          logLine: {
            event: LogEvent.SPELL_CAST_START,
            timestamp: MATCH_START + 25_016,
            parameters: [],
          },
          spellId: MC,
        } as any,
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          MC,
          MATCH_START + 26_320,
          "player-1",
          "PlayerPriest",
          "enemy-2",
          "Target",
        ),
      ],
      actionIn: [
        makeInterruptEvent(
          "57994",
          "Wind Shear",
          MC,
          "Mind Control",
          MATCH_START + 27_403,
          "enemy-1",
          "EnemyShaman",
        ),
      ],
    });
    const res = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(res.interruptInstances[0].channelS).toBeCloseTo(1.1, 6);
    expect(res.interruptInstances[0].kickDepthPct).toBeNull();
  });

  it("W1k: an instant-start channel (no cast start) kicked after it began is a channel kick (fa5e6c66 Void Torrent)", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyMage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
    });
    const VT = "263165";
    const player = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Shadow,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent(
          VT,
          MATCH_START + 22_900,
          "player-1",
          "PlayerPriest",
          "enemy-1",
          "EnemyMage",
        ),
      ],
      actionIn: [
        makeInterruptEvent(
          "2139",
          "Counterspell",
          VT,
          "Void Torrent",
          MATCH_START + 24_402,
          "enemy-1",
          "EnemyMage",
        ),
      ],
    });
    const res = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(res.interruptInstances[0].channelS).toBeCloseTo(1.5, 6);
  });

  it("hardcast median: does not re-order the player's shared castStartEvents, and reads a median from unsorted / tied starts", () => {
    const enemy = makeUnit("enemy-1", {
      name: "EnemyRogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
    });
    // An id the hardcast-heal table does not know, so kickDepthPct has to
    // come from the player's own completed-cast median.
    const SP = "999001";
    const start = (spellId: string, atMs: number) =>
      ({
        logLine: {
          event: LogEvent.SPELL_CAST_START,
          timestamp: atMs,
          parameters: [],
        },
        spellId,
      }) as any;
    const success = (spellId: string, atMs: number) =>
      makeSpellCastEvent(
        spellId,
        atMs,
        "enemy-1",
        "EnemyRogue",
        "player-1",
        "PlayerPriest",
      );
    // Deliberately NOT chronological, with an exact-tie duplicate and a
    // fractional stamp: two completed 2 s casts (+10→+12, +20.5→+22.5), then
    // the kicked one at +30 (kick at +31 ⇒ 1 s / 2 s median = 50 %).
    const castStartEvents = [
      start(SP, MATCH_START + 30_000),
      start("999002", MATCH_START + 40_000),
      start(SP, MATCH_START + 20_500),
      start(SP, MATCH_START + 10_000),
      start(SP, MATCH_START + 10_000),
    ];
    const orderBefore = castStartEvents.map((e) => e.logLine.timestamp);
    const player = makeUnit("player-1", {
      name: "PlayerPriest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      castStartEvents,
      spellCastEvents: [
        success(SP, MATCH_START + 22_500),
        success(SP, MATCH_START + 12_000),
      ],
      actionIn: [
        makeInterruptEvent(
          "1766",
          "Kick",
          SP,
          "Unknown Hardcast",
          MATCH_START + 31_000,
          "enemy-1",
          "EnemyRogue",
        ),
      ],
    });

    const res = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(res.interruptInstances).toHaveLength(1);
    expect(res.interruptInstances[0].kickDepthPct).toBe(50);
    // The analysis sorts a COPY: every other reader of this unit sees the
    // array exactly as the parser left it.
    expect(player.castStartEvents!.map((e) => e.logLine.timestamp)).toEqual(
      orderBefore,
    );
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E21 (ruling A′15): the "broke this CC" set is
 * the break racials plus the class abilities that remove control, and a racial
 * the game logs only as a buff is read from that buff.
 */
describe("CC-break abilities other than the trinket (F-E21 / A′15)", () => {
  const MATCH_START = 1_000_000;
  const combat = {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    startInfo: { zoneId: "1672" },
  };
  const KIDNEY = "408";
  const BLINK = "1953";
  const WILL_OF_THE_FORSAKEN = "7744";
  const STONEFORM_BUFF = "65116";
  const PSYCHIC_SCREAM = "8122";
  const WILL_TO_SURVIVE = "59752";
  const MEDALLION = "336126";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const enemy = () =>
    makeUnit("enemy-1", {
      name: "EnemyRogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
    });
  /** a CC on player-1 from `fromS` to `toS` (round seconds) */
  const cc = (spellId: string, fromS: number, toS: number) => [
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      spellId,
      MATCH_START + fromS * 1000,
      "enemy-1",
      "player-1",
    ),
    makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      spellId,
      MATCH_START + toS * 1000,
      "enemy-1",
      "player-1",
    ),
  ];
  const stun = (fromS: number, toS: number) => cc(KIDNEY, fromS, toS);
  /** Psychic Scream — a fear (mechanic 5) */
  const fear = (fromS: number, toS: number) => cc(PSYCHIC_SCREAM, fromS, toS);

  it("the table: class ids are not racials, every aura-keyed racial maps to a registered break racial", () => {
    for (const id of Object.keys(CLASS_CC_BREAK_ABILITIES)) {
      expect(RACIAL_ABILITIES[id], id).toBeUndefined();
      expect(CC_BREAK_CAST_IDS.has(id), id).toBe(true);
    }
    for (const id of BREAK_RACIAL_SPELL_IDS)
      expect(CC_BREAK_CAST_IDS.has(id), id).toBe(true);
    for (const castId of Object.values(AURA_KEYED_BREAK_RACIALS))
      expect(BREAK_RACIAL_SPELL_IDS.has(castId), castId).toBe(true);
    expect(ccBreakAbilityName(BLINK)).toBe("Blink");
    expect(ccBreakAbilityName(WILL_OF_THE_FORSAKEN)).toBe(
      "Will of the Forsaken",
    );
    expect(ccBreakAbilityName("642")).toBeNull(); // Divine Shield is F-E20's
  });

  it("Blink pressed inside a stun is the break: the CC reads broken by Blink, and the use carries the CC", () => {
    const player = makeUnit("player-1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: stun(10, 11.2),
      spellCastEvents: [
        makeSpellCastEvent(BLINK, MATCH_START + 11_200, "0000000000000000"),
        // a Blink with no CC on is a press, not a break
        makeSpellCastEvent(BLINK, MATCH_START + 60_000, "0000000000000000"),
      ],
    });
    const r = analyzePlayerCCAndTrinket(player, [enemy()], combat);
    expect(r.ccInstances[0]).toMatchObject({
      trinketState: "racial_break",
      breakRacialName: "Blink",
    });
    expect(
      r.breakAbilityUses?.map((u) => [u.name, u.atSeconds, !!u.brokenCc]),
    ).toEqual([
      ["Blink", 11.2, true],
      ["Blink", 60, false],
    ]);
    expect(r.breakAbilityUses?.[0]?.sharesTrinketLock).toBe(false);
    // a class break does not lock the trinket
    expect(r.racialTrinketLocks).toEqual([]);
  });

  it("Stoneform is read from its buff (the cast is never logged) and locks the trinket like the other racials", () => {
    const stoneform = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      STONEFORM_BUFF,
      MATCH_START + 20_000,
      "player-1",
      "player-1",
      "BUFF",
    );
    const player = makeUnit("player-1", {
      name: "Dwarf",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [stoneform],
    });
    expect(breakAbilityPresses(player as never)).toEqual([
      { ts: MATCH_START + 20_000, spellId: "20594" },
    ]);
    const r = analyzePlayerCCAndTrinket(player, [enemy()], combat);
    expect(r.racialTrinketLocks).toEqual([{ atSeconds: 20, lockSeconds: 30 }]);
    expect(r.breakAbilityUses?.[0]).toMatchObject({
      name: "Stoneform",
      sharesTrinketLock: true,
    });
  });

  // 0cb55930 4:09 / f563bad8 0:57: a dwarf's Stoneform dispels Unstable
  // Affliction / Vampiric Touch and the backlash CC lands on him 1–23 ms
  // later, then runs its course. Inside the binder's 250 ms tolerance — and
  // the opposite of a break.
  it("a press just BEFORE a CC lands is not its break: the CC must end at the press (Stoneform → dispel backlash)", () => {
    // the shared predicate (F-E20): at or after the landing, within 10 ms of
    // the removal
    const w = { applyMs: 1_000, removeMs: 5_000 };
    expect(castEndedCcWindow(w, 5_003)).toBe(true);
    expect(castEndedCcWindow(w, 4_995)).toBe(true);
    expect(castEndedCcWindow(w, 4_900)).toBe(false); // mid-CC, the CC ran on
    expect(castEndedCcWindow(w, 990)).toBe(false); // before it landed
    const player = makeUnit("player-1", {
      name: "Dwarf",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          STONEFORM_BUFF,
          MATCH_START + 19_980,
          "player-1",
          "player-1",
          "BUFF",
        ),
        ...stun(20, 24),
      ],
      spellCastEvents: [
        // Blink 0.1 s before a stun that then runs 4 s
        makeSpellCastEvent(BLINK, MATCH_START + 19_900, "0000000000000000"),
      ],
    });
    const r = analyzePlayerCCAndTrinket(player, [enemy()], combat);
    expect(r.ccInstances[0]?.trinketState).not.toBe("racial_break");
    expect(r.ccInstances[0]?.breakRacialName).toBeUndefined();
    expect(r.breakAbilityUses?.map((u) => [u.name, !!u.brokenCc])).toEqual([
      ["Blink", false],
      ["Stoneform", false],
    ]);
  });

  it("a later CC states the racial's own cooldown while it is still running (9c6ab747 1:37)", () => {
    const player = makeUnit("player-1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
      // Will of the Forsaken removes charm / fear / sleep, not a stun
      auraEvents: [...fear(17, 18.3), ...stun(97, 101), ...stun(150, 154)],
      spellCastEvents: [
        makeSpellCastEvent(
          WILL_OF_THE_FORSAKEN,
          MATCH_START + 18_293,
          "0000000000000000",
        ),
      ],
    });
    const r = analyzePlayerCCAndTrinket(player, [enemy()], combat);
    expect(r.ccInstances[0]?.breakRacialName).toBe("Will of the Forsaken");
    // 120 s cooldown from 18.293 → 41.3 s left at 97 s, printed rounded up
    expect(r.ccInstances[1]?.breakRacialOnCd).toEqual({
      name: "Will of the Forsaken",
      secondsLeft: 42,
    });
    // ready again by 150 s
    expect(r.ccInstances[2]?.breakRacialOnCd).toBeUndefined();
  });

  it("which control a break removes is DB2's mechanic-immunity aura: the table has one per class id, the dispel-type racials have none", () => {
    for (const id of Object.keys(CLASS_CC_BREAK_ABILITIES))
      expect(mechanicsBrokenBy(id).length, id).toBeGreaterThan(0);
    // stun = 12, fear = 5, incapacitate = 14, charm = 1, sleep = 10
    expect(mechanicsBrokenBy(BLINK)).toContain(12);
    expect(mechanicsBrokenBy(BLINK)).not.toContain(5);
    expect([...mechanicsBrokenBy("384100")].sort((a, b) => a - b)).toEqual(
      [...mechanicsBrokenBy("18499")].sort((a, b) => a - b),
    ); // Berserker Shout = Berserker Rage
    expect(mechanicsBrokenBy(WILL_TO_SURVIVE)).toEqual([12]);
    expect(mechanicsBrokenBy(WILL_OF_THE_FORSAKEN)).not.toContain(12);
    // Stoneform / Fireblood (dispel by type) and Escape Artist (roots /
    // snares): no aura-77 row → `breakRemovesCc` never binds them
    for (const id of ["20594", "265221", "20589"]) {
      expect(mechanicsBrokenBy(id), id).toEqual([]);
      expect(breakRemovesCc(id, KIDNEY), id).toBe(false);
    }
    expect(breakRemovesCc(BLINK, KIDNEY)).toBe(true);
    expect(breakRemovesCc(BLINK, PSYCHIC_SCREAM)).toBe(false);
    expect(breakRemovesCc(WILL_OF_THE_FORSAKEN, PSYCHIC_SCREAM)).toBe(true);
    expect(breakRemovesCc(WILL_OF_THE_FORSAKEN, KIDNEY)).toBe(false);
    // a CC whose mechanic DB2 cannot give is never "broken by" anything
    expect(breakRemovesCc(BLINK, "999999999")).toBe(false);
  });

  it("a press at the instant a CC of ANOTHER mechanic ends is not its break (a fear that ran out, a queued Blink 4 ms later)", () => {
    const player = makeUnit("player-1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: fear(10, 18),
      spellCastEvents: [
        makeSpellCastEvent(BLINK, MATCH_START + 18_004, "0000000000000000"),
      ],
    });
    const r = analyzePlayerCCAndTrinket(player, [enemy()], combat);
    expect(r.ccInstances[0]?.trinketState).not.toBe("racial_break");
    expect(r.ccInstances[0]?.breakRacialName).toBeUndefined();
    expect(r.breakAbilityUses?.map((u) => [u.name, !!u.brokenCc])).toEqual([
      ["Blink", false],
    ]);
  });

  it("a CC that ran its full official length ended on its own: a Blink 4 ms later is not its break (codex round 3)", () => {
    const full = ccFullDurationSeconds(KIDNEY)!;
    expect(full).toBeGreaterThan(1);
    const mage = (endS: number) =>
      makeUnit("player-1", {
        name: "Mage",
        spec: CombatUnitSpec.Mage_Frost,
        reaction: CombatUnitReaction.Friendly,
        auraEvents: stun(10, endS),
        spellCastEvents: [
          makeSpellCastEvent(
            BLINK,
            MATCH_START + Math.round(endS * 1000) + 4,
            "0000000000000000",
          ),
        ],
      });
    const ranOut = analyzePlayerCCAndTrinket(
      mage(10 + full),
      [enemy()],
      combat,
    );
    expect(ranOut.ccInstances[0]?.breakRacialName).toBeUndefined();
    expect(ranOut.breakAbilityUses?.[0]?.brokenCc).toBeUndefined();
    // cut short by a second: the Blink is the break
    const cut = analyzePlayerCCAndTrinket(mage(9 + full), [enemy()], combat);
    expect(cut.ccInstances[0]?.breakRacialName).toBe("Blink");
  });

  it("the trinket locks the racial too: a CC inside the shared lock states the racial is not back (A′15: and vice versa)", () => {
    const human = (casts: ReturnType<typeof makeSpellCastEvent>[]) =>
      makeUnit("player-1", {
        name: "Human",
        spec: CombatUnitSpec.Warrior_Arms,
        reaction: CombatUnitReaction.Friendly,
        auraEvents: [...stun(9, 10), ...stun(195, 199), ...stun(215, 219)],
        spellCastEvents: casts,
      });
    // Will to Survive at 10 s (180 s cooldown → back at 190 s); the trinket
    // at 180 s holds it until 210 s
    const r = analyzePlayerCCAndTrinket(
      human([
        makeSpellCastEvent(
          WILL_TO_SURVIVE,
          MATCH_START + 10_000,
          "0000000000000000",
        ),
        makeSpellCastEvent(
          MEDALLION,
          MATCH_START + 180_000,
          "0000000000000000",
        ),
      ]),
      [enemy()],
      combat,
    );
    expect(r.ccInstances[1]?.breakRacialOnCd).toEqual({
      name: "Will to Survive",
      secondsLeft: 15,
    });
    expect(r.ccInstances[2]?.breakRacialOnCd).toBeUndefined();
    // the racial is the player's whenever it is seen pressed this round —
    // here only after the CC
    const later = analyzePlayerCCAndTrinket(
      human([
        makeSpellCastEvent(
          MEDALLION,
          MATCH_START + 180_000,
          "0000000000000000",
        ),
        makeSpellCastEvent(
          WILL_TO_SURVIVE,
          MATCH_START + 250_000,
          "0000000000000000",
        ),
      ]),
      [enemy()],
      combat,
    );
    expect(later.ccInstances[1]?.breakRacialOnCd).toEqual({
      name: "Will to Survive",
      secondsLeft: 15,
    });
    // no racial ever pressed → nothing is claimed about one
    const none = analyzePlayerCCAndTrinket(
      human([
        makeSpellCastEvent(
          MEDALLION,
          MATCH_START + 180_000,
          "0000000000000000",
        ),
      ]),
      [enemy()],
      combat,
    );
    expect(none.ccInstances[1]?.breakRacialOnCd).toBeUndefined();
  });
});
