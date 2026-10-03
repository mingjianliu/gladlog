import { describe, expect, it } from "vitest";

import { MITIGATION_TABLE } from "../src/data/mitigationData";
import { SPELL_CATEGORIES } from "../src/data/spellCategories";
import { IMMUNITY_SPELLS } from "../src/utils/deathOutcomeAnalysis";
import {
  FULL_IMMUNITY_IDS,
  IMMUNITY_IDS,
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
