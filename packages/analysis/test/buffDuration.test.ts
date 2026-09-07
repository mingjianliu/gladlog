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
    expect(buffFullDurationForCaster(ENRAGED_REGENERATION, warrior)).toBeCloseTo(
      11,
    );
  });

  it("按级数生效:时间膨胀 0/1/2 级 = 8 / 9.2 / 10.4s", () => {
    const noTalent = makeUnit("e0", {
      spec: CombatUnitSpec.Evoker_Preservation,
      // 一个真实可解析、但不是 Timeless Magic 的节点(回响)——空数组会被判成
      // 「没数据」而不是「没点」,那是 unknown 不是 no。
      info: { talents: [{ id1: 93339, id2: 115653, count: 1 }], pvpTalents: [] },
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
      info: { talents: [{ id1: 82217, id2: 103295, count: 1 }], pvpTalents: [] },
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
    for (const mods of Object.values(BUFF_DURATION_TALENT_MODIFIERS))
      for (const m of mods)
        expect(
          (m.addSeconds === undefined) !== (m.pct === undefined),
        ).toBe(true);
  });
});
