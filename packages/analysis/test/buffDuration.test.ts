/**
 * buffFullDurationForCaster — talent-conditional NON-CC buff duration
 * (2026-09-06). The buff/CD twin of ccDuration.test.ts.
 *
 * Why the table exists: `spellEffectGenerated.json` carries the DB2 base
 * duration and nothing applied a talent layer, so `extractOwnerCDBuffExpiry`
 * priced these buffs at `cast + base`. Because its pairing tolerance is ±2 s,
 * a talent that adds more than that made the REAL SPELL_AURA_REMOVED look like
 * it belonged to a different cast, and the line fell back to an estimate at
 * the wrong second.
 *
 * Each registered entry reconciles DB2 against the local 227-file corpus:
 * Barkskin 8 + 4 = 12 (Improved Barkskin, 278 caster-cells vs 2 at 8 s),
 * Guardian Spirit 10 + 2 = 12, Enraged Regeneration 8 + 3 = 11, and Time
 * Dilation's three-tier ladder 8.0 / 9.2 / 10.4 at 0 / 1 / 2 ranks of the
 * maxRanks=2 Timeless Magic.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";

import {
  BUFF_DURATION_TALENT_MODIFIERS,
  spellEffectData,
} from "../src/data/spellEffectData";
import {
  buffFullDurationForCaster,
  SPELL_DURATION_OVERRIDES,
} from "../src/utils/buffDuration";
import { talentOwnershipOf, talentRankOf } from "../src/utils/talentOwnership";
import { makeUnit } from "./ported/testHelpers";

const BARKSKIN = "22812";
const GUARDIAN_SPIRIT = "47788";
const ENRAGED_REGENERATION = "184364";
const TIME_DILATION = "357170";

// node id1 / entry id2 from talentIdMap.json for the spec used in each case
const IMPROVED_BARKSKIN = { id1: 104085, id2: 128591, count: 1 };
const FORESEEN_CIRCUMSTANCES = { id1: 94689, id2: 117292, count: 1 };
const INVIGORATING_FURY = { id1: 110330, id2: 136890, count: 1 };
const timelessMagic = (count: number) => ({
  id1: 93263,
  id2: 115568,
  count,
});

describe("buffFullDurationForCaster — 天赋条件的增益时长", () => {
  it("无施法者 → 沿用「典型施法者」值,与加天赋层之前逐字节一致", () => {
    // 这三条覆盖值本身就是带天赋的数(语料里几乎人人点),没有施法者时它比
    // 无天赋基础值更接近事实 —— 所以不动,任何还没接到本谓词的消费点行为不变。
    expect(buffFullDurationForCaster(BARKSKIN, undefined)).toBe(12);
    expect(buffFullDurationForCaster(GUARDIAN_SPIRIT, undefined)).toBe(12);
    expect(buffFullDurationForCaster(TIME_DILATION, undefined)).toBe(10.4);
    // 狂怒回复没有覆盖,DB2 基础值就是无天赋值
    expect(buffFullDurationForCaster(ENRAGED_REGENERATION, undefined)).toBe(8);
  });

  it("每条登记项的无施法者值都与 untalentedBaseSeconds 自洽", () => {
    // 两类条目,不许混:
    //  · TYPICAL_IS_TALENTED —— 表里存的是**带天赋的典型值**(语料里约 100%
    //    的施法者都点了,所以拿不到施法者时它比基础值更接近事实)。这三条必须
    //    满足 基础值 + 该级数的天赋 == 表值。
    //  · 其余 —— 表里存的就是无天赋基础值,两者必须相等。
    const TYPICAL_IS_TALENTED: Record<string, number> = {
      "22812": 1, // Improved Barkskin, maxRanks 1
      "47788": 1, // Foreseen Circumstances, maxRanks 1
      "357170": 2, // Timeless Magic, maxRanks 2 —— 语料 143/155 格是 2 级
      "1719": 2, // Rampaging Berserker —— 语料 31/31 格是 2 级,12×(1+0.25×2)=18
    };
    for (const [spellId, mods] of Object.entries(
      BUFF_DURATION_TALENT_MODIFIERS,
    )) {
      const noCaster = buffFullDurationForCaster(spellId, undefined);
      const rank = TYPICAL_IS_TALENTED[spellId] ?? 0;
      let seconds = mods[0]!.untalentedBaseSeconds;
      let mult = 1;
      for (const m of mods) {
        if (m.addSeconds !== undefined) seconds += m.addSeconds * rank;
        if (m.pct !== undefined) mult += (m.pct / 100) * rank;
      }
      expect(noCaster).toBeCloseTo(seconds * mult);
    }
  });

  it("固定秒数天赋:树皮术 8+4=12 / 守护之魂 10+2=12 / 狂怒回复 8+3=11", () => {
    const druid = makeUnit("d1", {
      spec: CombatUnitSpec.Druid_Restoration,
      info: { talents: [IMPROVED_BARKSKIN], pvpTalents: [] },
    });
    expect(talentOwnershipOf(druid, "327993")).toBe("yes");
    expect(buffFullDurationForCaster(BARKSKIN, druid)).toBeCloseTo(12);

    const priest = makeUnit("p1", {
      spec: CombatUnitSpec.Priest_Holy,
      info: { talents: [FORESEEN_CIRCUMSTANCES], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster(GUARDIAN_SPIRIT, priest)).toBeCloseTo(12);

    const warrior = makeUnit("w1", {
      spec: CombatUnitSpec.Warrior_Fury,
      info: { talents: [INVIGORATING_FURY], pvpTalents: [] },
    });
    expect(
      buffFullDurationForCaster(ENRAGED_REGENERATION, warrior),
    ).toBeCloseTo(11);
  });

  it("按级数生效:时间膨胀 0/1/2 级 = 8 / 9.2 / 10.4s", () => {
    const noTalent = makeUnit("e0", {
      spec: CombatUnitSpec.Evoker_Preservation,
      // 一个真实可解析、但不是 Timeless Magic 的节点(回响)——空数组会被判成
      // 「没数据」而不是「没点」,那是 unknown 不是 no。
      info: {
        talents: [{ id1: 93339, id2: 115653, count: 1 }],
        pvpTalents: [],
      },
    });
    // 已知施法者且确认没点 → 用无天赋基础值 8,而不是「典型值」10.4
    expect(buffFullDurationForCaster(TIME_DILATION, noTalent)).toBe(8);

    const rank1 = makeUnit("e1", {
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { talents: [timelessMagic(1)], pvpTalents: [] },
    });
    expect(talentRankOf(rank1, "376240")).toBe(1);
    expect(buffFullDurationForCaster(TIME_DILATION, rank1)).toBeCloseTo(9.2);

    const rank2 = makeUnit("e2", {
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { talents: [timelessMagic(2)], pvpTalents: [] },
    });
    expect(talentRankOf(rank2, "376240")).toBe(2);
    expect(buffFullDurationForCaster(TIME_DILATION, rank2)).toBeCloseTo(10.4);
  });

  it("proc 型:持有 Deeply Rooted Elements → 升腾按 6s,不是官方的 15s", () => {
    // 语料里 1684 次上身对 18 次施放 —— 这个光环几乎只由 DRE 触发,而触发方
    // 自带时长。所以这里不是「加长」而是「替换」。
    const DRE = { id1: 81051, id2: 101937, count: 1 };
    const resto = makeUnit("s1", {
      spec: CombatUnitSpec.Shaman_Restoration,
      info: { talents: [DRE], pvpTalents: [] },
    });
    expect(talentOwnershipOf(resto, "378270")).toBe("yes");
    expect(buffFullDurationForCaster("114052", resto)).toBe(6);
    // 拿不到施法者仍是官方 15s(硬读版本的时长),与接线前一致
    expect(buffFullDurationForCaster("114052", undefined)).toBe(15);
  });

  it("专精门:同一个法术,神骑走 ×1.5、惩戒走 +4s,互不串台", () => {
    // 没有专精门时,惩戒骑会在 Sanctified Wrath 那条上走到「yes 但读不到级数」
    // 的提前返回,拿不到自己的 Divine Wrath +4s。
    const SANCTIFIED_WRATH = { id1: 81592, id2: 102578, count: 1 };
    const holy = makeUnit("h1", {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { talents: [SANCTIFIED_WRATH], pvpTalents: [] },
    });
    expect(talentOwnershipOf(holy, "53376")).toBe("yes");
    expect(buffFullDurationForCaster("31884", holy)).toBeCloseTo(30);
    expect(buffFullDurationForCaster("216331", holy)).toBeCloseTo(22.5);
    // 语料里惩戒骑普遍是 2 级(72/74 格),两级共 +4s
    const DIVINE_WRATH = { id1: 93160, id2: 115439, count: 2 };
    const ret = makeUnit("r1", {
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [DIVINE_WRATH], pvpTalents: [] },
    });
    // 惩戒:神骑那条被专精门挡掉,不会短路
    expect(talentOwnershipOf(ret, "406872")).toBe("yes");
    expect(buffFullDurationForCaster("31884", ret)).toBeCloseTo(24);
  });

  it("多级天赋:按**语料实际观测到的级数**复现观测时长", () => {
    // DB2 的多级语义不统一,这一条是唯一的护栏:Timeless Magic 确实是每级
    // (语料 0/1/2 级三档 8.0 / 9.0 / 10.5 都有样本),而 Divine Wrath /
    // Extended Flight / Rampaging Berserker 的 DB2 值是**满级总值**,按每级
    // 乘会多算一倍。下表的级数与秒数全部直接来自 227 文件语料的分组统计。
    const CASES: Array<{
      spellId: string;
      spec: CombatUnitSpec;
      talent: { id1: number; id2: number; count: number };
      seconds: number;
      cells: number;
    }> = [
      // Timeless Magic —— 唯一被语料证实「确实按级数」的一条
      {
        spellId: "357170",
        spec: CombatUnitSpec.Evoker_Preservation,
        talent: { id1: 93263, id2: 115568, count: 1 },
        seconds: 9.2,
        cells: 5,
      },
      {
        spellId: "357170",
        spec: CombatUnitSpec.Evoker_Preservation,
        talent: { id1: 93263, id2: 115568, count: 2 },
        seconds: 10.4,
        cells: 143,
      },
      // Pain and Suffering —— 2 级共 +4s
      {
        spellId: "589",
        spec: CombatUnitSpec.Priest_Discipline,
        talent: { id1: 82578, id2: 103703, count: 2 },
        seconds: 20,
        cells: 57,
      },
      // Extended Flight —— 2 级共 +4s(不是每级 +4)
      {
        spellId: "358267",
        spec: CombatUnitSpec.Evoker_Preservation,
        talent: { id1: 93349, id2: 115664, count: 2 },
        seconds: 10,
        cells: 219,
      },
      // Divine Wrath —— 2 级共 +4s
      {
        spellId: "31884",
        spec: CombatUnitSpec.Paladin_Retribution,
        talent: { id1: 93160, id2: 115439, count: 2 },
        seconds: 24,
        cells: 72,
      },
      // Rampaging Berserker —— 2 级共 +50%
      {
        spellId: "1719",
        spec: CombatUnitSpec.Warrior_Fury,
        talent: { id1: 110412, id2: 137002, count: 2 },
        seconds: 18,
        cells: 31,
      },
    ];
    for (const c of CASES) {
      const u = makeUnit(`u-${c.spellId}-${c.talent.count}`, {
        spec: c.spec,
        info: { talents: [c.talent], pvpTalents: [] },
      });
      expect(buffFullDurationForCaster(c.spellId, u)).toBeCloseTo(c.seconds, 1);
    }
  });

  it("专精基础值:神圣马驹惩戒 6s / 神圣 5s / 惩戒+冲锋天赋 8s,DB2 的 3s 对谁都不对", () => {
    const STEED = "221883";
    const ret = makeUnit("p-ret", {
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [{ id1: 93160, id2: 115439, count: 2 }], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster(STEED, ret)).toBeCloseTo(6);
    const holy = makeUnit("p-holy", {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { talents: [{ id1: 81592, id2: 102578, count: 1 }], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster(STEED, holy)).toBeCloseTo(5);
    const charger = makeUnit("p-ret2", {
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [{ id1: 95181, id2: 117858, count: 1 }], pvpTalents: [] },
    });
    expect(talentOwnershipOf(charger, "432990")).toBe("yes");
    expect(buffFullDurationForCaster(STEED, charger)).toBeCloseTo(8);
    // loadout 读不到时退到**专精**基础值,而不是 DB2 的 3s
    const unknownRet = makeUnit("p-ret3", {
      spec: CombatUnitSpec.Paladin_Retribution,
    });
    expect(buffFullDurationForCaster(STEED, unknownRet)).toBeCloseTo(6);
    // 射击猎的优胜劣汰同理:自己的 3.0s,天赋抬不动
    const mm = makeUnit("h-mm", {
      spec: CombatUnitSpec.Hunter_Marksmanship,
      info: { talents: [{ id1: 102391, id2: 126454, count: 1 }], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("264735", mm)).toBeCloseTo(3);
  });

  it("读不到天赋(unknown)绝不加长 —— 与 CC 侧同一条纪律", () => {
    const noInfo = makeUnit("d2", { spec: CombatUnitSpec.Druid_Restoration });
    expect(talentOwnershipOf(noInfo, "327993")).toBe("unknown");
    expect(talentRankOf(noInfo, "327993")).toBe(0);
    // 读不到级数 → 退回「典型施法者」值(= 接线前的行为),而不是替他断言没点。
    // 与 CC 侧的不对称是刻意的:那边基础值就是官方值,加长才是需要证据的一侧;
    // 这边「典型值」本身已经含天赋,落到无天赋基础值同样是没证据的断言。
    expect(buffFullDurationForCaster(BARKSKIN, noInfo)).toBe(12);

    const definitelyNot = makeUnit("d4", {
      spec: CombatUnitSpec.Druid_Restoration,
      // a real, resolvable Restoration Druid node (Rejuvenation) that is NOT
      // Improved Barkskin — so the loadout parses and the verdict is a real "no"
      info: {
        talents: [{ id1: 82217, id2: 103295, count: 1 }],
        pvpTalents: [],
      },
    });
    expect(talentOwnershipOf(definitelyNot, "327993")).toBe("no");
    expect(buffFullDurationForCaster(BARKSKIN, definitelyNot)).toBe(8);
  });

  it("零差值不变量:无施法者的回答 === 直读 spellEffectData(收敛的安全前提)", () => {
    // 2026-09-06 把 auraIntervals / dispelAnalysis / cooldownTiming / massDispel
    // 从直读 spellEffectData 换成本谓词时,依据就是这条:没有施法者时两者逐值
    // 相同,所以那几处是零差改动。任何人以后往 SPELL_DURATION_OVERRIDES 里加一
    // 条与 DB2 不同的值,都会在这里变红 —— 那正是他必须先想清楚「这几个消费点
    // 也会跟着变」的时刻。
    const exempt = new Set(Object.keys(SPELL_DURATION_OVERRIDES));
    let checked = 0;
    for (const [id, mined] of Object.entries(spellEffectData)) {
      if (exempt.has(id)) continue;
      expect(buffFullDurationForCaster(id, undefined)).toBe(
        mined.durationSeconds,
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(3000);
    // 唯一的一条覆盖(终极苦修 6.5)如今与 DB2 同值 —— 它已经冗余,所以今天
    // 连豁免项都没有实际差异。
    for (const id of exempt)
      expect(buffFullDurationForCaster(id, undefined)).toBe(
        spellEffectData[id]?.durationSeconds,
      );
  });

  it("未登记的技能不受影响;每条只用一种量纲", () => {
    const druid = makeUnit("d3", {
      spec: CombatUnitSpec.Druid_Restoration,
      info: { talents: [IMPROVED_BARKSKIN], pvpTalents: [] },
    });
    // Survival Instincts — not in the table
    expect(buffFullDurationForCaster("61336", druid)).toBe(
      buffFullDurationForCaster("61336", undefined),
    );
    // 每条恰好用一种量纲:加秒 / 加百分比 / 整个替换(proc) / 纯专精基础值。
    // 纯专精基础值那种没有 talentSpellId,也不带任何修正量纲。
    for (const mods of Object.values(BUFF_DURATION_TALENT_MODIFIERS))
      for (const m of mods) {
        const dims = [m.addSeconds, m.pct, m.replaceSeconds].filter(
          (v) => v !== undefined,
        );
        if (m.talentSpellId === undefined) {
          // 纯 specBaseSeconds 行:必须有专精门,且不带修正
          expect(m.specBaseSeconds).toBeDefined();
          expect(m.specs).toBeDefined();
          expect(dims).toHaveLength(0);
        } else {
          expect(dims).toHaveLength(1);
        }
      }
  });
});
