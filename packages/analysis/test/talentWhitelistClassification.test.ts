/**
 * 消费白名单来源分类锚定(BACKLOG #23-1 精准验收,2026-08-11 人工裁决)。
 *
 * 「你有 X」强断言只出自 deathOutcomeAnalysis 的两张白名单
 * (IMMUNITY_SPELLS + EXTERNAL_DEFENSIVE_SPELLS)。精准(既不漏也不错)
 * 要求白名单里每个 (spellId, spec) 对的天赋来源都有官方出处或书面人工
 * 裁决——不许留「来源不明」条目。
 *
 * EXPECTED 表按 12.1.0.69273 官方数据逐条分类(talentIdMap.json = DB2
 * trait 树;pvpTalentPoolGenerated = DB2 PvpTalent),本测试用运行时同一
 * 批表复算分类并与之比对:数据刷新后若某技能挪了位置(树↔池↔基线),
 * 此测试打红,人工重新裁决后更新 EXPECTED —— 分类漂移绝不静默。
 *
 * 分类语义(= talentOwnershipFromTables 的判定分支):
 *  - "class" / "spec" / "hero":该 spec 的对应天赋树节点(玩家可能没点)
 *  - "-choice" 后缀:择一节点(只有选中支才拥有)
 *  - "pvpPool":官方 PvP 天赋池(独立槽位,pvpTalents 数组判定)
 *  - "baseline":树与池皆无 → 官方数据排除法,判每个该 spec 玩家必有
 *
 * 已知裁决记录:
 *  - Netherwalk 196555:12.1 既不在 DH 任何树中也不在 Havoc PvP 池中;
 *    2026-08-21 S2 语料扫描 10,682 场 0 次出现,已从 IMMUNITY_SPELLS 及
 *    全部手工表删除(eval-private/reports/s2-health-2026-08-21)。
 *  - Divine Shield 642 / Aspect of the Turtle 186265:真基线技能,分类
 *    "baseline" 正确。(Dispersion 47585 已于 2026-08-21 依 D1 裁定移出
 *    IMMUNITY_SPELLS —— 75% 减伤非免疫,walls 路径照常覆盖 —— 本表
 *    期望随之删除。)
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";

import { PVP_TALENT_POOL_GENERATED } from "../src/data/pvpTalentPoolGenerated";
import { ensureTalentData, nodeMaps } from "../src/data/talentStrings";
import {
  EXTERNAL_DEFENSIVE_SPELLS,
  IMMUNITY_SPELLS,
} from "../src/utils/deathOutcomeAnalysis";

beforeAll(async () => {
  await ensureTalentData();
});

type Source = string; // e.g. "class" | "spec-choice" | "hero" | "pvpPool" | "baseline"

/** 与 talentOwnershipFromTables 同一批官方表复算来源分类。 */
function classify(specId: string, spellId: string): Source {
  const spec = nodeMaps[parseInt(specId, 10)];
  const out: string[] = [];
  if (spec) {
    const kinds: [string, { type: string; entries: unknown[] }[]][] = [
      ["class", spec.classNodes as never],
      ["spec", spec.specNodes as never],
      ["hero", (spec.heroNodes ?? []) as never],
    ];
    for (const [label, nodes] of kinds) {
      for (const n of nodes) {
        for (const e of n.entries as { spellId?: number }[]) {
          if (e.spellId !== undefined && String(e.spellId) === spellId) {
            out.push(label + (n.type === "choice" ? "-choice" : ""));
          }
        }
      }
    }
  }
  if (PVP_TALENT_POOL_GENERATED[specId]?.[spellId]) out.push("pvpPool");
  if (out.length === 0) return "baseline";
  return [...new Set(out)].sort().join("+");
}

