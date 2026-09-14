/**
 * ccFullDurationForCaster — talent-conditional CC duration (GH #44 tail,
 * 2026-09-02). The ccLifetimeScan FLAG on Intimidating Shout (7 s peak vs
 * DB2 6 s) resolved to Resonant Voice 1243660: DB2 aura 108 +20 % on the
 * Warrior shout mask, and 79 % of casters whose shout lived ~7 s held the
 * talent vs 0 % of those at ~6 s. The wrapper lengthens the base ONLY when
 * `talentOwnershipOf` answers "yes" — "unknown" (no talent data) stays at the
 * base, because a longer-CC claim must rest on evidence the player has it.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";

import { CC_DURATION_TALENT_MODIFIERS } from "../src/data/spellEffectData";
import { ccFullDurationForCaster } from "../src/utils/ccDuration";
import { talentOwnershipOf } from "../src/utils/talentOwnership";
import { makeUnit } from "./ported/testHelpers";

const INTIMIDATING_SHOUT = "5246";
const RESONANT_VOICE = "1243660";
// Warrior class-tree node 108685 / entry 134225 (talentIdMap.json, all three specs)
const RESONANT_VOICE_TALENT = { id1: 108685, id2: 134225, count: 1 };

describe("ccFullDurationForCaster — 天赋条件时长", () => {
  it("登记表:威吓怒吼 ← Resonant Voice +20%", () => {
    expect(CC_DURATION_TALENT_MODIFIERS[INTIMIDATING_SHOUT]).toEqual([
      expect.objectContaining({ talentSpellId: RESONANT_VOICE, pct: 20 }),
    ]);
  });

  it("持有 Resonant Voice 的战士:6s × 1.2 = 7.2s", () => {
    const warrior = makeUnit("w1", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
    });
    // sanity: the ownership predicate itself reads the real talent tree
    expect(talentOwnershipOf(warrior, RESONANT_VOICE)).toBe("yes");
    expect(ccFullDurationForCaster(INTIMIDATING_SHOUT, warrior)).toBeCloseTo(
      7.2,
    );
  });

  it("无天赋数据(unknown)或无施法者 → 保持官方 6s;不相关技能不受影响", () => {
    const unknown = makeUnit("w2", { spec: CombatUnitSpec.Warrior_Arms });
    expect(talentOwnershipOf(unknown, RESONANT_VOICE)).toBe("unknown");
    expect(ccFullDurationForCaster(INTIMIDATING_SHOUT, unknown)).toBe(6);
    expect(ccFullDurationForCaster(INTIMIDATING_SHOUT, undefined)).toBe(6);
    const talented = makeUnit("w3", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
    });
    expect(ccFullDurationForCaster("118", talented)).toBe(6); // Polymorph: no modifier
  });

  // GH #96 M5: Boneshaker 429639 — flat +1 s on the Shockwave stun (DB2 aura
  // 107), a hero talent Arms / Protection can take and Fury cannot.
  const SHOCKWAVE_STUN = "132168";
  const BONESHAKER = "429639";

  it("Boneshaker 持有者:震荡波眩晕 2s + 1s = 3s(平值秒数先加)", () => {
    const arms = makeUnit("w4", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
      // cast evidence is the ownership predicate's first rule; it stands in for
      // a hero-tree loadout here so the test pins the arithmetic, not the tree
      spellCastEvents: [
        {
          spellId: BONESHAKER,
          timestamp: 0,
          logLine: { event: "SPELL_CAST_SUCCESS" },
        },
      ],
    });
    expect(ccFullDurationForCaster(SHOCKWAVE_STUN, arms)).toBe(3);
  });

  it("狂怒战士:Boneshaker 不在狂怒天赋树里 → 不延长(原谓词会误判为 yes)", () => {
    const fury = makeUnit("w5", {
      spec: CombatUnitSpec.Warrior_Fury,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
    });
    // the trap: baseline-by-elimination
    expect(talentOwnershipOf(fury, BONESHAKER)).toBe("yes");
    expect(ccFullDurationForCaster(SHOCKWAVE_STUN, fury)).toBe(2);
  });
});
