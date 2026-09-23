/**
 * GH #86 (user rulings 2026-09-22): most summons fold into their owner; the
 * functional ones get two facts and nothing else —
 *   (A) every `[UNIT DESTROYED]` line says how long the unit stood before the
 *       blow, `, N s after it was summoned` (summon → kill), and NEVER an
 *       "expected" lifetime (the log has no despawn event, so it cannot be
 *       observed — user: 「如果不确定它的时长的话,你就不要写预期」);
 *   (C) the roster names a warlock's pet by its function — every functional
 *       pet is listed whether or not the corpus has shown it.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchContext } from "../src/context/buildMatchContext";
import { buildMatchTimeline } from "../src/context/matchTimeline";
import {
  nonPlayerUnitKill,
  summonLifetimeAtKillS,
} from "../src/context/timelineHelpers";
import { warlockPetFunction } from "../src/utils/warlockPet";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";

const T0 = 1_000_000;

function unit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: "Player-1",
    name: "OwnerPlayer",
    type: CombatUnitType.Player,
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [],
    auraEvents: [],
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    missesIn: [],
    missesOut: [],
    advancedActions: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
    ownerId: "",
    ...overrides,
  } as ICombatUnit;
}

const emptyDispel = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
};

describe("summonLifetimeAtKillS — how long a summon stood before the killing blow", () => {
  const summonAt = (ms: number) =>
    ({
      spellId: "1280172",
      logLine: { event: LogEvent.SPELL_SUMMON, timestamp: ms, parameters: [] },
    }) as never;
  const blowAt = (ms: number, src = "Player-1") =>
    ({
      srcUnitId: src,
      srcUnitFlags: 0x511,
      srcUnitName: "OwnerPlayer",
      spellId: "8092",
      spellName: "Mind Blast",
      amount: 1200,
      effectiveAmount: 1200,
      overkill: 300,
      // nonPlayerUnitKill reads the damage event's own `timestamp`
      timestamp: ms,
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms },
    }) as never;

  it("summon at t, overkill blow at t + 3.4 s → 3.4", () => {
    const fiend = unit({
      id: "Creature-0-1-1-1-19668-0001",
      name: "暗影魔",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      actionIn: [summonAt(T0 + 38_000)],
      damageIn: [blowAt(T0 + 41_400)],
    });
    const kill = nonPlayerUnitKill(fiend);
    expect(kill).not.toBeNull();
    expect(summonLifetimeAtKillS(fiend, kill!)).toBe(3.4);
  });

  it("no SPELL_SUMMON in the log → null (nothing is stated, nothing is guessed)", () => {
    const fiend = unit({
      id: "Creature-0-1-1-1-19668-0002",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      damageIn: [blowAt(T0 + 41_400)],
    });
    expect(summonLifetimeAtKillS(fiend, nonPlayerUnitKill(fiend)!)).toBeNull();
  });

  it("[UNIT DESTROYED] carries ', N s after it was summoned' and no 'expected'", () => {
    const owner = unit({ id: "P1", name: "OwnerPlayer" });
    const enemyPriest = unit({
      id: "E1",
      name: "EnemyPriest",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Priest_Shadow,
    });
    const fiend = unit({
      id: "Creature-0-1-1-1-19668-0003",
      name: "暗影魔",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      actionIn: [summonAt(T0 + 38_000)],
      damageIn: [blowAt(T0 + 41_400, "P1")],
    });
    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Arms Warrior",
      friends: [owner],
      enemies: [enemyPriest],
      allUnits: [owner, enemyPriest, fiend],
      playerIdMap: new Map([["OwnerPlayer", 0]]),
      enemyIdMap: new Map([["EnemyPriest", 1]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as never,
      enemyDispelSummary: emptyDispel as never,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });
    const line = timeline
      .split("\n")
      .find((l) => l.includes("[UNIT DESTROYED]"));
    expect(line).toBeDefined();
    expect(line).toContain("Shadowfiend (Enemy)");
    expect(line).toContain(", 3.4 s after it was summoned");
    expect(line).not.toMatch(/expected/i);
    expect(line).not.toContain("暗影魔");
  });
});

describe("warlockPetFunction — the roster names a warlock's pet by what it does", () => {
  const lock = unit({
    id: "W1",
    name: "Lock",
    spec: CombatUnitSpec.Warlock_Affliction,
  });
  const petOf = (npcId: string, casts: string[] = []) =>
    unit({
      id: `Pet-0-1-1-1-${npcId}-0A0B`,
      name: "斯鲁麦恩",
      type: CombatUnitType.Pet,
      ownerId: "W1",
      spellCastEvents: casts.map(
        (spellId) =>
          ({
            spellId,
            logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 },
          }) as never,
      ),
    });

  it("Felhunter by npcId 417 → Spell Lock + Devour Magic; the logged pet name never leaks", () => {
    const fn = warlockPetFunction(lock, [lock, petOf("417")]);
    expect(fn?.pet).toBe("Felhunter");
    expect(fn?.does).toContain("Spell Lock");
    expect(JSON.stringify(fn)).not.toContain("斯鲁麦恩");
  });

  it("every functional pet is in the table, observed or not: Sayaad / Imp / Felguard / Voidwalker", () => {
    expect(warlockPetFunction(lock, [petOf("1863")])?.does).toContain(
      "Seduction",
    );
    expect(warlockPetFunction(lock, [petOf("416")])?.does).toContain(
      "Singe Magic",
    );
    expect(warlockPetFunction(lock, [petOf("17252")])?.does).toContain(
      "Axe Toss",
    );
    expect(warlockPetFunction(lock, [petOf("1860")])?.pet).toBe("Voidwalker");
  });

  it("unlisted npcId falls back to the pet's signature cast", () => {
    expect(warlockPetFunction(lock, [petOf("999999", ["6358"])])?.pet).toBe(
      "Sayaad",
    );
  });

  it("non-warlock owner, or a warlock whose pet never appears → null", () => {
    expect(warlockPetFunction(unit({ id: "M1" }), [petOf("417")])).toBeNull();
    expect(warlockPetFunction(lock, [lock])).toBeNull();
  });

  it("buildMatchContext roster: '[pet: Felhunter — …]' after the warlock, absent for everyone else", () => {
    const match = loadLegacyMatchFixture();
    const players = Object.values(match.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    const lockPlayer = enemies[0]!;
    lockPlayer.spec = CombatUnitSpec.Warlock_Destruction;
    match.units["Pet-0-1-1-1-417-0C0D"] = petOf("417");
    match.units["Pet-0-1-1-1-417-0C0D"]!.ownerId = lockPlayer.id;
    const ctx = buildMatchContext(match, friends, enemies, {});
    const roster = ctx.split("\n").find((l) => l.startsWith("  Enemy team:"));
    expect(roster).toContain(
      `(${lockPlayer.name}) [pet: Felhunter — Spell Lock (kick), Devour Magic (purge)]`,
    );
    expect((ctx.match(/\[pet: /g) ?? []).length).toBe(1);
  });
});
