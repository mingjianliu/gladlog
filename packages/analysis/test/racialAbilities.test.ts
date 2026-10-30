import { describe, expect, it } from "vitest";

import { spellClassMap } from "../src/data/drCategories";
import {
  BREAK_RACIAL_SPELL_IDS,
  OFFENSIVE_RACIAL_SPELL_IDS,
  RACIAL_ABILITIES,
  racialName,
} from "../src/data/racialAbilities";
import { spellEffectData } from "../src/data/spellEffectData";

describe("racialAbilities 表", () => {
  it("每个种族技能都能在官方生成表里查到冷却(datagen candidate 已收录)", () => {
    const missing = Object.keys(RACIAL_ABILITIES).filter(
      (id) => !spellEffectData[id],
    );
    expect(missing).toEqual([]);
  });

  it("break/offensive 子集非空且互不重叠", () => {
    expect(BREAK_RACIAL_SPELL_IDS.size).toBeGreaterThan(0);
    expect(OFFENSIVE_RACIAL_SPELL_IDS.size).toBeGreaterThan(0);
    for (const id of BREAK_RACIAL_SPELL_IDS)
      expect(OFFENSIVE_RACIAL_SPELL_IDS.has(id)).toBe(false);
  });

  it("名字取自官方 DB2(生成表)而不是手写", () => {
    for (const [id, a] of Object.entries(RACIAL_ABILITIES)) {
      expect(spellEffectData[id]!.name).toBe(a.name);
      expect(racialName(id)).toBe(a.name);
    }
  });

  it("非种族 id 返回 null", () => {
    expect(racialName("336126")).toBeNull(); // 角斗士勋章是饰品
  });

  it("DR 归属只认官方表:种族 CC 不在 drCategories 里的不许手加", () => {
    // 判据:凡 kind==='cc' 的种族技能,其 DR 归属必须与官方生成的
    // spellClassMap 一致 —— 本测试锁死「Bull Rush 无 DiminishType」这个官方
    // 事实(2026-08-12 探针:255654/357214/368970 官方无 DR),防止后人凭记忆
    // 把它们塞进 DR 补充表。
    const inDr = new Set<string>();
    for (const list of Object.values(spellClassMap.diminishingReturns ?? {}))
      for (const e of list as Array<{ spellId: string }>) inDr.add(e.spellId);
    expect(inDr.has("20549")).toBe(true); // War Stomp:官方 Stun
    expect(inDr.has("107079")).toBe(true); // Quaking Palm:官方 Incapacitate
    expect(inDr.has("255654")).toBe(false); // Bull Rush:官方无 DiminishType
  });
});
