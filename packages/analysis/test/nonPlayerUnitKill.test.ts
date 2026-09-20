import type { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  CRITICAL_NON_PLAYER_NPC_IDS,
  nonPlayerUnitKill,
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
