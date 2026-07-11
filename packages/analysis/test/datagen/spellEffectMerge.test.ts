import { spellEffectData } from "../../src/data/spellEffectData";
import { SPELL_EFFECT_OVERRIDES } from "../../src/data/spellEffectOverrides";
import { SPELL_EFFECTS_GENERATED } from "../../src/data/spellEffectGenerated";

describe("spellEffectData 双层合并", () => {
  it("overrides 全部键逐字保留于合并结果(覆盖层赢)", () => {
    for (const [id, entry] of Object.entries(SPELL_EFFECT_OVERRIDES)) {
      expect(spellEffectData[id]).toEqual(entry);
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
