import { describe, expect, test } from "vitest";

import { transformMitigation } from "../scripts/datagen/genMitigation";

// Minimal SpellEffect CSV sample: the column names follow the real table (the
// implementer first pulled a real CSV header via fetchTable to check; the names
// below are the ones genTalentModifiers already consumes)
const HEADER =
  "ID,DifficultyID,EffectAura,EffectBasePointsF,EffectMiscValue_0,SpellID,Effect,PvpMultiplier";
const row = (
  spellId: string,
  aura: string,
  points: string,
  misc: string,
  diff = "0",
  pvp = "1",
) =>
  `${Math.random().toString().slice(2, 8)},${diff},${aura},${points},${misc},${spellId},6,${pvp}`;

describe("transformMitigation", () => {
  const WL = new Set(["22812", "33206", "642", "97462"]);

  test("PvpMultiplier 乘在基础值上(2026-09-04 用户裁决:PvP 值为官方值):圣佑术 -20 × 1.75 = 35,优胜劣汰 -30 × 0.8333 = 25,空列按 1", () => {
    const csv = [
      "ID,DifficultyID,EffectAura,EffectBasePointsF,EffectMiscValue_0,SpellID,Effect,PvpMultiplier",
      row("498", "87", "-20", "127", "0", "1.75"), // Divine Protection
      row("264735", "87", "-30", "127", "0", "0.83333301544"), // Survival of the Fittest
      row("22812", "87", "-20", "127", "0", ""), // blank column → ×1
    ].join("\n");
    const r = transformMitigation(csv, new Set(["498", "264735", "22812"]));
    expect(r.entries).toEqual({
      "498": { pct: 35, schoolMask: 127 },
      "264735": { pct: 25, schoolMask: 127 },
      "22812": { pct: 20, schoolMask: 127 },
    });
    expect(r.unresolved).toEqual([]);
  });

  test("87 行:负 points 取绝对值,mask 透传;非白名单/非 87 行忽略", () => {
    const csv = [
      HEADER,
      row("22812", "87", "-20", "127"), // Barkskin: 20%, all schools
      row("33206", "87", "-40", "127"), // Pain Suppression: 40%
      row("99999", "87", "-30", "127"), // not whitelisted → ignored
      row("22812", "4", "-15", "1"), // not aura 87 → ignored
    ].join("\n");
    const r = transformMitigation(csv, WL);
    expect(r.entries).toEqual({
      "22812": { pct: 20, schoolMask: 127 },
      "33206": { pct: 40, schoolMask: 127 },
    });
    expect(r.unresolved).toEqual([]);
  });

  test("同 spell 多条 87 行且值不同 → 不猜,进 unresolved", () => {
    const csv = [
      HEADER,
      row("97462", "87", "-10", "127"),
      row("97462", "87", "-15", "127"),
    ].join("\n");
    const r = transformMitigation(csv, new Set(["97462"]));
    expect(r.entries["97462"]).toBeUndefined();
    expect(r.unresolved).toEqual([
      { id: "97462", reason: "multiple-conflicting-87-rows" },
    ]);
  });

  test("同 spell 多条 87 行但值相同 → 收敛为一条(非歧义)", () => {
    const csv = [
      HEADER,
      row("642", "87", "-20", "126"),
      row("642", "87", "-20", "126"),
    ].join("\n");
    const r = transformMitigation(csv, new Set(["642"]));
    expect(r.entries["642"]).toEqual({ pct: 20, schoolMask: 126 });
  });

  test("白名单内零命中 87 行 → 不进 entries 也不进 unresolved(缺席由防腐测试在合并层抓)", () => {
    const csv = [HEADER, row("642", "4", "-20", "1")].join("\n");
    const r = transformMitigation(csv, new Set(["642"]));
    expect(r.entries).toEqual({});
    expect(r.unresolved).toEqual([]);
  });

  test("DifficultyID 非 0 的行忽略(genDrCategories 同款去重口径)", () => {
    const csv = [HEADER, row("642", "87", "-20", "127", "1")].join("\n");
    expect(transformMitigation(csv, new Set(["642"])).entries).toEqual({});
  });

  test("正 points(非减伤语义)→ unresolved 而非收录", () => {
    const csv = [HEADER, row("642", "87", "25", "127")].join("\n");
    const r = transformMitigation(csv, new Set(["642"]));
    expect(r.entries["642"]).toBeUndefined();
    expect(r.unresolved).toEqual([
      { id: "642", reason: "non-negative-points" },
    ]);
  });

  test("0 points(真数据 1022 命中此分支:非负值非减伤语义)→ unresolved", () => {
    const csv = [HEADER, row("642", "87", "0", "127")].join("\n");
    const r = transformMitigation(csv, new Set(["642"]));
    expect(r.entries["642"]).toBeUndefined();
    expect(r.unresolved).toEqual([
      { id: "642", reason: "non-negative-points" },
    ]);
  });
});
