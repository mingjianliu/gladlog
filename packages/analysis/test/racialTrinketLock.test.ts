/**
 * fact6 F20 (D2 / D27 / B9, 4caab013): the racial ↔ PvP-trinket lock is by
 * role. Will to Survive locks the trinket (and the trinket it) for 90 s on a
 * DPS / tank and 60 s on a healer; Will of the Forsaken, Stoneform and
 * Fireblood 30 s for everyone (DB2 CategoryRecoveryTime of category 1166,
 * the healer trigger 1228476's 60 s cap; corpus in racialAbilities.ts).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  HEALER_RACIAL_TRINKET_LOCK_CAP_MS,
  RACIAL_TRINKET_LOCK_MS,
  racialTrinketLockoutMs,
  SHARED_CD_RACIAL_SPELL_IDS,
} from "../src/data/racialAbilities";
import {
  analyzePlayerCCAndTrinket,
  pvpTrinketRemainingSecondsAt,
} from "../src/utils/ccTrinketAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const combat = {
  startTime: MATCH_START,
  endTime: MATCH_START + 300_000,
  startInfo: { zoneId: "1672" },
};
const WILL_TO_SURVIVE = "59752";
const MEDALLION = "336126";
const PARALYSIS = "115078";

const enemy = () =>
  makeUnit("enemy-1", {
    name: "EnemyMonk",
    spec: CombatUnitSpec.Monk_Mistweaver,
    reaction: CombatUnitReaction.Hostile,
  });
/** an incapacitate on player-1 from `fromS` to `toS` (round seconds) */
const cc = (fromS: number, toS: number) => [
  makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED,
    PARALYSIS,
    MATCH_START + fromS * 1000,
    "enemy-1",
    "player-1",
  ),
  makeAuraEvent(
    LogEvent.SPELL_AURA_REMOVED,
    PARALYSIS,
    MATCH_START + toS * 1000,
    "enemy-1",
    "player-1",
  ),
];
const press = (id: string, atS: number) =>
  makeSpellCastEvent(id, MATCH_START + atS * 1000, "0000000000000000");
const human = (spec: CombatUnitSpec, ccs: number[][], casts: unknown[]) =>
  makeUnit("player-1", {
    name: "Human",
    spec,
    reaction: CombatUnitReaction.Friendly,
    auraEvents: ccs.flatMap(([a, b]) => cc(a!, b!)),
    spellCastEvents: casts as never,
  });

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("racialTrinketLockoutMs (fact6 F20)", () => {
  it("Will to Survive: 90 s for a DPS / tank, 60 s for a healer; the others 30 s either way", () => {
    expect(racialTrinketLockoutMs(WILL_TO_SURVIVE, false)).toBe(90_000);
    expect(racialTrinketLockoutMs(WILL_TO_SURVIVE, true)).toBe(60_000);
    for (const id of ["7744", "20594", "265221"]) {
      expect(racialTrinketLockoutMs(id, false), id).toBe(30_000);
      expect(racialTrinketLockoutMs(id, true), id).toBe(30_000);
    }
    expect(HEALER_RACIAL_TRINKET_LOCK_CAP_MS).toBe(60_000);
  });

  it("the lock table covers exactly the shared-cooldown racials", () => {
    expect(Object.keys(RACIAL_TRINKET_LOCK_MS).sort()).toEqual(
      [...SHARED_CD_RACIAL_SPELL_IDS].sort(),
    );
  });
});

describe("Will to Survive → trinket readiness (4caab013 shape)", () => {
  // Medallion 40.6 s (own cooldown → 160.6 s for a DPS), Will to Survive at
  // 152.8 s with 7.8 s of it left: the trinket is back at max(160.6,
  // 152.8 + 90) = 242.8 s. The game refused the press at 219.3 s.
  const casts = [press(MEDALLION, 40.6), press(WILL_TO_SURVIVE, 152.8)];

  it("a DPS's trinket is still locked at the 218 s Paralysis and at the 228.9 s death", () => {
    const r = analyzePlayerCCAndTrinket(
      human(CombatUnitSpec.Paladin_Retribution, [[218, 221]], casts),
      [enemy()],
      combat,
    );
    expect(r.ccInstances[0]).toMatchObject({
      trinketState: "on_cooldown",
      trinketCDSecondsLeft: 25,
    });
    expect(r.racialTrinketLocks).toEqual([
      { atSeconds: 152.8, lockSeconds: 90 },
    ]);
    expect(pvpTrinketRemainingSecondsAt(r, 219.3)).toBeGreaterThan(0);
    expect(pvpTrinketRemainingSecondsAt(r, 228.9)).toBeCloseTo(13.9, 5);
    expect(pvpTrinketRemainingSecondsAt(r, 242.8)).toBe(0);
  });

  it("a healer's lock is 60 s: the same presses leave the trinket ready at 218 s", () => {
    // healer: own cooldown 90 s → 130.6 s; lock → 212.8 s
    const r = analyzePlayerCCAndTrinket(
      human(CombatUnitSpec.Paladin_Holy, [[218, 221]], casts),
      [enemy()],
      combat,
    );
    expect(r.racialTrinketLocks).toEqual([
      { atSeconds: 152.8, lockSeconds: 60 },
    ]);
    expect(r.ccInstances[0]?.trinketState).toBe("available_unused");
    expect(pvpTrinketRemainingSecondsAt(r, 212)).toBeCloseTo(0.8, 5);
  });
});

describe("an Adaptation holder's trinket is not locked by the racial (fact6 F20 wide residual, 377a6252 r2)", () => {
  it("Will to Survive at 16 s, the Adaptation proc at 36.9 s: no lock, the trinket reads ready at 24 s", () => {
    // 1,333 605 + wide files: 8 of 9 Will to Survive → 283167 gaps are
    // 3.0–50.6 s (racialAbilities' 90 s lock is measured on Medallions)
    const u = human(
      CombatUnitSpec.Monk_Windwalker,
      [[24, 26]],
      [press(WILL_TO_SURVIVE, 16)],
    );
    u.auraEvents.push(
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "283167",
        MATCH_START + 36_900,
        "player-1",
        "player-1",
      ) as never,
    );
    const r = analyzePlayerCCAndTrinket(u, [enemy()], combat);
    expect(r.racialTrinketLocks).toEqual([]);
    expect(pvpTrinketRemainingSecondsAt(r, 24)).toBe(0);
  });
});

describe("trinket → Will to Survive (the reverse lock, same length)", () => {
  // Medallion at 40.6 s; Will to Survive pressed later in the round (it is
  // the player's racial); a CC at 52 s.
  const casts = [press(MEDALLION, 40.6), press(WILL_TO_SURVIVE, 152.8)];
  it("DPS: back at 130.6 s → 79 s left at 52 s; healer: 100.6 s → 49 s left", () => {
    const dps = analyzePlayerCCAndTrinket(
      human(CombatUnitSpec.Paladin_Retribution, [[52, 53]], casts),
      [enemy()],
      combat,
    );
    expect(dps.ccInstances[0]?.breakRacialOnCd).toEqual({
      name: "Will to Survive",
      secondsLeft: 79,
    });
    const healer = analyzePlayerCCAndTrinket(
      human(CombatUnitSpec.Paladin_Holy, [[52, 53]], casts),
      [enemy()],
      combat,
    );
    expect(healer.ccInstances[0]?.breakRacialOnCd).toEqual({
      name: "Will to Survive",
      secondsLeft: 49,
    });
  });
});
