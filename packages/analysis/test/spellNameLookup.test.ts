import { describe, expect, test } from "vitest";

import { OBSERVED_SPELL_IDS } from "../src/data/observedSpellIds";
import { ensureSpellNames } from "../src/data/spellEffectData";
import { englishNameIndex } from "../src/data/spellNameLookup";
import { SPELL_NAME_STOPWORDS } from "../src/data/spellNameStopwords";
import { SPELL_NAMES_ZH_GENERATED } from "../src/data/spellNamesZh";

describe("spellNameLookup", () => {
  test("英文名倒排:载入后可查,仅图标集,id 升序", async () => {
    await ensureSpellNames();
    const idx = englishNameIndex();
    expect(idx).not.toBeNull();
    // 740 Tranquility: has an icon and a stable name
    expect(idx!.get("Tranquility")).toContain("740");
    // id 3 "Word of Mass Recall (OLD)" is in spellNames but not in the icon
    // set → it must not enter the index.
    // Note: the brief originally used id 1 "Word of Recall (OLD)", but that id
    // does appear in the corpus's observed set, which pulls it into the icon
    // generation universe, and Blizzard's DB2 assigns it the generic
    // placeholder icon trade_engineering (3213 of 41707 ids share that one
    // placeholder — the SpellIconFileDataID of old/removed spells has always
    // pointed at this default image). That is real data, not a bug in the
    // generator script, so this test switched to id 3, which is confirmed
    // genuinely absent from the icon set.
    expect(idx!.get("Word of Mass Recall (OLD)")).toBeUndefined();
    for (const ids of idx!.values()) {
      const nums = ids.map(Number);
      expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    }
  });

  test("超短名(<3 字符)不入索引 —— 实证 DB2 占位条目会撞车 AI 正文里的 30s/5s. 时长写法", async () => {
    await ensureSpellNames();
    const idx = englishNameIndex();
    expect(idx!.get("s")).toBeUndefined();
  });

  test("停用词撞车实证:Stun/Death 不入索引(审计 Critical——常见英文词撞车 DB2 罕见法术名,被 inlineRich.tsx 兜底成随机图标)", async () => {
    await ensureSpellNames();
    const idx = englishNameIndex();
    // "Stun" collides with ids 56/2880/17308/23454/34510, none of which was
    // ever observed in the corpus; the fallback picks the smallest id, 56 →
    // the generic hammer icon inv_mace_02, so plain prose like "full Stun" in
    // AI output gets wrapped as a spell icon — this case is the direct repro
    // that triggered this fix.
    expect(idx!.get("Stun")).toBeUndefined();
    // "Death" = id 327095 is in OBSERVED_SPELL_IDS, but it is a fringe
    // Shadowlands covenant effect (icon spell_necro_deathlyecho), not a
    // teaching-relevant ability of any class; f79e90c explicitly deferred this
    // category and promised a stopword-list escape hatch — this file is that
    // promise delivered.
    expect(idx!.get("Death")).toBeUndefined();
    // Added during review: all 47 candidate ids for "Heal" have zero
    // observations, and in a healer coaching product the bare word "Heal" is
    // the most likely near-term way this bug class recurs (flagged as a strong
    // add by the independent reviewer).
    expect(idx!.get("Heal")).toBeUndefined();
  });

  test("停用词表守卫(防未来 datagen 重跑复活):表里每个名字都必须真的从索引里消失,不是靠注释保证", async () => {
    await ensureSpellNames();
    const idx = englishNameIndex();
    expect(SPELL_NAME_STOPWORDS.size).toBeGreaterThan(0);
    for (const name of SPELL_NAME_STOPWORDS) {
      expect(idx!.get(name)).toBeUndefined();
    }
  });

  test("反例护栏:'Charge' 是真实语料常用技能,不该被停用词表误伤", async () => {
    await ensureSpellNames();
    const idx = englishNameIndex();
    expect(SPELL_NAME_STOPWORDS.has("Charge")).toBe(false);
    expect(idx!.get("Charge")).toBeDefined();
  });

  test("zh 表与 observed 集装载", () => {
    expect(SPELL_NAMES_ZH_GENERATED["740"]).toBe("宁静");
    // Power Word: Shield — guaranteed present in the corpus
    expect(OBSERVED_SPELL_IDS.has("17")).toBe(true);
  });
});
