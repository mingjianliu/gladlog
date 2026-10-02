import { describe, expect, it } from "vitest";

import { SPELL_EFFECTS_GENERATED } from "./spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "./spellEffectOverrides";
import { spellEffectData } from "./spellEffectData";

/**
 * 双层合并的字段级契约(2026-08-19,GH 见 12.1 电池报告)。
 *
 * 历史:{...GENERATED, ...OVERRIDES} 是整对象替换 —— override 的 e() 条目
 * 从不写 dispelType,于是 7 个官方 dispelType(冰箱/神圣之盾的 Magic、
 * 死亡印记的 Bleed…)被静默吞掉,getDispelType 判它们「不可驱」,而 12.1
 * 实战 147 场里冰箱被群体驱散 30 次。同一遮蔽 bug 在 2026-07-25 被
 * spellEffectOverrides.ts 的 DISPEL_TYPES 补丁循环修过一次,但没覆盖主表。
 */
describe("spellEffectData 双层合并:dispelType 字段级恢复", () => {
  it("被 override 的 id 保留生成层 dispelType(冰箱 Magic / 死亡印记 Bleed),同时校准字段仍由 override 说了算", () => {
    // Ice Block: override 手工 cd=240/dur=10,生成层 dispelType=Magic(群体驱散可解)
    expect(spellEffectData["45438"]?.dispelType).toBe("Magic");
    expect(spellEffectData["45438"]?.cooldownSeconds).toBe(240);
    // Deathmark: override 手工 cd=120/dur=16,生成层 dispelType=Bleed(灼烧之焰可解)
    expect(spellEffectData["360194"]?.dispelType).toBe("Bleed");
    expect(spellEffectData["360194"]?.cooldownSeconds).toBe(120);
  });

  it("穷尽检查:任何有生成层 dispelType 的被 override id 都不得丢字段(防第三次同类回归)", () => {
    for (const id of Object.keys(SPELL_EFFECT_OVERRIDES)) {
      const gen = (
        SPELL_EFFECTS_GENERATED as Record<string, { dispelType?: string }>
      )[id];
      if (gen?.dispelType == null) continue;
      expect(
        spellEffectData[id]?.dispelType,
        `override id ${id} 应保留生成层 dispelType=${gen.dispelType}`,
      ).toBe(gen.dispelType);
    }
  });

  it("范围 pin:校准字段(charges)不做恢复 —— override 的沉默是手工建模选择,生成层 1×180s 与校准 210s 是两套模型不能混", () => {
    // Shield Wall: 生成层 charges 1×180s,override 校准单 cd 210s。
    // 恢复 charges 会让 chargesAvailableAt 按生成层的充能回转混算 —— 比
    // 遮蔽更错。若将来要多充能,需在 override 里显式写 charges。
    // (2026-10-01 之前这条钉在符文武器增效 47568 上;它的 override 已删,见下。)
    expect(spellEffectData["871"]?.cooldownSeconds).toBe(210);
    expect(spellEffectData["871"]?.charges).toBeUndefined();
  });

  it("符文武器增效 47568 不再有手工 override:按 DB2 是 2 充能 / 30 s 回转、无持续时间(triage kick-eaten F-K2,裁决 C7)", () => {
    // 12.x 里它是循环伤害按钮:605 个 S2 文件 392 次施放、0 次光环。回填
    // 120 s / 20 s 会让它重新变成「爆发窗口」。
    expect(SPELL_EFFECT_OVERRIDES["47568"]).toBeUndefined();
    expect(spellEffectData["47568"]?.cooldownSeconds).toBeUndefined();
    expect(spellEffectData["47568"]?.durationSeconds).toBeUndefined();
    expect(spellEffectData["47568"]?.charges).toEqual({
      charges: 2,
      chargeCooldownSeconds: 30,
    });
  });
});
