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

import {
  CC_DURATION_TALENT_MODIFIERS,
  ccFullDurationSeconds,
  OPPRESSING_ROAR_LENGTHENED_MECHANICS,
  OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
  OPPRESSING_ROAR_SPELL_ID,
} from "../src/data/spellEffectData";
import inventory from "../src/data/talentEffectInventoryGenerated.json";
import {
  ccFullDurationForApplication,
  ccFullDurationForCaster,
  oppressingRoarLengthens,
} from "../src/utils/ccDuration";
import { ccMechanicOf } from "../src/utils/spellMechanics";
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

  // GH #96 review (agy): ccFullDurationForCaster applies a modifier once, not
  // per rank. That is only right while every registered talent is single-rank —
  // a maxRanks > 1 entry must add rank handling first (buffDuration has it).
  it("登记的控制时长天赋全部是单级节点(否则要先按级数计价)", async () => {
    const map = (await import("../src/data/talentIdMap.json")).default as any[];
    const maxRanks = new Map<string, number>();
    for (const spec of map)
      for (const node of [
        ...(spec.classNodes ?? []),
        ...(spec.specNodes ?? []),
        ...(spec.heroNodes ?? []),
      ])
        for (const e of node.entries ?? [])
          if (e.spellId) maxRanks.set(String(e.spellId), node.maxRanks);
    for (const mods of Object.values(CC_DURATION_TALENT_MODIFIERS))
      for (const m of mods) expect(maxRanks.get(m.talentSpellId)).toBe(1);
  });

  // GH #96 M6: Binding Shot's corpus patch (3 s) already carries Tar-Coated
  // Bindings (~91 % of casters) — only a definite non-holder is 2 s.
  it("束缚射击:基础 3 秒已含焦油缚链;确定没点的猎人才是 2 秒,未知仍是 3 秒", () => {
    const unknown = makeUnit("h1", { spec: CombatUnitSpec.Hunter_Survival });
    expect(ccFullDurationForCaster("117526", unknown)).toBe(3);
    expect(ccFullDurationForCaster("117526", undefined)).toBe(3);
    // a Priest cannot hold a Hunter talent → definite "no"
    const priest = makeUnit("p1", {
      spec: CombatUnitSpec.Priest_Discipline,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
    });
    expect(ccFullDurationForCaster("117526", priest)).toBe(2);
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

/**
 * FT-T07 (user decision D9, 2026-10-10): the length of ONE application —
 * Oppressing Roar on the target as the CC lands lengthens it by 30 %, for the
 * mechanics the Roar's DB2 rows list. `ccFullDurationSeconds` /
 * `ccFullDurationForCaster` (the spell's official number) do not move.
 */
describe("ccFullDurationForApplication — Oppressing Roar on the target", () => {
  const TERROR_OF_THE_SKIES = "372245"; // stun (mechanic 12), DB2 3 s
  const POLYMORPH = "118"; // polymorph (17), 6 s
  const MORTAL_COIL = "6789"; // horror (24) — not on the Roar's rows
  const CHASTISE = "88625"; // no DB2 mechanic, no fixed duration
  const CHAOS_NOVA = "179057";
  const VOID_NOVA = "1234195";

  it("the covered mechanics and the +30 % are the inventory's aura-232 rows of 372048 (the DB2 leg, re-checked on every data refresh)", () => {
    const rows = (
      inventory as unknown as {
        rows: Array<{
          spellId: string;
          aura: number;
          misc0: number;
          basePoints: number;
          pvpMultiplier?: number;
        }>;
      }
    ).rows.filter(
      (r) => r.spellId === OPPRESSING_ROAR_SPELL_ID && r.aura === 232,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.misc0).sort((a, b) => a - b)).toEqual(
      [...OPPRESSING_ROAR_LENGTHENED_MECHANICS].sort((a, b) => a - b),
    );
    for (const r of rows)
      expect(1 + (r.basePoints * (r.pvpMultiplier ?? 1)) / 100).toBeCloseTo(
        OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
        6,
      );
  });

  it("coverage is read off the CC's own DB2 mechanic; an unknown mechanic is not lengthened", () => {
    expect(ccMechanicOf(TERROR_OF_THE_SKIES)).toBe(12);
    expect(oppressingRoarLengthens(TERROR_OF_THE_SKIES)).toBe(true);
    expect(oppressingRoarLengthens(POLYMORPH)).toBe(true);
    expect(ccMechanicOf(MORTAL_COIL)).toBe(24);
    expect(oppressingRoarLengthens(MORTAL_COIL)).toBe(false);
    expect(ccMechanicOf(CHASTISE)).toBeUndefined();
    expect(oppressingRoarLengthens(CHASTISE)).toBe(false);
  });

  it("Terror of the Skies: 3 s without the Roar, 3 × 1.3 = 3.9 s with it on the target", () => {
    expect(ccFullDurationSeconds(TERROR_OF_THE_SKIES)).toBe(3);
    expect(
      ccFullDurationForApplication(TERROR_OF_THE_SKIES, undefined, false),
    ).toBe(3);
    expect(
      ccFullDurationForApplication(TERROR_OF_THE_SKIES, undefined, true),
    ).toBeCloseTo(3.9, 6);
  });

  it("without the Roar an application is exactly the caster's full duration", () => {
    for (const id of [
      TERROR_OF_THE_SKIES,
      POLYMORPH,
      MORTAL_COIL,
      INTIMIDATING_SHOUT,
      CHAOS_NOVA,
      VOID_NOVA,
    ])
      expect(ccFullDurationForApplication(id, undefined, false), id).toBe(
        ccFullDurationForCaster(id, undefined),
      );
  });

  it("a mechanic the Roar does not list keeps its length under it; no duration stays no duration", () => {
    expect(ccFullDurationForApplication(MORTAL_COIL, undefined, true)).toBe(
      ccFullDurationSeconds(MORTAL_COIL),
    );
    expect(
      ccFullDurationForApplication(CHASTISE, undefined, true),
    ).toBeUndefined();
    expect(
      ccFullDurationForApplication("no-such-id", undefined, true),
    ).toBeUndefined();
  });

  it("the Roar multiplies the caster's own length: Resonant Voice 7.2 s × 1.3", () => {
    const warrior = makeUnit("w6", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
    });
    expect(
      ccFullDurationForApplication(INTIMIDATING_SHOUT, warrior, true),
    ).toBeCloseTo(6 * 1.2 * 1.3, 6);
  });

  it("Chaos Nova and Void Nova stay on DB2's 3 s — their 4 s plateau has no known mechanism and is not the Roar", () => {
    expect(ccFullDurationSeconds(CHAOS_NOVA)).toBe(3);
    expect(ccFullDurationSeconds(VOID_NOVA)).toBe(3);
  });
});
