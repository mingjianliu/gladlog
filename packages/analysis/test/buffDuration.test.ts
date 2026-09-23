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

import { CAST_PARAM_DURATIONS } from "../src/data/castParamDurations";
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
      "1719": 1, // Rampaging Berserker —— 语料 59/89 格是 1 级, 12×(1+0.50×1)=18 (GH #102)
      "1269042": 1, // Eternal Hunger —— 20/20 持有,补丁 14 = 9 + 5 保留为典型值(2026-09-22)
      "445584": 1, // Deadly Focus —— 23/23 持有,补丁 18 = 12 + 6 保留为典型值(2026-09-22)
      "5672": 1, // 图腾专注 +3 与辅助灌魔 +3.5 —— 补丁 21.5 = 15 + 3 + 3.5 保留为典型值(2026-09-22)
      "1282501": 1, // Dominion of Argus: Lady Sacrolash —— 补丁 14 = 10 + 4 保留为典型值(GH #102)
      "1282502": 1, // Dominion of Argus: Grand Warlock Alythess —— 补丁 14 = 10 + 4 保留为典型值(GH #102)
    };
    for (const [spellId, mods] of Object.entries(
      BUFF_DURATION_TALENT_MODIFIERS,
    )) {
      const noCaster = buffFullDurationForCaster(spellId, undefined);
      // A cast-parameter aura with no DB2 duration (Envenom) has no no-caster
      // value by design — its base is always the combo-point formula.
      if (noCaster === undefined && CAST_PARAM_DURATIONS[spellId]) continue;
      const rank = TYPICAL_IS_TALENTED[spellId] ?? 0;
      let seconds = mods[0]!.untalentedBaseSeconds;
      let mult = 1;
      for (const m of mods) {
        if (m.addSeconds !== undefined) seconds += m.addSeconds * rank;
        // percent modifiers multiply (2026-09-23), ranks within one add
        if (m.pct !== undefined) mult *= 1 + (m.pct / 100) * rank;
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
      // Rampaging Berserker —— 1 级 +50% (entry 137002 maxRanks 1, GH #102)
      {
        spellId: "1719",
        spec: CombatUnitSpec.Warrior_Fury,
        talent: { id1: 110412, id2: 137002, count: 1 },
        seconds: 18,
        cells: 31,
      },
      // Dominion of Argus: Lady Sacrolash —— 1 级 +4s (entry 136978 maxRanks 1, GH #102)
      {
        spellId: "1282501",
        spec: CombatUnitSpec.Warlock_Demonology,
        talent: { id1: 110404, id2: 136978, count: 1 },
        seconds: 14,
        cells: 2,
      },
      // Dominion of Argus: Grand Warlock Alythess —— 1 级 +4s (entry 136978 maxRanks 1, GH #102)
      {
        spellId: "1282502",
        spec: CombatUnitSpec.Warlock_Demonology,
        talent: { id1: 110404, id2: 136978, count: 1 },
        seconds: 14,
        cells: 3,
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
      info: {
        talents: [{ id1: 93160, id2: 115439, count: 2 }],
        pvpTalents: [],
      },
    });
    expect(buffFullDurationForCaster(STEED, ret)).toBeCloseTo(6);
    const holy = makeUnit("p-holy", {
      spec: CombatUnitSpec.Paladin_Holy,
      info: {
        talents: [{ id1: 81592, id2: 102578, count: 1 }],
        pvpTalents: [],
      },
    });
    expect(buffFullDurationForCaster(STEED, holy)).toBeCloseTo(5);
    const charger = makeUnit("p-ret2", {
      spec: CombatUnitSpec.Paladin_Retribution,
      info: {
        talents: [{ id1: 95181, id2: 117858, count: 1 }],
        pvpTalents: [],
      },
    });
    expect(talentOwnershipOf(charger, "432990")).toBe("yes");
    expect(buffFullDurationForCaster(STEED, charger)).toBeCloseTo(8);
    // loadout 读不到时退到**专精**基础值,而不是 DB2 的 3s
    const unknownRet = makeUnit("p-ret3", {
      spec: CombatUnitSpec.Paladin_Retribution,
    });
    expect(buffFullDurationForCaster(STEED, unknownRet)).toBeCloseTo(6);
    // 射击猎的优胜劣汰:主动施放的那份和另外两个专精一样是 6 + 2(孤狼)= 8。
    // 2026-09-22 前这里断言 3 —— 那 3 秒是烟幕(黑暗游侠)让意气风发触发的
    // 第二份,不是专精基础值(auraProducerScan:施放 320/353 格 8 s,意气风发
    // 触发 50/51 格 3 s)。
    const mm = makeUnit("h-mm", {
      spec: CombatUnitSpec.Hunter_Marksmanship,
      info: {
        talents: [{ id1: 102391, id2: 126454, count: 1 }],
        pvpTalents: [],
      },
    });
    expect(buffFullDurationForCaster("264735", mm)).toBeCloseTo(8);
  });

  it("PvP 天赋算 1 级 —— 否则它携带的时长修正永远失效", () => {
    // PvP 天赋是「装上/不装」不是「点几级」,天赋树数组里根本没有它。
    // 修之前 talentRankOf 一律返回 0,谓词走 rank<=0 的回退,于是任何由 PvP
    // 天赋携带的时长修正都永远生效不了(神圣马驹的 Steed of Glory +2s /
    // Soul-Touched Spurs +3s 就是这个形状)。
    const STEED_OF_GLORY = "199542";
    const withPvp = makeUnit("p-pvp", {
      spec: CombatUnitSpec.Paladin_Protection,
      info: { talents: [], pvpTalents: [STEED_OF_GLORY] },
    });
    expect(talentOwnershipOf(withPvp, STEED_OF_GLORY)).toBe("yes");
    expect(talentRankOf(withPvp, STEED_OF_GLORY)).toBe(1);
    const without = makeUnit("p-nopvp", {
      spec: CombatUnitSpec.Paladin_Protection,
      info: { talents: [], pvpTalents: [] },
    });
    expect(talentRankOf(without, STEED_OF_GLORY)).toBe(0);
  });

  it("扫描 FLAG 追回来的两条:集结呐喊 ×1.2 / 神圣马驹 ×0.6", () => {
    // 两条都是 buffDurationScan 在**建表时没用过的样本**上报出来的偏差,
    // 追下去各自有 100%/0% 的天赋分组 + 掩码覆盖 + 算术自洽。
    const BATTLEFIELD_COMMANDER = { id1: 108544, id2: 134033, count: 1 };
    const RESONANT_VOICE = { id1: 108685, id2: 134225, count: 1 };
    const warriorBC = makeUnit("w-bc", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [BATTLEFIELD_COMMANDER], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("97463", warriorBC)).toBeCloseTo(13);
    const warriorBoth = makeUnit("w-both", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: {
        talents: [BATTLEFIELD_COMMANDER, RESONANT_VOICE],
        pvpTalents: [],
      },
    });
    // 先加秒后乘百分比:(10 + 3) × 1.2
    expect(buffFullDurationForCaster("97463", warriorBoth)).toBeCloseTo(15.6);

    const DIVINE_SPURS = { id1: 103857, id2: 128253, count: 1 };
    const retSpurs = makeUnit("p-spurs", {
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [DIVINE_SPURS], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("221883", retSpurs)).toBeCloseTo(3.6);
    const holySpurs = makeUnit("p-spurs-h", {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { talents: [DIVINE_SPURS], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("221883", holySpurs)).toBeCloseTo(3);
  });

  it("2026-09-22 复扫追回的三条:雾之缠绕 +1 / 反魔法屏障 ×1.2 / 灵活机动 ×0.5(GH #65 第 4 项)", () => {
    // 2,111 场重扫的 GAP 段过门的 5 个光环里,DB2 有时长修正且掩码可达的三条;
    // 持有者拆分(detail,每 60 场取 1)全部单边:雾之缠绕 94/101 持有格 7s、
    // 非持有 0/8;反魔法屏障 129/137 + 32/32 持有格 6s(人人必点,无对照组,
    // 规则 3 不要求);灵活机动(PvP 天赋)8/8 持有格 6s、非持有 0/162。
    const MIST_WRAP = { id1: 101093, id2: 124871, count: 1 };
    const mwHolder = makeUnit("mw-1", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: { talents: [MIST_WRAP], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("124682", mwHolder)).toBeCloseTo(7);
    const mwNo = makeUnit("mw-0", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: { talents: [], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("124682", mwNo)).toBeCloseTo(6);

    const ANTI_MAGIC_BARRIER = { id1: 76046, id2: 96174, count: 1 };
    const dk = makeUnit("dk-1", {
      spec: CombatUnitSpec.DeathKnight_Unholy,
      info: { talents: [ANTI_MAGIC_BARRIER], pvpTalents: [] },
    });
    // PvP 值 +20%(DB2 本体 +40% 经 PvpMultiplier),不是 +40%
    expect(buffFullDurationForCaster("410358", dk)).toBeCloseTo(6);
    expect(buffFullDurationForCaster("48707", dk)).toBeCloseTo(6);

    const FEATHERFOOT = { id1: 101714, id2: 125615, count: 1 };
    const MANEUVERABILITY = "197000";
    const rogueBoth = makeUnit("r-both", {
      spec: CombatUnitSpec.Rogue_Assassination,
      info: { talents: [FEATHERFOOT], pvpTalents: [MANEUVERABILITY] },
    });
    // 先加秒后乘百分比:(8 + 4) × 0.5 —— 语料里 6s 格全是持有者
    expect(buffFullDurationForCaster("2983", rogueBoth)).toBeCloseTo(6);
    const rogueFeather = makeUnit("r-ff", {
      spec: CombatUnitSpec.Rogue_Assassination,
      info: { talents: [FEATHERFOOT], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("2983", rogueFeather)).toBeCloseTo(12);
  });

  it("2026-09-22 第二批:inventory 里 label / 掩码时长修正逐对过语料后登记的条目(用户裁「都把它改了」)", () => {
    // 每一条:DB2 行 + 目标可达(inventory)、持有者拆分单边、算术自洽;数字在表的 note 里。
    const B2 = {
      IMBUEMENT_MASTERY: { id1: 94871, id2: 117468, count: 1 },
      SUBSERVIENT_SHADOWS: { id1: 82559, id2: 103682, count: 1 },
      THORIMS_INVOCATION: { id1: 80949, id2: 101813, count: 1 },
      LINGERING_HEALING: { id1: 82240, id2: 103319, count: 1 },
      RAZOR_WIRE: { id1: 90780, id2: 112673, count: 1 },
      PRECISION_DETONATION: { id1: 110574, id2: 137377, count: 1 },
      FOCI_OF_LIFE: { id1: 93345, id2: 115660, count: 1 },
      WITHER_AWAY: { id1: 95058, id2: 117655, count: 1 },
      HOLY_REPRIEVE: { id1: 103860, id2: 128256, count: 1 },
      RESILIENT_FLOURISHING: { id1: 94631, id2: 117234, count: 1 },
      CIRCLE_OF_LIFE_AND_DEATH: { id1: 82092, id2: 103152, count: 1 },
      ETERNAL_HUNGER: { id1: 109837, id2: 136096, count: 1 },
      DEADLY_FOCUS: { id1: 109816, id2: 136075, count: 1 },
      EBON_FEVER: { id1: 76197, id2: 96334, count: 1 },
      QUIETUS: { id1: 94846, id2: 117443, count: 1 },
    };
    const OVERPOWERED_BARRIER = "1220739"; // PvP 天赋
    const u = (
      id: string,
      spec: CombatUnitSpec,
      talents: Array<{ id1: number; id2: number; count: number }>,
      pvpTalents: string[] = [],
    ) => makeUnit(id, { spec, info: { talents, pvpTalents } });
    const d = (
      spellId: string,
      unit: ReturnType<typeof makeUnit> | undefined,
    ) => buffFullDurationForCaster(spellId, unit);

    // 大地生命武器:09-07 的 9 s 平补丁其实是灌魔精通(label +3 s)—— 补丁已删
    const rsham = CombatUnitSpec.Shaman_Restoration;
    expect(d("382024", u("s-im", rsham, [B2.IMBUEMENT_MASTERY]))).toBeCloseTo(
      9,
    );
    expect(d("382024", u("s-no", rsham, []))).toBeCloseTo(6);
    expect(d("382024", undefined)).toBeCloseTo(6);
    // 暗影魔 / 彼岸之物 ← 卑微暗影 ×1.2(label)—— 两条平补丁都删了
    const spriest = CombatUnitSpec.Priest_Shadow;
    expect(
      d("1280172", u("p-ss", spriest, [B2.SUBSERVIENT_SHADOWS])),
    ).toBeCloseTo(6);
    expect(
      d("373277", u("p-ss2", spriest, [B2.SUBSERVIENT_SHADOWS])),
    ).toBeCloseTo(24);
    expect(d("1280172", u("p-no", spriest, []))).toBeCloseTo(5);
    expect(d("373277", undefined)).toBeCloseTo(20);
    // 狂风 ← 索里姆的召唤 +2(label):09-07 按表成员资格丢掉的那条,机制是天赋
    expect(
      d(
        "466772",
        u("s-ti", CombatUnitSpec.Shaman_Enhancement, [B2.THORIMS_INVOCATION]),
      ),
    ).toBeCloseTo(10);
    // 回春术 ← 挥之不去的治疗 +3(掩码)
    expect(
      d(
        "774",
        u("d-lh", CombatUnitSpec.Druid_Restoration, [B2.LINGERING_HEALING]),
      ),
    ).toBeCloseTo(15);
    expect(
      d("774", u("d-no", CombatUnitSpec.Druid_Restoration, [])),
    ).toBeCloseTo(12);
    // 绞喉 ← 剃刀丝 +6 / 爆炸射击 ← 精准引爆 +1
    expect(
      d("703", u("r-rw", CombatUnitSpec.Rogue_Assassination, [B2.RAZOR_WIRE])),
    ).toBeCloseTo(24);
    expect(
      d(
        "212431",
        u("h-pd", CombatUnitSpec.Hunter_Marksmanship, [
          B2.PRECISION_DETONATION,
        ]),
      ),
    ).toBeCloseTo(4);
    // 减短带机制:活力烈焰 20 − 4、冰霜疫病 24 × 0.5、宽恕 30 − 10、冰霜屏障(PvP 天赋)60 − 56
    const pres = CombatUnitSpec.Evoker_Preservation;
    expect(d("374349", u("e-fl", pres, [B2.FOCI_OF_LIFE]))).toBeCloseTo(16);
    expect(d("374349", u("e-no", pres, []))).toBeCloseTo(20);
    expect(d("374349", undefined)).toBeCloseTo(20);
    expect(
      d(
        "55095",
        u("dk-wa", CombatUnitSpec.DeathKnight_Frost, [B2.WITHER_AWAY]),
      ),
    ).toBeCloseTo(12);
    expect(
      d(
        "25771",
        u("p-hr", CombatUnitSpec.Paladin_Retribution, [B2.HOLY_REPRIEVE]),
      ),
    ).toBeCloseTo(20);
    expect(
      d("25771", u("p-nohr", CombatUnitSpec.Paladin_Retribution, [])),
    ).toBeCloseTo(30);
    expect(
      d(
        "11426",
        u("m-ob", CombatUnitSpec.Mage_Frost, [], [OVERPOWERED_BARRIER]),
      ),
    ).toBeCloseTo(4);
    expect(d("11426", u("m-noob", CombatUnitSpec.Mage_Frost, []))).toBeCloseTo(
      60,
    );
    // 觅血缠藤:两条修正叠加 —— 坚韧繁茂 +2 先加,生死循环 −20% 后乘
    const feral = CombatUnitSpec.Druid_Feral;
    expect(
      d("439531", u("f-rf", feral, [B2.RESILIENT_FLOURISHING])),
    ).toBeCloseTo(8);
    expect(
      d(
        "439531",
        u("f-both", feral, [
          B2.RESILIENT_FLOURISHING,
          B2.CIRCLE_OF_LIFE_AND_DEATH,
        ]),
      ),
    ).toBeCloseTo(6.4);
    expect(d("439531", u("f-none", feral, []))).toBeCloseTo(6);
    // 补丁留作典型值 + 修正登记在上(Barkskin 形状):无施法者 14 / 18,明确未持有 9 / 12
    const aff = CombatUnitSpec.Warlock_Affliction;
    expect(d("1269042", undefined)).toBeCloseTo(14);
    expect(d("1269042", u("w-eh", aff, [B2.ETERNAL_HUNGER]))).toBeCloseTo(14);
    // 「明确未持有」要一个真实可解析、但不是该天赋的节点 —— 空数组是 unknown,
    // 回退典型值(与时间膨胀那条同一纪律)
    expect(d("1269042", u("w-no", aff, [B2.QUIETUS]))).toBeCloseTo(9);
    expect(
      d("445584", u("w-df", CombatUnitSpec.Warrior_Arms, [B2.DEADLY_FOCUS])),
    ).toBeCloseTo(18);
    const BATTLEFIELD_COMMANDER = { id1: 108544, id2: 134033, count: 1 };
    expect(
      d(
        "445584",
        u("w-nodf", CombatUnitSpec.Warrior_Arms, [BATTLEFIELD_COMMANDER]),
      ),
    ).toBeCloseTo(12);
    // 两条多级天赋按**读出来的级数**:激流 ← 浪语者祝福 每级 +3(DB2 6000 是满级总值,
    // r1 21 s ×6、r2 24 s ×51);邪能毁灭 ← 盲目怒火 每级 +10%(r2 2.5 s ×21)
    const WAVESPEAKERS = (count: number) => ({
      id1: 103427,
      id2: 127671,
      count,
    });
    expect(d("61295", u("s-wb1", rsham, [WAVESPEAKERS(1)]))).toBeCloseTo(21);
    expect(d("61295", u("s-wb2", rsham, [WAVESPEAKERS(2)]))).toBeCloseTo(24);
    const BLIND_FURY = (count: number) => ({ id1: 91026, id2: 112949, count });
    expect(
      d(
        "393831",
        u("dh-bf2", CombatUnitSpec.DemonHunter_Havoc, [BLIND_FURY(2)]),
      ),
    ).toBeCloseTo(2.4);
    // 灵魂诅咒 ← 静默 ×0.8(label)/ 感染之爪 ← 黑檀热病 ×0.75(label)
    expect(d("450538", u("w-q", aff, [B2.QUIETUS]))).toBeCloseTo(8);
    expect(
      d(
        "1241786",
        u("dk-ef", CombatUnitSpec.DeathKnight_Unholy, [B2.EBON_FEVER]),
      ),
    ).toBeCloseTo(9);
  });

  it("2026-09-22 第三批(GH #65 第 2/3/5 项 + §51):按施加者拆出来的时长", () => {
    // 暗影之刃:手工 20 是移植值,施放那份 176/187 格 16 s = DB2
    expect(buffFullDurationForCaster("121471", undefined)).toBe(16);
    // 强化射击:由乱射施加,继承乱射的 6 s(501/510)
    expect(buffFullDurationForCaster("257622", undefined)).toBe(6);
    // 治疗之泉:15 / 18(图腾专注)/ 21.5(+ 辅助灌魔,语料值)
    const rsham = CombatUnitSpec.Shaman_Restoration;
    const TOTEMIC_FOCUS = { id1: 103625, id2: 127906, count: 1 };
    const IMBUEMENT_MASTERY = { id1: 94871, id2: 117468, count: 1 };
    const tf = makeUnit("s-tf", {
      spec: rsham,
      info: { talents: [TOTEMIC_FOCUS], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("5672", tf)).toBeCloseTo(18);
    const neither = makeUnit("s-none", {
      spec: rsham,
      info: { talents: [IMBUEMENT_MASTERY], pvpTalents: [] },
    });
    expect(buffFullDurationForCaster("5672", neither)).toBeCloseTo(15);
    expect(buffFullDurationForCaster("5672", undefined)).toBe(21.5);
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

  it("阶梯节点 (tiered nodes, maxRanks 4): 各 tier 按 entryId 独立读级数, 不会互相污染 (GH #102)", () => {
    // 战士狂暴 Apex 节点 110412 (Rampaging Berserker)
    // entry 137004 -> 1269308 (tier 1, count 1)
    // entry 137003 -> 1269309 (tier 2, count 2)
    // entry 137002 -> 1269310 (tier 3, count 1)
    const warrior = makeUnit("w-tiered", {
      spec: CombatUnitSpec.Warrior_Fury,
      info: {
        talents: [
          { id1: 110412, id2: 137002, count: 1 },
          { id1: 110412, id2: 137003, count: 2 },
          { id1: 110412, id2: 137004, count: 1 },
        ],
        pvpTalents: [],
      },
    });
    expect(talentRankOf(warrior, "1269308")).toBe(1);
    expect(talentRankOf(warrior, "1269309")).toBe(2);
    expect(talentRankOf(warrior, "1269310")).toBe(1);
    // 鲁莽 12 * (1 + 0.50 * 1) = 18s
    expect(buffFullDurationForCaster("1719", warrior)).toBeCloseTo(18);

    // 术士恶魔 Apex 节点 110404 (Dominion of Argus)
    // entry 136980 -> 1276163 (tier 1, count 1)
    // entry 136979 -> 1276190 (tier 2, count 2)
    // entry 136978 -> 1276222 (tier 3, count 1)
    const warlock = makeUnit("wl-tiered", {
      spec: CombatUnitSpec.Warlock_Demonology,
      info: {
        talents: [
          { id1: 110404, id2: 136978, count: 1 },
          { id1: 110404, id2: 136979, count: 2 },
          { id1: 110404, id2: 136980, count: 1 },
        ],
        pvpTalents: [],
      },
    });
    expect(talentRankOf(warlock, "1276163")).toBe(1);
    expect(talentRankOf(warlock, "1276190")).toBe(2);
    expect(talentRankOf(warlock, "1276222")).toBe(1);
    // 阿古斯之治: 萨洛拉丝 / 艾瑞达双子 10 + 4 * 1 = 14s
    expect(buffFullDurationForCaster("1282501", warlock)).toBeCloseTo(14);
    expect(buffFullDurationForCaster("1282502", warlock)).toBeCloseTo(14);
  });
});
