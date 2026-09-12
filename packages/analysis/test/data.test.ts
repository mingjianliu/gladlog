import { SPELL_EFFECT_OVERRIDES } from "../src/data/spellEffectOverrides";
import {
  getEnglishSpellName,
  spellEffectData,
} from "../src/data/spellEffectData";
import { ccSpellIds } from "../src/data/spellTags";
import { CANDIDATE_TYPE_FLAGS } from "../src/data/candidateTypeFlags";
import { DISCOVERY_TAG_RULES } from "../src/data/discoveryRules";
import { DISPEL_FEATURE_FLAGS } from "../src/data/dispelFeatureFlags";

describe("data layer", () => {
  it("overrides:每条含 cooldown 或 duration 至少其一,id 键一致", () => {
    const entries = Object.entries(SPELL_EFFECT_OVERRIDES);
    expect(entries.length).toBeGreaterThan(60);
    for (const [id, s] of entries) {
      expect(s.spellId).toBe(id);
      expect(
        s.cooldownSeconds ??
          s.durationSeconds ??
          (s as { dispelType?: string }).dispelType,
      ).toBeDefined();
      expect(s.name.length).toBeGreaterThan(0);
    }
  });
  it("spellEffectData 由 overrides 供数(抽查 642 神圣之盾)", () => {
    expect(spellEffectData["642"]?.cooldownSeconds).toBe(300);
    expect(spellEffectData["642"]?.durationSeconds).toBe(8);
  });
  it("getEnglishSpellName:overrides 命中、spellNames 命中、fallback 链", () => {
    expect(getEnglishSpellName("642")).toBeTruthy();
    expect(getEnglishSpellName("999999999", "回退名")).toBe("回退名");
    expect(getEnglishSpellName("999999999")).toBe("999999999");
  });
  it("spellTags/discoveryRules/dispelFeatureFlags 形状保持", () => {
    expect(ccSpellIds.size ?? Object.keys(ccSpellIds).length).toBeGreaterThan(
      0,
    );
    expect(DISCOVERY_TAG_RULES.length).toBeGreaterThan(0);
    expect(DISCOVERY_TAG_RULES[0]!.pattern).toBeInstanceOf(RegExp);
    expect(DISPEL_FEATURE_FLAGS).toBeDefined();
  });
  it("candidateTypeFlags(Task 9,2026-08-15 四个 P1/P2 起爆开关全量上线;2026-08-19 missedSyncWindow、2026-08-29 unsyncedBurst/missedPurge/ccHeld、2026-08-30 killReview/cdSpentIdle 下架);manaPressure/manaEfficiency 两开关已随候选退役删除(2026-08-21 管线审查第 3 条,#26 结案、后继 #33)", () => {
    expect(CANDIDATE_TYPE_FLAGS).toEqual({
      // 2026-09-02 复活(GH #13 撤销,用户裁定,重设计版)—— 见 candidateTypeFlags.ts 注
      missedSyncWindow: true,
      // 2026-08-29 降级为上下文事实(GH #50 (a),用户裁定)—— 见 candidateTypeFlags.ts 注
      unsyncedBurst: false,
      cdHoarded: true,
      // 2026-08-30 下架(信号结果探针,用户裁定)—— 见 candidateTypeFlags.ts 注
      cdSpentIdle: false,
      // 2026-08-18 击杀尝试重设计(GH #16):用户当日拍板接线,默认 true
      attemptIntoTrinket: true,
      // 2026-08-21 MD 特例(GH #25):四门判据用户当日拍板,默认 true
      mdCycloneWindow: true,
      // 2026-08-29 降级为上下文事实(GH #50 (a),用户裁定);此前 missed-purge 无开关
      missedPurge: false,
      ccHeld: false,
      killReview: false,
      // 2026-09-12 上线(GH #80,用户裁决「做出来看看是否对游戏建议有真正的帮助」)
      backlashDispel: true,
    });
  });
});
