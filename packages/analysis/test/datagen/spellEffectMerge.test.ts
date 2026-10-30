import { spellEffectData } from "../../src/data/spellEffectData";
import { SPELL_EFFECTS_GENERATED } from "../../src/data/spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "../../src/data/spellEffectOverrides";

describe("spellEffectData 双层合并", () => {
  it("overrides 全部键保留于合并结果(校准字段覆盖层赢;dispelType 可由生成层补足 —— 2026-08-19 字段级契约,见 src/data/spellEffectData.test.ts)", () => {
    for (const [id, entry] of Object.entries(SPELL_EFFECT_OVERRIDES)) {
      const merged = spellEffectData[id]!;
      // 校准字段(cd/duration/charges/name)必须与 override 逐字一致 ——
      // 这是覆盖层存在的意义;dispelType 是官方独有字段,override 沉默时
      // 由生成层补足(整对象 toEqual 曾把这 7 个官方 dispelType 一起钉死
      // 在「被吞」状态,是回归测试反过来保护 bug 的形状)。
      expect(merged.cooldownSeconds).toEqual(entry.cooldownSeconds);
      expect(merged.durationSeconds).toEqual(entry.durationSeconds);
      expect(merged.charges).toEqual(entry.charges);
      expect(merged.name).toEqual(entry.name);
      if (entry.dispelType !== undefined)
        expect(merged.dispelType).toEqual(entry.dispelType);
    }
  });

  it("生成层独有键存在于合并结果", () => {
    const genOnly = Object.keys(SPELL_EFFECTS_GENERATED).find(
      (id) => !(id in SPELL_EFFECT_OVERRIDES),
    );
    expect(genOnly).toBeDefined();
    expect(spellEffectData[genOnly!]).toEqual(
      SPELL_EFFECTS_GENERATED[genOnly!],
    );
  });

  it("生成层规模下限(候选集挖掘产物非空)", () => {
    expect(Object.keys(SPELL_EFFECTS_GENERATED).length).toBeGreaterThan(300);
  });
});
