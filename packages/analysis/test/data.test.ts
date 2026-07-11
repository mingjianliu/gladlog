import { SPELL_EFFECT_OVERRIDES } from "../src/data/spellEffectOverrides";
import {
  getEnglishSpellName,
  spellEffectData,
} from "../src/data/spellEffectData";
import { ccSpellIds } from "../src/data/spellTags";
import { DISCOVERY_TAG_RULES } from "../src/data/discoveryRules";
import { DISPEL_FEATURE_FLAGS } from "../src/data/dispelFeatureFlags";

describe("data layer", () => {
  it("overrides:每条含 cooldown 或 duration 至少其一,id 键一致", () => {
    const entries = Object.entries(SPELL_EFFECT_OVERRIDES);
    expect(entries.length).toBeGreaterThan(60);
    for (const [id, s] of entries) {
      expect(s.spellId).toBe(id);
      expect(s.cooldownSeconds ?? s.durationSeconds).toBeDefined();
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
});
