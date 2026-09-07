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

import { BUFF_DURATION_TALENT_MODIFIERS } from "../src/data/spellEffectData";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
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
  it("无施法者 → 官方基础时长(与加天赋层之前的行为一致)", () => {
    expect(buffFullDurationForCaster(BARKSKIN, undefined)).toBe(8);
    expect(buffFullDurationForCaster(GUARDIAN_SPIRIT, undefined)).toBe(10);
    expect(buffFullDurationForCaster(TIME_DILATION, undefined)).toBe(8);
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
      info: { talents: [], pvpTalents: [] },
    });
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
    expect(buffFullDurationForCaster(BARKSKIN, noInfo)).toBe(8);
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
