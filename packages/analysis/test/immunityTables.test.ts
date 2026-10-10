import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { isKillWindowMajorDefensive } from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import { SPELL_CATEGORIES } from "../src/data/spellCategories";
import { ENEMY_PROC_SAVES } from "../src/data/spellIdLists";
import {
  immunityMechanics,
  immunitySchoolMask,
} from "../src/data/spellSchools";
import { immunityBreak } from "../src/utils/ccTrinketAnalysis";
import { IMMUNITY_SPELLS } from "../src/utils/deathOutcomeAnalysis";
import {
  FEIGN_DEATH_ABSORB_AURA_IDS,
  FULL_IMMUNITY_IDS,
  IMMUNITY_IDS,
  isImmunitySaveAura,
  MITIGATION_AURA_IDS,
  SCHOOL_LIMITED_IMMUNITY_IDS,
} from "../src/utils/enemyDefensives";

/**
 * 免疫三表一致性(2026-08-21,接地审计 D1 的最后一块残留)。
 *
 * 「什么算免疫」曾有四张手打表、8 个 id 只有 3 个四表一致(审计 D1 背景);
 * D1 修复删掉了 offensiveWasteAnalysis 的两张,剩下三处此前**无任何跨表
 * 测试**。本文件把权威定为官方减伤表(MITIGATION_TABLE,mitigationVerdicts
 * 逐条签字),两条派生关系钉死:
 *
 *  1. deathOutcomeAnalysis.IMMUNITY_SPELLS ≡ 权威表里 pct=100 ∧ schoolMask
 *     全学派(0x7f)的条目 —— 死亡语境的「免疫可救」不做击杀学派判定,
 *     学派限定免疫(BoP/斗篷/护佑)进来就会对错误学派的死亡撒谎;
 *     47585 分散(75% 减伤)曾在此表冒充免疫,2026-08-21 依 D1 裁定移除。
 *  2. SPELL_CATEGORIES 里 type="immunities" 的 id 集 ≡ 权威表 pct=100 全集
 *     (含学派限定)—— 光环分类只管「这是个免疫壳」,学派归 schoolMask 管。
 *
 * killAttempts.ts 的 IMMUNITY_IDS 已直接从权威表派生(单源),无需另钉。
 * 三表任何一侧手工增删,本测试红 —— 修法永远是改权威表(签字)再让派生
 * 侧跟随,不是反向。
 */
describe("免疫三表一致性(权威 = MITIGATION_TABLE pct=100)", () => {
  const authority = Object.entries(MITIGATION_TABLE).filter(
    ([, e]) => e.pct === 100,
  );
  const fullSchool = authority
    .filter(([, e]) => e.schoolMask === 0x7f)
    .map(([id]) => id)
    .sort();
  const allImmunities = authority.map(([id]) => id).sort();

  it("权威表非空且全学派免疫是其子集(测试自检)", () => {
    expect(allImmunities.length).toBeGreaterThanOrEqual(4);
    for (const id of fullSchool) expect(allImmunities).toContain(id);
  });

  it("deathOutcome IMMUNITY_SPELLS ≡ 权威表全学派免疫(双向,无多无漏)", () => {
    expect(Object.keys(IMMUNITY_SPELLS).sort()).toEqual(fullSchool);
  });

  it("the split of IMMUNITY_IDS (ruling F-K9b-B, 2026-10-02): full ≡ the every-school rows, school-limited ≡ the rest, nothing in both, nothing in neither", () => {
    expect([...FULL_IMMUNITY_IDS].sort()).toEqual(fullSchool);
    expect([...FULL_IMMUNITY_IDS].sort()).toEqual(
      Object.keys(IMMUNITY_SPELLS).sort(),
    );
    expect(
      [...FULL_IMMUNITY_IDS, ...SCHOOL_LIMITED_IMMUNITY_IDS].sort(),
    ).toEqual([...IMMUNITY_IDS].sort());
    for (const id of SCHOOL_LIMITED_IMMUNITY_IDS)
      expect(FULL_IMMUNITY_IDS.has(id)).toBe(false);
    // the six rows as ruled: a seventh pct-100 row must be looked at before
    // it lands on either side
    expect([...FULL_IMMUNITY_IDS].sort()).toEqual(["186265", "45438", "642"]);
    expect([...SCHOOL_LIMITED_IMMUNITY_IDS].sort()).toEqual([
      "1022",
      "204018",
      "31224",
    ]);
  });

  it("SPELL_CATEGORIES immunities ≡ 权威表 pct=100 全集(双向,无多无漏)", () => {
    const categorized = Object.entries(SPELL_CATEGORIES)
      .filter(([, v]) => (v as { type?: string }).type === "immunities")
      .map(([id]) => id)
      .sort();
    expect(categorized).toEqual(allImmunities);
  });
});

