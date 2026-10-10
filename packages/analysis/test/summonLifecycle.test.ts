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
  CombatUnitClass,
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
import {
  warlockPetFunction,
  warlockPetFunctions,
} from "../src/utils/warlockPet";
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

describe("[UNIT DESTROYED] — a hunter's or warlock's permanent pet being killed (user ruling 2026-10-09)", () => {
  const blow = (ms: number, src: string): never =>
    ({
      srcUnitId: src,
      srcUnitFlags: 0x511,
      srcUnitName: "OwnerPlayer",
      spellId: "8092",
      spellName: "Mind Blast",
      amount: 1200,
      effectiveAmount: 1200,
      overkill: 300,
      timestamp: ms,
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms },
    }) as never;
  const owner = unit({ id: "P1", name: "OwnerPlayer" });
  const render = (enemy: ICombatUnit, pet: ICombatUnit) =>
    buildMatchTimeline({
      owner,
      ownerSpec: "Arms Warrior",
      friends: [owner],
      enemies: [enemy],
      allUnits: [owner, enemy, pet],
      playerIdMap: new Map([["OwnerPlayer", 0]]),
      enemyIdMap: new Map([[enemy.name, 1]]),
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
    })
      .split("\n")
      .filter((l) => l.includes("[UNIT DESTROYED]"));

  it("术士的 Felhunter:按规范名字写,谁的、哪一边、被什么打死", () => {
    const lock = unit({
      id: "E1",
      name: "EnemyLock",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Affliction,
    });
    const pet = unit({
      id: "Pet-0-3878-2509-35306-417-020560C99D",
      name: "吉兹勒普",
      type: CombatUnitType.Pet,
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      damageIn: [blow(T0 + 41_400, "P1")],
    });
    const lines = render(lock, pet);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^0:41 {2}\[UNIT DESTROYED\] {3}\S+'s Felhunter \(Enemy\) killed by: /,
    );
    expect(lines[0]).toContain("Mind Blast");
    expect(lines[0]).not.toContain("吉兹勒普");
    expect(lines[0]).not.toMatch(/expected|should/i);
  });

  it("猎人的宠物写 pet;死亡骑士的宠物不出行(用户:无所谓);没被打死的不出行", () => {
    const hunter = unit({
      id: "E1",
      name: "EnemyHunter",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Hunter,
      spec: CombatUnitSpec.Hunter_BeastMastery,
    });
    const hunterPet = (damageIn: never[]) =>
      unit({
        id: "Pet-0-3878-2509-35306-165189-020560C99D",
        name: "Doku",
        type: CombatUnitType.Pet,
        reaction: CombatUnitReaction.Hostile,
        ownerId: "E1",
        damageIn,
      });
    const killed = render(hunter, hunterPet([blow(T0 + 20_000, "P1")]));
    expect(killed).toHaveLength(1);
    expect(killed[0]).toContain("'s pet (Enemy) killed by: ");
    expect(render(hunter, hunterPet([]))).toHaveLength(0);
    const dk = unit({
      id: "E1",
      name: "EnemyKnight",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.DeathKnight,
      spec: CombatUnitSpec.DeathKnight_Unholy,
    });
    const ghoul = unit({
      id: "Pet-0-3878-2509-35306-26125-020560C99D",
      name: "Mudflayer",
      type: CombatUnitType.Pet,
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      damageIn: [blow(T0 + 20_000, "P1")],
    });
    expect(render(dk, ghoul)).toHaveLength(0);
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

  describe("warlockPetFunctions — a mid-round pet swap (triage pets-summons F-PS1)", () => {
    const petAt = (guid: string, firstS: number | null, ownerId = "W1") =>
      unit({
        id: guid,
        name: "x",
        type: CombatUnitType.Pet,
        ownerId,
        damageOut:
          firstS === null
            ? []
            : ([
                {
                  timestamp: T0 + firstS * 1000,
                  logLine: { timestamp: T0 + firstS * 1000 },
                },
              ] as never),
      });
    const sayaad = petAt("Pet-0-1-1-1-1863-0A01", 2);
    const felhunter = petAt("Pet-0-1-1-1-417-0A02", 36.4);

    it("every permanent pet, in first-appearance order, with when the later ones show up", () => {
      const pets = warlockPetFunctions(lock, [felhunter, lock, sayaad], T0);
      expect(pets.map((p) => p.fn.pet)).toEqual(["Sayaad", "Felhunter"]);
      expect(pets[1]!.fromSeconds).toBeCloseTo(36.4, 5);
    });

    it("one entry per pet kind; a temporary Creature- summon with a pet's npc id is not a pet", () => {
      const again = petAt("Pet-0-1-1-1-417-0A03", 80);
      const wildImp = petAt("Creature-0-1-1-1-416-0B01", 5);
      expect(
        warlockPetFunctions(lock, [sayaad, felhunter, again, wildImp], T0).map(
          (p) => p.fn.pet,
        ),
      ).toEqual(["Sayaad", "Felhunter"]);
    });

    it("a pet that logged no event of its own is listed last, with no time", () => {
      const silent = petAt("Pet-0-1-1-1-416-0A04", null);
      const pets = warlockPetFunctions(lock, [silent, felhunter], T0);
      expect(pets.map((p) => p.fn.pet)).toEqual(["Felhunter", "Imp"]);
      expect(pets[1]!.fromSeconds).toBeNull();
    });

    it("another warlock's pet and a non-warlock owner are not counted", () => {
      expect(
        warlockPetFunctions(lock, [petAt("Pet-0-1-1-1-417-0A05", 3, "W2")], T0),
      ).toEqual([]);
      expect(warlockPetFunctions(unit({ id: "M1" }), [sayaad], T0)).toEqual([]);
    });
  });

  it("buildMatchContext roster: a swap renders both pets, the second with its first second", () => {
    const match = loadLegacyMatchFixture();
    const players = Object.values(match.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    const lockPlayer = enemies[0]!;
    lockPlayer.spec = CombatUnitSpec.Warlock_Affliction;
    const at = (s: number) =>
      [
        {
          timestamp: match.startTime + s * 1000,
          logLine: { timestamp: match.startTime + s * 1000 },
        },
      ] as never;
    match.units["Pet-0-1-1-1-1863-0C01"] = unit({
      id: "Pet-0-1-1-1-1863-0C01",
      name: "a",
      type: CombatUnitType.Pet,
      ownerId: lockPlayer.id,
      damageOut: at(1),
    });
    match.units["Pet-0-1-1-1-417-0C02"] = unit({
      id: "Pet-0-1-1-1-417-0C02",
      name: "b",
      type: CombatUnitType.Pet,
      ownerId: lockPlayer.id,
      damageOut: at(36.4),
    });
    const ctx = buildMatchContext(match, friends, enemies, {});
    const roster = ctx.split("\n").find((l) => l.startsWith("  Enemy team:"));
    expect(roster).toContain(
      `(${lockPlayer.name}) [pet: Sayaad — Seduction (incapacitate); Felhunter from 0:36 — Spell Lock (kick), Devour Magic (purge)]`,
    );
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

  it("buildMatchContext roster: a temporary Creature- summon never names the pet — not ahead of the real one, not alone", () => {
    const build = (withRealPet: boolean) => {
      const match = loadLegacyMatchFixture();
      const players = Object.values(match.units).filter((u) => u.info);
      const friends = players.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );
      const enemies = players.filter(
        (u) => u.reaction === CombatUnitReaction.Hostile,
      );
      const lockPlayer = enemies[0]!;
      lockPlayer.spec = CombatUnitSpec.Warlock_Demonology;
      // a Creature- summon carrying the Imp's npc id, inserted BEFORE the pet
      const units: typeof match.units = {
        "Creature-0-1-1-1-416-0B01": unit({
          id: "Creature-0-1-1-1-416-0B01",
          name: "Wild Imp",
          ownerId: lockPlayer.id,
        }),
        ...match.units,
      };
      if (withRealPet) {
        units["Pet-0-1-1-1-17252-0C0E"] = petOf("17252");
        units["Pet-0-1-1-1-17252-0C0E"]!.ownerId = lockPlayer.id;
      }
      match.units = units;
      const ctx = buildMatchContext(match, friends, enemies, {});
      return ctx.split("\n").find((l) => l.startsWith("  Enemy team:"))!;
    };
    expect(build(true)).toContain("[pet: Felguard — ");
    expect(build(true)).not.toContain("[pet: Imp");
    expect(build(false)).not.toContain("[pet: ");
  });

  it("warlockPetFunctions: two pets with no event of their own keep a defined order", () => {
    const silent = (guid: string) =>
      unit({ id: guid, name: "x", type: CombatUnitType.Pet, ownerId: "W1" });
    const pets = warlockPetFunctions(
      lock,
      [silent("Pet-0-1-1-1-416-0A06"), silent("Pet-0-1-1-1-417-0A07")],
      T0,
    );
    expect(pets.map((p) => p.fn.pet)).toEqual(["Imp", "Felhunter"]);
    expect(pets.every((p) => p.fromSeconds === null)).toBe(true);
  });
});
