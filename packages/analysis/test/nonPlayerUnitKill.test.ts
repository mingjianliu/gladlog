import {
  CombatUnitReaction,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  CONTESTABLE_ENEMY_SUMMON_NPC_IDS,
  CRITICAL_NON_PLAYER_NPC_IDS,
  nonPlayerUnitKill,
  opposingHitsOnUnit,
  summonedAtMs,
} from "../src/context/timelineHelpers";
import {
  attackerBlowFor,
  isAttackerDamageRow,
  playerKillingBlow,
  SPLIT_TRANSFER_SLACK_MS,
} from "../src/utils/killingBlow";

type Hit = ICombatUnit["damageIn"][number];
const hit = (timestamp: number, overkill?: number): Hit =>
  ({
    timestamp,
    spellId: "589",
    spellName: "Shadow Word: Pain",
    amount: -100,
    effectiveAmount: -0, // zeroed for pet/guardian targets — why overkill is its own field
    ...(overkill ? { overkill } : {}),
  }) as unknown as Hit;
const unit = (damageIn: Hit[], deaths: number[] = []): ICombatUnit =>
  ({
    damageIn,
    deathRecords: deaths.map((timestamp) => ({ timestamp })),
  }) as unknown as ICombatUnit;

describe("nonPlayerUnitKill (GH #100: 12.x logs write no UNIT_DIED for totems)", () => {
  it("reads a kill from the first overkill damage event", () => {
    const k = nonPlayerUnitKill(unit([hit(1000), hit(2000, 40), hit(3000, 5)]));
    expect(k?.timestamp).toBe(2000);
    expect(k?.finalBlow?.spellName).toBe("Shadow Word: Pain");
  });

  it("no overkill and no UNIT_DIED is UNKNOWN, never a kill", () => {
    expect(nonPlayerUnitKill(unit([hit(1000), hit(2000)]))).toBeNull();
    expect(nonPlayerUnitKill(unit([]))).toBeNull();
  });

  it("still honours a bare UNIT_DIED", () => {
    const k = nonPlayerUnitKill(unit([hit(1000)], [5000]));
    expect(k).toEqual({ timestamp: 5000 });
  });

  it("one kill per unit, earliest evidence wins, final blow kept", () => {
    expect(nonPlayerUnitKill(unit([hit(2000, 40)], [2003]))?.timestamp).toBe(
      2000,
    );
    const late = nonPlayerUnitKill(unit([hit(9000, 40)], [5000]));
    expect(late?.timestamp).toBe(5000);
    expect(late?.finalBlow?.timestamp).toBe(9000);
  });
});

describe("the final blow is an attacker's (fact6 D22)", () => {
  // 114a4df7-r0 1:02: the Sayaad's overkill row was its warlock's Soul Link
  // DAMAGE_SPLIT and the line read "killed by: 5(DWarlock) — Soul Link".
  const row = (
    timestamp: number,
    event: LogEvent,
    srcUnitId: string,
    spellName: string,
    overkill?: number,
  ): Hit =>
    ({
      logLine: { event, timestamp },
      timestamp,
      srcUnitId,
      spellName,
      amount: -100,
      effectiveAmount: -0,
      ...(overkill ? { overkill } : {}),
    }) as unknown as Hit;
  // codex F20-07: Shooting Stars left the Sayaad alive (9 000); the
  // Starsurge on its warlock (9 400) moved the lethal damage through Soul
  // Link in that same millisecond — the split's attacker is that hit
  const own = row(9_000, LogEvent.SPELL_DAMAGE, "druid", "Shooting Stars");
  const split = row(9_400, LogEvent.DAMAGE_SPLIT, "warlock", "Soul Link", 30);
  const onHolder = row(9_400, LogEvent.SPELL_DAMAGE, "druid", "Starsurge");
  const holders =
    (rows: Hit[]) =>
    (id: string): Pick<ICombatUnit, "damageIn"> | undefined =>
      id === "warlock" ? { damageIn: rows } : undefined;

  it("a split overkill row keeps its instant and credits the hit on its link holder", () => {
    const k = nonPlayerUnitKill(unit([own, split]), holders([onHolder]));
    expect(k?.timestamp).toBe(9_400);
    expect(k?.finalBlow?.spellName).toBe("Starsurge");
    expect(attackerBlowFor(split, holders([onHolder]))).toBe(onHolder);
  });

  it("the victim's own earlier hit is no evidence: no holder hit, no final blow", () => {
    expect(nonPlayerUnitKill(unit([own, split]))?.finalBlow).toBeUndefined();
    const late = row(
      9_400 - SPLIT_TRANSFER_SLACK_MS - 1,
      LogEvent.SPELL_DAMAGE,
      "druid",
      "Starsurge",
    );
    const k = nonPlayerUnitKill(unit([own, split]), holders([late]));
    expect(k?.timestamp).toBe(9_400);
    expect(k?.finalBlow).toBeUndefined();
  });

  it("a player's killing blow reads the same predicate", () => {
    const sac = row(
      9_300,
      LogEvent.DAMAGE_SPLIT,
      "ally",
      "Blessing of Sacrifice",
      50,
    );
    const shot = row(9_300, LogEvent.SPELL_DAMAGE, "druid", "Starsurge");
    const byId = (id: string) =>
      id === "ally" ? { damageIn: [shot] } : undefined;
    expect(playerKillingBlow(unit([sac]), 9_300, byId)?.spellName).toBe(
      "Starsurge",
    );
    expect(playerKillingBlow(unit([sac]), 9_300)).toBeUndefined();
    // codex F20-21 (d8a6e7cb): an overkill row the unit lived through — a
    // later reading above 0 HP — is no killing blow
    const tick = row(
      9_000,
      LogEvent.SPELL_PERIODIC_DAMAGE,
      "mage",
      "Refraction",
      6,
    );
    const reading = (ms: number, hp: number) => ({
      advancedActorCurrentHp: hp,
      logLine: { timestamp: ms },
    });
    const lived = {
      ...unit([tick]),
      advancedActions: [reading(9_000, 1), reading(9_329, 1_141)],
    } as never;
    expect(playerKillingBlow(lived, 9_400)).toBeUndefined();
    const died = {
      ...unit([tick]),
      advancedActions: [reading(9_000, 0), reading(9_200, 0)],
    } as never;
    expect(playerKillingBlow(died, 9_028)?.spellName).toBe("Refraction");
    expect(isAttackerDamageRow(sac)).toBe(false);
    expect(isAttackerDamageRow(shot)).toBe(true);
  });

  it("Roar of Sacrifice's share is a transfer logged as SPELL_DAMAGE (bdce91c4 3:02)", () => {
    // the pet's overkill row comes from the Paladin its Roar sits on; the
    // enemy's Lunar Storm on the Paladin 24 ms earlier moved it
    const roar = {
      ...row(34_559, LogEvent.SPELL_DAMAGE, "paladin", "Roar of Sacrifice", 20),
      spellId: "67481",
    } as Hit;
    const storm = row(34_535, LogEvent.SPELL_DAMAGE, "hunter", "Lunar Storm");
    const byId = (id: string) =>
      id === "paladin" ? { damageIn: [storm] } : undefined;
    expect(isAttackerDamageRow(roar)).toBe(false);
    expect(nonPlayerUnitKill(unit([roar]), byId)?.finalBlow).toBe(storm);
    expect(nonPlayerUnitKill(unit([roar]))?.finalBlow).toBeUndefined();
  });
});

