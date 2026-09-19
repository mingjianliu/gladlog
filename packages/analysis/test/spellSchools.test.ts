/**
 * GH #29 阶段 1:官方学派掩码取代「纯魔法免疫挡不住物理控」那条单向手工规则。
 *
 * 生产症状(250 场实测 2 条):产品建议用**保护祝福**躲 **Sleep Walk** —— 保护
 * 祝福的 SCHOOL_IMMUNITY 掩码是 1(仅物理),Sleep Walk 是 8(自然系魔法)。
 * 原规则只有「魔法免疫 × 物理控」一个方向,没有反向,所以拦不住。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  immunityCoversSpell,
  immunityMechanics,
  immunitySchoolMask,
  isPhysicalSpell,
  spellSchoolMask,
} from "../src/data/spellSchools";
import { applicableCCAvoidanceIds } from "../src/utils/ccTrinketAnalysis";

// 官方数据动态载入:先 await 聚合入口(与 prompt 路径同一契约)
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("官方学派事实", () => {
  it("控制技能的学派按官方 SchoolMask —— 手工物理表漏掉的魔法控也认得出", () => {
    expect(isPhysicalSpell("408")).toBe(true); // 肾击
    expect(isPhysicalSpell("119381")).toBe(true); // 扫堂腿
    expect(isPhysicalSpell("853")).toBe(false); // 制裁之锤(神圣)—— 手工表里没有
    expect(isPhysicalSpell("118")).toBe(false); // 变形术(奥术)
    expect(spellSchoolMask("360806")).toBe(8); // Sleep Walk(自然)
  });

  it("免疫掩码分得清「挡全部」「只挡物理」「只挡魔法」", () => {
    expect(immunitySchoolMask("642")).toBe(127); // 圣盾术:全学派
    expect(immunitySchoolMask("1022")).toBe(1); // 保护祝福:仅物理
    expect(immunitySchoolMask("204018")).toBe(126); // 驱邪祝福:全魔法
  });

  it("immunityCoversSpell 三态:两边都知道才判定,官方缺数据返回 undefined", () => {
    expect(immunityCoversSpell("1022", "360806")).toBe(false); // 保护祝福挡不住自然系控
    expect(immunityCoversSpell("1022", "408")).toBe(true); // 挡得住物理控
    expect(immunityCoversSpell("642", "360806")).toBe(true); // 圣盾术全挡
    expect(immunityCoversSpell("204018", "408")).toBe(false); // 驱邪祝福挡不住物理
    // 反魔法护罩靠吸收(aura69),没有 aura39 行 → 未知,调用方回退手工规则
    expect(immunityCoversSpell("48707", "408")).toBeUndefined();
  });

  it("多学派法术要求完全覆盖:混沌新星(124)被全魔法免疫挡住,被纯物理免疫挡不住", () => {
    expect(spellSchoolMask("179057")).toBe(124);
    expect(immunityCoversSpell("204018", "179057")).toBe(true);
    expect(immunityCoversSpell("1022", "179057")).toBe(false);
  });

  it("immunityMechanics: 官方机制免疫(EffectAura 77)", () => {
    // 冰封之韧: 机制 12 = 昏迷 (Stun)
    expect(immunityMechanics("48792")).toEqual([12]);
    // 自由祝福: 机制 7 = 减速 (Snare), 11 = 定身 (Root)
    expect(immunityMechanics("1044")).toEqual([7, 11]);
    // 狂暴之怒: 机制 5, 14, 23, 30
    expect(immunityMechanics("18499")).toEqual([5, 14, 23, 30]);
    // 猎豹形态: 机制 17 = 变形 (Polymorph)
    expect(immunityMechanics("768")).toEqual([17]);
    // 圣盾术: 机制免疫为空(它走的是全学派免疫 immuneSchools 127)
    expect(immunityMechanics("642")).toBeUndefined();
    // 未知技能返回 undefined
    expect(immunityMechanics("99999999")).toBeUndefined();
  });
});

describe("applicableCCAvoidanceIds(接线后)", () => {
  it("魔法控不再推荐纯物理免疫(生产 bug 的确定性复现)", () => {
    expect(applicableCCAvoidanceIds("360806", "Sleep Walk").has("1022")).toBe(
      false,
    );
    expect(applicableCCAvoidanceIds("118", "Polymorph").has("1022")).toBe(
      false,
    );
    expect(
      applicableCCAvoidanceIds("853", "Hammer of Justice").has("1022"),
    ).toBe(false);
    // 全学派免疫照常推荐
    expect(applicableCCAvoidanceIds("360806", "Sleep Walk").has("642")).toBe(
      true,
    );
  });

  it("物理控:纯物理免疫推荐,纯魔法免疫不推荐(原规则的方向保持不变)", () => {
    const opts = applicableCCAvoidanceIds("408", "Kidney Shot");
    expect(opts.has("1022")).toBe(true); // 保护祝福
    expect(opts.has("204018")).toBe(false); // 驱邪祝福(全魔法)
    expect(opts.has("48707")).toBe(false); // 反魔法护罩(官方无 aura39 → 走手工回退)
  });
});
