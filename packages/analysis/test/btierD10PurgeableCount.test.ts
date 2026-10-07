/**
 * B-tier D10 B13e (user ruling 2026-10-07; the priority table is untouched):
 * purge lines and missed-purge lines say how many purgeable buffs — official
 * dispel type Magic — the enemy carried. A purge removes one of them and the
 * player does not pick which.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  getDispelType,
  PURGE_BLOCKLIST,
  purgeableBuffCountAt,
  purgeableBuffIntervals,
  purgeableCountText,
  UNPURGEABLE_MAGIC_AURAS,
} from "../src/utils/dispelAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const combat = { startTime: START, endTime: at(300) };

const FORTITUDE = "21562"; // Magic, a raid buff on the blocklist
const HOT_STREAK = "48108"; // Magic
const DIVINE_SHIELD = "642"; // Magic, unpurgeable
const RENEW = "139"; // Magic
const ENRAGE = "184362"; // an enrage — not Magic

const aura = (
  event: LogEvent,
  spellId: string,
  s: number,
  src: string,
  type: "BUFF" | "DEBUFF" | null = "BUFF",
): any => ({
  spellId,
  spellName: spellId,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: "e1",
  destUnitName: "Enemy-Realm",
  timestamp: at(s),
  logLine: {
    event,
    timestamp: at(s),
    parameters: type === null ? [] : Array(11).fill("").concat(type),
  },
});
const unit = (auraEvents: any[]): any => ({
  id: "e1",
  name: "Enemy-Realm",
  auraEvents,
  spellCastEvents: [],
});
const SIDE = new Set(["e1", "e2"]);
const countAt = (auras: any[], s: number) =>
  purgeableBuffCountAt(purgeableBuffIntervals(unit(auras), SIDE, combat), s);

describe("the official types the fixture relies on", () => {
  it("DB2 dispel types", () => {
    for (const id of [FORTITUDE, HOT_STREAK, DIVINE_SHIELD, RENEW])
      expect(getDispelType(id)).toBe("Magic");
    expect(getDispelType(ENRAGE)).not.toBe("Magic");
  });
});

describe("UNPURGEABLE_MAGIC_AURAS", () => {
  it("is a subset of the blocklist (one table, one split), and leaves the raid buffs out", () => {
    for (const id of UNPURGEABLE_MAGIC_AURAS)
      expect(PURGE_BLOCKLIST.has(id)).toBe(true);
    for (const raidBuff of ["21562", "1459", "1126", "462854"]) {
      expect(PURGE_BLOCKLIST.has(raidBuff)).toBe(true);
      expect(UNPURGEABLE_MAGIC_AURAS.has(raidBuff)).toBe(false);
    }
  });
});

describe("purgeableBuffIntervals / purgeableBuffCountAt", () => {
  const A = LogEvent.SPELL_AURA_APPLIED;
  const R = LogEvent.SPELL_AURA_REMOVED;

  it("counts Magic buffs, raid buffs included; not an enrage, not an unpurgeable shell, not a debuff", () => {
    const auras = [
      aura(A, FORTITUDE, 1, "e2"),
      aura(A, HOT_STREAK, 10, "e1"),
      aura(A, RENEW, 12, "e2"),
      aura(A, ENRAGE, 12, "e1"),
      aura(A, DIVINE_SHIELD, 12, "e1"),
      // our Magic debuff on the enemy is not a buff
      aura(A, "118", 12, "us", "DEBUFF"),
    ];
    expect(countAt(auras, 15)).toBe(3);
    expect(countAt(auras, 5)).toBe(1);
  });

  it("the removed buff still counts at its removal, the missed one at its application; a second later it does not", () => {
    const auras = [
      aura(A, FORTITUDE, 1, "e2"),
      aura(A, HOT_STREAK, 10, "e1"),
      aura(R, HOT_STREAK, 20, "e1"),
    ];
    expect(countAt(auras, 10)).toBe(2);
    expect(countAt(auras, 20)).toBe(2);
    expect(countAt(auras, 21)).toBe(1);
    expect(countAt(auras, 9)).toBe(1);
  });

  it("two stacks / re-applications of one buff are one buff", () => {
    const auras = [
      aura(A, RENEW, 10, "e2"),
      aura(R, RENEW, 12, "e2"),
      aura(A, RENEW, 12, "e2"),
    ];
    expect(countAt(auras, 12)).toBe(1);
  });

  it("a stolen buff keeps its first caster as the source and is still a buff on the unit (69546267 round 3)", () => {
    expect(countAt([aura(A, RENEW, 10, "us")], 11)).toBe(1);
  });

  it("a row with no BUFF / DEBUFF marker counts only when the unit's own side put it there", () => {
    expect(countAt([aura(A, RENEW, 10, "e2", null)], 11)).toBe(1);
    expect(countAt([aura(A, RENEW, 10, "us", null)], 11)).toBe(0);
  });
});

describe("purgeableCountText", () => {
  it("singular, plural, absent", () => {
    expect(purgeableCountText(1)).toBe("1 purgeable buff");
    expect(purgeableCountText(4)).toBe("4 purgeable buffs");
    expect(purgeableCountText(undefined)).toBe("");
  });
});