/**
 * FT-T07, user ruling D8 (2026-10-10): Feign Death (an absorb), Nature's
 * Guardian (a heal proc), Cheat Death and Cauterize (cheat-death procs) are
 * no immunity. The two readers that DID read them as one — the `[ENEMY DEF]`
 * line and the KILL ATTEMPTS attribution — are changed and tested with their
 * own suites. This pins the rest of the inventory: every other reader that
 * asks "can this unit be damaged right now" or "did this press end a CC on
 * its holder" keys on one of the sets below, and none of them holds the four
 * — their logged ids, Feign Death's cast id, or the talents' own ids:
 *
 *   IMMUNITY_IDS                → `immunityBreak` (a press that ended a CC),
 *                                 `limitedImmunitySchoolMask`
 *   FULL_IMMUNITY_IDS           → burst ledger `isImmunity`, kick-eaten's
 *                                 low-HP skip (`fullImmunityIntervals`), the
 *                                 POSITIONING skip (`isOwnImmunityInterval`)
 *   IMMUNITY_SPELLS             → death recap "an immunity could have saved"
 *   SPELL_CATEGORIES immunities → burst ledger defensives, dispel priority
 *   kill-window major defensive → `[KILL WINDOW]` defenseless spans, burst
 *                                 ledger defensives
 *   MITIGATION_AURA_IDS         → KILL ATTEMPTS `popped X`, `[ENEMY DEF]` %
 */
describe("ruling D8: the effect saves sit in no immunity / wall set another reader keys on", () => {
  const LOGGED = [
    ...FEIGN_DEATH_ABSORB_AURA_IDS,
    ...Object.keys(ENEMY_PROC_SAVES),
  ];
  // Feign Death's cast, and the talents behind the three procs
  const UNLOGGED = ["5384", "30884", "31230", "86949"];

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the four logged ids are the ones the ruling names", () => {
    expect([...LOGGED].sort()).toEqual(["202748", "31616", "45182", "87023"]);
  });

  it.each([...LOGGED, ...UNLOGGED])("%s is in none of them", (id) => {
    expect(IMMUNITY_IDS.has(id)).toBe(false);
    expect(FULL_IMMUNITY_IDS.has(id)).toBe(false);
    expect(SCHOOL_LIMITED_IMMUNITY_IDS.has(id)).toBe(false);
    expect(isImmunitySaveAura(id)).toBe(false);
    expect(id in IMMUNITY_SPELLS).toBe(false);
    expect(id in MITIGATION_TABLE).toBe(false);
    expect(MITIGATION_AURA_IDS.has(id)).toBe(false);
    expect(
      (SPELL_CATEGORIES as Record<string, { type?: string }>)[id]?.type,
    ).not.toBe("immunities");
    expect(isKillWindowMajorDefensive(id)).toBe(false);
    // DB2: no school immunity (aura 39) and no mechanic immunity on it
    expect(immunitySchoolMask(id)).toBeUndefined();
    expect(immunityMechanics(id)).toBeUndefined();
  });

  it("immunityBreak: a cast of one of them at the instant a CC ended is not 'an immunity press ended it' (Divine Shield is)", () => {
    const START = Date.UTC(2026, 9, 10);
    const cc = { atSeconds: 10, durationSeconds: 3 };
    const pressAtEnd = (spellId: string) => ({
      id: "p1",
      spellCastEvents: [
        {
          spellId,
          spellName: `S${spellId}`,
          destUnitId: "p1",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: START + 13_000,
            parameters: [],
          },
        },
      ],
    });
    expect(immunityBreak(cc, START, pressAtEnd("642") as never)?.spellId).toBe(
      "642",
    );
    for (const id of [...LOGGED, ...UNLOGGED])
      expect(immunityBreak(cc, START, pressAtEnd(id) as never), id).toBeNull();
  });
});
