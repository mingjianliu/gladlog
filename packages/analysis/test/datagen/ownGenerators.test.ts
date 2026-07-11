import { readFileSync } from "fs";
import { parseCsv } from "../../scripts/datagen/lib/wagoCsv";
import { extractTrinketIds } from "../../scripts/datagen/genTrinketItemIds";
import { CUSTOM_TALENT_MODIFIERS } from "../../scripts/datagen/customTalentModifiers";

const itemSparse = parseCsv(
  readFileSync(
    new URL("./fixtures/ItemSparse.mini.csv", import.meta.url).pathname,
    "utf-8",
  ),
).rows;

describe("genTrinketItemIds.extractTrinketIds", () => {
  it("按名称片段 + 饰品槽位分桶;非饰品同名行剔除", () => {
    const r = extractTrinketIds(itemSparse);
    expect(r.adaptationItemIds).toEqual(["181816"]);
    expect(r.relentlessItemIds).toEqual(["184058"]);
  });
});

describe("customTalentModifiers", () => {
  it("形状:Record<string, ICDModifier[]>,含 Guardian Spirit 条目", () => {
    expect(CUSTOM_TALENT_MODIFIERS["47788"][0].effect).toBe("reduce_cd");
    expect(CUSTOM_TALENT_MODIFIERS["47788"][0].talentSpellId).toBe("200209");
  });
});
