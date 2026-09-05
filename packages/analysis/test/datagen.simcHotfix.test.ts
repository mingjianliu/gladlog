import { describe, expect, test } from "vitest";

import {
  applyHotfixOverlay,
  buildHotfixOverlay,
  parseClientDataVersion,
  parseSimcSpellData,
  SIMC_EFFECT_FIELD_COLUMNS,
} from "../scripts/datagen/lib/simcHotfix";

// A trimmed sc_spell_data.inc in the real layout (12.1.0.69587, 2026-09-02):
// effect rows first, then the three hotfix arrays.
const effectRows = Array.from(
  { length: 10000 },
  (_, i) => `  {  ${100000 + i},  ${500000 + i},  0,   6,  87, 0, 0x0, 0.0 },`,
).join("\n");
const INC = `// 31636 spells, wow build level 12.1.0.69587
static spell_data_t __spell_data[2] = {
  { "Power Word: Shield", 17, 2, 0.000000 }, /* 13 */
};
// 53234 effects, wow build level 12.1.0.69587
static spelleffect_data_t __spelleffect_data[3] = {
  {      13,      17,  0,   6,  69, 0, 0x00000000, 0.000000, 0.050000, 1.150000, 0, 0 },
  {    4830,   11426,  0,   6,  69, 0, 0x00000000, 0.000000, 0.750000, 0, 0 },
  { 1028369,  247456,  0,   6,  87, 0, 0x00000000, -6.000000, 0, 0 },
${effectRows}
};
// spell hotfix entries, wow build level 12.1.0.69587
static constexpr std::array<hotfix::client_hotfix_entry_t, 2> __spell_hotfix_data { {
  {  212106, 35, hotfix::client_hotfix_entry_t::flags_value_t{}, hotfix::client_hotfix_entry_t::flags_value_t{} },
  {  227847, 35, hotfix::client_hotfix_entry_t::flags_value_t{}, hotfix::client_hotfix_entry_t::flags_value_t{} },
} };
// effect hotfix entries, wow build level 12.1.0.69587
static constexpr std::array<hotfix::client_hotfix_entry_t, 4> __effect_hotfix_data { {
  {      13, 27, 1.000000, 1.150000 },
  {    4830, 27, 1.000000, 0.750000 },
  { 1028369, 14, -5.000000, -6.000000 },
  {      13, 99, 3.000000, 4.000000 },
} };
// power hotfix entries, wow build level 12.1.0.69587
static constexpr std::array<hotfix::client_hotfix_entry_t, 1> __power_hotfix_data { {
  {    3, 5, 100.000000, 120.000000 },
} };
`;

const VERSION = `#define CLIENT_DATA_WOW_VERSION "12.1.0.69587"
#define CLIENT_DATA_HOTFIX_DATE "2026-09-02"
#define CLIENT_DATA_HOTFIX_BUILD (69587)
#define CLIENT_DATA_HOTFIX_HASH "4613cf248fb54e75d8cc9f07a3c5ff3ab12f6f3a884b51ba8dab5def4eadd6a4"
`;

describe("simcHotfix — 解析与叠加", () => {
  const data = parseSimcSpellData(INC);
  const version = parseClientDataVersion(VERSION);
  const overlay = buildHotfixOverlay(data, version, {
    branch: "midnight",
    commit: "0".repeat(40),
    fetchedAt: "2026-09-04T00:00:00.000Z",
  });

  test("三张热修数组 + effect→spell 映射 + build 都读得到", () => {
    expect(data.build).toBe("12.1.0.69587");
    expect(data.effectSpell.get(13)).toBe(17);
    expect(data.effectHotfixes).toHaveLength(4);
    expect(data.spellHotfixIds).toEqual([212106, 227847]);
    expect(data.powerHotfixes).toEqual([
      { id: 3, field: 5, old: 100, new: 120 },
    ]);
    expect(version).toEqual({
      build: "12.1.0.69587",
      hotfixDate: "2026-09-02",
      hotfixBuild: "69587",
      hotfixHash:
        "4613cf248fb54e75d8cc9f07a3c5ff3ab12f6f3a884b51ba8dab5def4eadd6a4",
    });
  });

  test("field 27 → PvpMultiplier、14 → EffectBasePointsF;未知 field 原样保留在 unmapped", () => {
    expect(SIMC_EFFECT_FIELD_COLUMNS[27]).toBe("PvpMultiplier");
    expect(SIMC_EFFECT_FIELD_COLUMNS[14]).toBe("EffectBasePointsF");
    expect(overlay.effects["13"]).toEqual({
      spellId: 17,
      columns: { PvpMultiplier: 1.15 },
      unmapped: [{ field: 99, old: 3, new: 4 }],
    });
    expect(overlay.effects["1028369"]).toEqual({
      spellId: 247456,
      columns: { EffectBasePointsF: -6 },
      unmapped: [],
    });
    expect(overlay.meta.hotfixDate).toBe("2026-09-02");
    expect(overlay.meta.clientBuild).toBe("12.1.0.69587");
  });

  test("applyHotfixOverlay 就地改写同 ID 的行,缺行计数,幂等", () => {
    const rows = [
      { ID: "13", SpellID: "17", EffectBasePointsF: "0", PvpMultiplier: "1" },
      {
        ID: "1028369",
        SpellID: "247456",
        EffectBasePointsF: "-5",
        PvpMultiplier: "1",
      },
      { ID: "999", SpellID: "1", EffectBasePointsF: "7", PvpMultiplier: "1" },
    ];
    const stats = applyHotfixOverlay(rows, overlay);
    expect(stats).toEqual({ applied: 2, missingRows: 1, rowsTouched: 2 });
    expect(rows[0]!.PvpMultiplier).toBe("1.15");
    expect(rows[1]!.EffectBasePointsF).toBe("-6");
    expect(rows[2]!.EffectBasePointsF).toBe("7");
    expect(applyHotfixOverlay(rows, overlay).applied).toBe(2);
    expect(rows[0]!.PvpMultiplier).toBe("1.15");
    expect(applyHotfixOverlay(rows, null)).toEqual({
      applied: 0,
      missingRows: 0,
      rowsTouched: 0,
    });
  });

  test("与 PvpMultiplier 谓词串联:真言术盾热修后 aura87 类生成器读到的是 1.15", () => {
    const rows = [
      { ID: "13", SpellID: "17", EffectBasePointsF: "-20", PvpMultiplier: "1" },
    ];
    applyHotfixOverlay(rows, overlay);
    expect(
      Number(rows[0]!.EffectBasePointsF) * Number(rows[0]!.PvpMultiplier),
    ).toBeCloseTo(-23);
  });
});
