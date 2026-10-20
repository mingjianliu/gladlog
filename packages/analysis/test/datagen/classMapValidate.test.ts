import { readFileSync } from "fs";

import {
  buildSpellClassMap,
  classesForMask,
} from "../../scripts/datagen/genSpellClassMap";
import { parseCsv } from "../../scripts/datagen/lib/wagoCsv";
import { validateCatalogs } from "../../scripts/datagen/validateCatalogs";

describe("genSpellClassMap", () => {
  it("ClassMask 位解码:bit n → classId n+1", () => {
    expect(classesForMask(1)).toEqual([1]); // Warrior
    expect(classesForMask(4)).toEqual([3]); // Hunter
    expect(classesForMask(1029)).toEqual([1, 3, 11]); // Warrior+Hunter+Druid
    expect(classesForMask(0)).toEqual([]);
  });

  it("buildSpellClassMap:候选内 id 才产出;mask 0 跳过", () => {
    const rows = [
      { Spell: "118", ClassMask: "128" }, // Mage bit7 → classId 8
      { Spell: "118", ClassMask: "128" }, // 重复行去重
      { Spell: "408", ClassMask: "8" }, // Rogue
      { Spell: "999", ClassMask: "1" }, // 不在候选
      { Spell: "139", ClassMask: "0" },
    ];
    const map = buildSpellClassMap(rows, new Set(["118", "408", "139"]));
    expect(map["118"]).toEqual([8]);
    expect(map["408"]).toEqual([4]);
    expect(map["999"]).toBeUndefined();
    expect(map["139"]).toBeUndefined();
  });
});

describe("validateCatalogs", () => {
  const spellNameRows = parseCsv(
    readFileSync(
      new URL("./fixtures/SpellName.mini.csv", import.meta.url).pathname,
      "utf-8",
    ),
  ).rows;

  it("目录 id 全存在 → 无 missing;假 id → 命中并点名目录", () => {
    const ok = validateCatalogs(spellNameRows, {
      drCategories: ["118", "1714"],
    });
    expect(ok.missing).toEqual([]);

    const bad = validateCatalogs(spellNameRows, {
      drCategories: ["118"],
      spellIdLists: ["424242"],
    });
    expect(bad.missing).toEqual([{ catalog: "spellIdLists", id: "424242" }]);
  });

  it("knownRemoved 白名单内的 id 放行(历史日志技能)", () => {
    const r = validateCatalogs(
      spellNameRows,
      // (synthetic id: the old example 226943 Mind Bomb was deleted from the
      // catalogs 2026-08-21 — no DB2 entry, 0/10682 matches)
      { drCategories: ["999001"] },
      { knownRemoved: { "999001": "Example Removed Spell" } },
    );
    expect(r.missing).toEqual([]);
  });
});