/** 人工裁决表:白名单每个 (spellId, spec) 对的来源。 */
const EXPECTED: Record<string, Record<string, Source>> = {
  // 光环大师 31821(2026-08-22 补登记):官方神圣专精树节点 → "spec"(玩家可能
  // 没点)。只登记神圣一系 —— 惩戒/防护的树里没有它,复算会落到 "baseline"
  // (语义是「该专精人人必有」),而 250 场语料 86 次施放全部来自神圣骑士(15 人)。
  "31821": {
    [CombatUnitSpec.Paladin_Holy]: "spec",
  },
  // ---- IMMUNITY_SPELLS ----
  "642": {
    [CombatUnitSpec.Paladin_Holy]: "baseline",
    [CombatUnitSpec.Paladin_Retribution]: "baseline",
    [CombatUnitSpec.Paladin_Protection]: "baseline",
  },
  "45438": {
    [CombatUnitSpec.Mage_Arcane]: "class",
    [CombatUnitSpec.Mage_Fire]: "class",
    [CombatUnitSpec.Mage_Frost]: "class",
  },
  // Aspect of the Turtle 186265 left IMMUNITY_SPELLS 2026-10-21 (a
  // deflection — DoTs land under it; user ruling)
  // Netherwalk 196555: removed 12.1, 0/10682 matches 2026-08-21 — deleted from IMMUNITY_SPELLS
  // ---- EXTERNAL_DEFENSIVE_SPELLS ----
  "102342": { [CombatUnitSpec.Druid_Restoration]: "spec" },
  "33206": { [CombatUnitSpec.Priest_Discipline]: "spec" },
  "47788": { [CombatUnitSpec.Priest_Holy]: "spec" },
  "1022": {
    [CombatUnitSpec.Paladin_Holy]: "class",
    [CombatUnitSpec.Paladin_Retribution]: "class",
    [CombatUnitSpec.Paladin_Protection]: "class",
  },
  "6940": {
    [CombatUnitSpec.Paladin_Holy]: "class",
    [CombatUnitSpec.Paladin_Retribution]: "class",
    [CombatUnitSpec.Paladin_Protection]: "class",
  },
  "116849": { [CombatUnitSpec.Monk_Mistweaver]: "spec" },
  "204018": { [CombatUnitSpec.Paladin_Protection]: "spec-choice" },
  // issue #8 的主角:Disc 专精树择一节点(82564),多数玩家不选
  "62618": { [CombatUnitSpec.Priest_Discipline]: "spec-choice" },
  "98008": { [CombatUnitSpec.Shaman_Restoration]: "spec" },
  "97462": {
    [CombatUnitSpec.Warrior_Arms]: "class",
    [CombatUnitSpec.Warrior_Fury]: "class",
    [CombatUnitSpec.Warrior_Protection]: "class",
  },
  "196718": {
    [CombatUnitSpec.DemonHunter_Havoc]: "class",
    [CombatUnitSpec.DemonHunter_Vengeance]: "class",
    [CombatUnitSpec.DemonHunter_Devourer]: "class",
  },
  "51052": {
    [CombatUnitSpec.DeathKnight_Blood]: "class",
    [CombatUnitSpec.DeathKnight_Frost]: "class",
    [CombatUnitSpec.DeathKnight_Unholy]: "class",
  },
  "357170": { [CombatUnitSpec.Evoker_Preservation]: "spec" },
  "374227": {
    [CombatUnitSpec.Evoker_Devastation]: "class",
    [CombatUnitSpec.Evoker_Preservation]: "class",
    [CombatUnitSpec.Evoker_Augmentation]: "class",
  },
};

describe("白名单来源分类:人工裁决表与官方数据逐条一致", () => {
  it("EXPECTED 覆盖两张白名单的每个 (spellId, spec) 对,无来源不明条目", () => {
    const pairs: [string, string][] = [];
    for (const [id, s] of Object.entries(IMMUNITY_SPELLS))
      for (const spec of s.specs) pairs.push([id, spec]);
    for (const [id, s] of Object.entries(EXTERNAL_DEFENSIVE_SPELLS))
      for (const spec of s.specs) pairs.push([id, spec]);
    for (const [id, spec] of pairs) {
      expect(
        EXPECTED[id]?.[spec],
        `白名单条目 ${id} × spec ${spec} 缺人工裁决分类`,
      ).toBeDefined();
    }
    // 反向:EXPECTED 不含白名单之外的条目(表瘦身后这里也要跟着删)
    const inWhitelist = new Set(pairs.map(([id, spec]) => `${id}:${spec}`));
    for (const [id, bySpec] of Object.entries(EXPECTED))
      for (const spec of Object.keys(bySpec))
        expect(
          inWhitelist.has(`${id}:${spec}`),
          `EXPECTED 有白名单外条目 ${id} × ${spec}`,
        ).toBe(true);
  });

  it("运行时官方表复算的分类与人工裁决表逐条相同(数据刷新漂移即打红)", () => {
    for (const [id, bySpec] of Object.entries(EXPECTED)) {
      for (const [spec, want] of Object.entries(bySpec)) {
        expect(
          `${id}×${spec}=${classify(spec, id)}`,
          `分类漂移:${id} × ${spec}`,
        ).toBe(`${id}×${spec}=${want}`);
      }
    }
  });
});
