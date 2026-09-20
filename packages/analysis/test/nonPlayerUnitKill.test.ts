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
