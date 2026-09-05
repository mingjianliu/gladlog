import { describe, expect, it } from "vitest";

import { CURATED_ID_TABLES } from "../src/data/curatedIdRegistry";

// The registry is the index the Curated-List Completeness Rule's reverse pass
// runs over. A table that yields nothing, or yields non-ids, would be silently
// "100% healthy" in the scan — pin the shape so the scan cannot lie by omission.
// 故意为空的表:空表在扫描里长得和「100% 健康」一模一样,所以默认禁止 —— 但
// 「豁免名单被清空」本身是好事(注释里就写着 once the data is filled in 就删掉),
// 不能因此把表从登记册里摘出去,那会制造出登记册专门要防的「没登记的手工名单」。
// 所以空是允许的,但必须**具名**在这里,连带写清是谁在哪天把它清空的。
const DELIBERATELY_EMPTY: Record<string, string> = {
  // 2026-08-23 用户裁定「燃烧不能偷」:190319 不是「缺 dispelType 数据暂时发不出」,
  // 是根本偷不掉(归档 400 文件:上身 440 次、被偷 0 次),连同上游白名单一起摘掉,
  // 于是这张豁免表空了。下次 DB2 刷新出新的「查不到 dispelType」条目时会重新长出来。
  PURGE_WHITELIST_DATA_BLOCKED: "2026-08-23 燃烧摘除后清空",
  // 2026-09-04 BACKLOG #41 (8):生成器改读命名位后,378「Allow While Stunned by Stun
  // Mechanic」直接覆盖了这层的三条(498 / 403876 / 51490),手工层清空;下次真出现
  // 官方位表达不了的晕中可用技能时会重新长出来(签字记录仍在 curatedAbilityFacts)。
  USABLE_WHILE_CC_GAP_IDS: "2026-09-04 命名位 378 覆盖后清空",
};

describe("CURATED_ID_TABLES", () => {
  it("has unique names and every table yields at least one numeric id", () => {
    const names = CURATED_ID_TABLES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of CURATED_ID_TABLES) {
      const ids = t.ids();
      if (t.name in DELIBERATELY_EMPTY) {
        expect(
          ids.length,
          `${t.name} 已具名为故意为空,一旦重新长出条目就把它从 DELIBERATELY_EMPTY 里删掉`,
        ).toBe(0);
        continue;
      }
      expect(ids.length, t.name).toBeGreaterThan(0);
      for (const id of ids) expect(id, `${t.name}: ${id}`).toMatch(/^\d+$/);
    }
  });
  it("covers the lists that have already rotted once (GH #23 class)", () => {
    // Each of these silently swallowed official data or went stale in 2026-07/08.
    for (const n of [
      "DISPEL_PENALTY_SPELLS",
      "TALENT_BEHAVIORS",
      "SPELL_CATEGORIES",
      "RACIAL_ABILITIES",
    ])
      expect(
        CURATED_ID_TABLES.some((t) => t.name === n),
        n,
      ).toBe(true);
  });
});