describe("CRITICAL_NON_PLAYER_NPC_IDS", () => {
  // A test that pins a dead id manufactures confidence (CLAUDE.md, GH #23):
  // 121111 occurs 0 times in 600 12.1 files, 101398 was summoned 305 times.
  it("carries the live Psyfiend npcId and not the stale one", () => {
    expect(CRITICAL_NON_PLAYER_NPC_IDS.has("101398")).toBe(true);
    expect(CRITICAL_NON_PLAYER_NPC_IDS.has("121111")).toBe(false);
  });

  it("carries the live Pit Lord npcId and none of the five retired units", () => {
    expect(CRITICAL_NON_PLAYER_NPC_IDS.has("228574")).toBe(true);
    for (const dead of [
      "196111",
      "100943",
      "10467",
      "108270",
      "189820",
      "179193",
    ])
      expect(CRITICAL_NON_PLAYER_NPC_IDS.has(dead)).toBe(false);
  });
});

describe("contestable enemy summons (BACKLOG #51, user ruling 2026-09-20)", () => {
  it("is a subset of the critical NPC table, so it rides on the same rot check", () => {
    for (const id of CONTESTABLE_ENEMY_SUMMON_NPC_IDS)
      expect(CRITICAL_NON_PLAYER_NPC_IDS.has(id)).toBe(true);
    // deliberately NOT here: 85 % / 72 % of these are never touched
    expect(CONTESTABLE_ENEMY_SUMMON_NPC_IDS.has("5913")).toBe(false); // Tremor
    expect(CONTESTABLE_ENEMY_SUMMON_NPC_IDS.has("5925")).toBe(false); // Grounding
  });

  it("summonedAtMs reads the unit's own SPELL_SUMMON, else null", () => {
    const u = {
      actionIn: [
        { logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: 900 } },
        { logLine: { event: LogEvent.SPELL_SUMMON, timestamp: 1000 } },
      ],
    } as unknown as ICombatUnit;
    expect(summonedAtMs(u)).toBe(1000);
    expect(summonedAtMs({ actionIn: [] } as unknown as ICombatUnit)).toBeNull();
  });

  it("opposingHitsOnUnit counts only the other side's damage events", () => {
    const FRIENDLY = 0x511;
    const HOSTILE = 0x548;
    const d = (srcUnitId: string, srcUnitFlags: number) =>
      ({ srcUnitId, srcUnitFlags }) as unknown as Hit;
    const psyfiend = {
      damageIn: [
        d("A", FRIENDLY),
        d("A", FRIENDLY),
        d("B", FRIENDLY),
        d("E", HOSTILE),
      ],
    } as unknown as ICombatUnit;
    const r = opposingHitsOnUnit(psyfiend, CombatUnitReaction.Hostile);
    expect(r.hits).toBe(3);
    expect(r.hitters).toEqual(["A", "B"]);
    expect(
      opposingHitsOnUnit(
        { damageIn: [] } as unknown as ICombatUnit,
        CombatUnitReaction.Hostile,
      ).hits,
    ).toBe(0);
  });
});
