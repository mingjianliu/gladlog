/**
 * ccFullDurationForCaster — talent-conditional CC duration (GH #44 tail,
 * 2026-09-02). The ccLifetimeScan FLAG on Intimidating Shout (7 s peak vs
 * DB2 6 s) resolved to Resonant Voice 1243660: DB2 aura 108 +20 % on the
 * Warrior shout mask, and 79 % of casters whose shout lived ~7 s held the
 * talent vs 0 % of those at ~6 s. The wrapper lengthens the base ONLY when
 * `talentOwnershipOf` answers "yes" — "unknown" (no talent data) stays at the
 * base, because a longer-CC claim must rest on evidence the player has it.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  CC_DURATION_TALENT_MODIFIERS,
  ccFullDurationSeconds,
  OPPRESSING_ROAR_LENGTHENED_MECHANICS,
  OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
  OPPRESSING_ROAR_SPELL_ID,
  PRISMATIC_BARRIER_AURA_IDS,
  PRISMATIC_BARRIER_DISPEL_TYPE,
  PRISMATIC_BARRIER_PVP_MAGIC_DURATION_MULT,
} from "../src/data/spellEffectData";
import spellEffects from "../src/data/spellEffectGenerated.json";
import inventory from "../src/data/talentEffectInventoryGenerated.json";
import {
  ccLandingStateAt,
  prismaticBarrierOnAtMs,
} from "../src/utils/ccBreakAnalysis";
import {
  ccFullDurationForApplication,
  ccFullDurationForCaster,
  type ICcLandingState,
  NO_CC_LANDING_STATE,
  oppressingRoarLengthens,
  prismaticBarrierShortens,
} from "../src/utils/ccDuration";
import { ccMechanicOf } from "../src/utils/spellMechanics";
import { talentOwnershipOf } from "../src/utils/talentOwnership";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const ROAR: ICcLandingState = { roar: true, prismaticBarrier: false };
const BARRIER: ICcLandingState = { roar: false, prismaticBarrier: true };
const BARRIER_AURA = "235450";
const MERELY_A_SETBACK = "449336";

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

  // GH #123 (user ruling 2026-11-06): Airborne Irritant −35 % (DB2 −70 % ×
  // PvP 0.5), written on DB2 + tooltip with no holder in the corpus yet
  it("Airborne Irritant:持有者的致盲 5 s × 0.65 = 3.25 s;没有数据或没点的仍是 5 s", () => {
    const AIRBORNE_IRRITANT = { id1: 90741, id2: 117740, count: 1 };
    const holder = makeUnit("r1", {
      spec: CombatUnitSpec.Rogue_Subtlety,
      info: { talents: [AIRBORNE_IRRITANT], pvpTalents: [] },
    });
    expect(talentOwnershipOf(holder, "200733")).toBe("yes");
    expect(ccFullDurationForCaster("2094", holder)).toBeCloseTo(3.25);
    // the same DB2 row covers the second Blind id (codex review 2026-11-06)
    expect(ccFullDurationForCaster("427773", holder)).toBeCloseTo(3.25);
    const without = makeUnit("r2", {
      spec: CombatUnitSpec.Rogue_Subtlety,
      info: { talents: [], pvpTalents: [] },
    });
    expect(ccFullDurationForCaster("2094", without)).toBe(5);
    expect(ccFullDurationForCaster("427773", without)).toBe(5);
    const unknown = makeUnit("r3", { spec: CombatUnitSpec.Rogue_Subtlety });
    expect(ccFullDurationForCaster("2094", unknown)).toBe(5);
    for (const id of ["2094", "427773"])
      expect(CC_DURATION_TALENT_MODIFIERS[id]?.[0]?.corpusPending).toBeTruthy();
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

  // user ruling 2026-10-21: Improved Frost Nova 343183, +2 s (tooltip,
  // corpus-confirmed) — the holder's Frost Nova is priced at 8 s
  it("Improved Frost Nova holder: Frost Nova 6 s + 2 s = 8 s; unknown stays 6 s", () => {
    const mage = makeUnit("m1", {
      spec: CombatUnitSpec.Mage_Frost,
      info: { talents: [{ id1: 62110, id2: 80168, count: 1 }], pvpTalents: [] },
    });
    expect(talentOwnershipOf(mage, "343183")).toBe("yes");
    expect(ccFullDurationSeconds("122")).toBe(6);
    expect(ccFullDurationForCaster("122", mage)).toBe(8);
    expect(
      ccFullDurationForCaster(
        "122",
        makeUnit("m2", { spec: CombatUnitSpec.Mage_Frost }),
      ),
    ).toBe(6);
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
      ccFullDurationForApplication(
        TERROR_OF_THE_SKIES,
        undefined,
        NO_CC_LANDING_STATE,
      ),
    ).toBe(3);
    expect(
      ccFullDurationForApplication(TERROR_OF_THE_SKIES, undefined, ROAR),
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
      expect(
        ccFullDurationForApplication(id, undefined, NO_CC_LANDING_STATE),
        id,
      ).toBe(
        ccFullDurationForCaster(id, undefined),
      );
  });

  it("a mechanic the Roar does not list keeps its length under it; no duration stays no duration", () => {
    expect(ccFullDurationForApplication(MORTAL_COIL, undefined, ROAR)).toBe(
      ccFullDurationSeconds(MORTAL_COIL),
    );
    expect(
      ccFullDurationForApplication(CHASTISE, undefined, ROAR),
    ).toBeUndefined();
    expect(
      ccFullDurationForApplication("no-such-id", undefined, ROAR),
    ).toBeUndefined();
  });

  it("the Roar multiplies the caster's own length: Resonant Voice 7.2 s × 1.3", () => {
    const warrior = makeUnit("w6", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [RESONANT_VOICE_TALENT], pvpTalents: [] },
    });
    expect(
      ccFullDurationForApplication(INTIMIDATING_SHOUT, warrior, ROAR),
    ).toBeCloseTo(6 * 1.2 * 1.3, 6);
  });

  it("Chaos Nova and Void Nova stay on DB2's 3 s — their 4 s plateau has no known mechanism and is not the Roar", () => {
    expect(ccFullDurationSeconds(CHAOS_NOVA)).toBe(3);
    expect(ccFullDurationSeconds(VOID_NOVA)).toBe(3);
  });
});

describe("GH #126 — Prismatic Barrier shortens a Magic CC on its holder by 15 %", () => {
  const POLYMORPH = "118"; // Magic, 6 s
  const HAMMER_OF_JUSTICE = "853"; // Magic, 5 s
  const CHEAP_SHOT = "1833"; // not Magic, 4 s
  const T = 1_700_000_000_000;

  it("the −15 % and the Magic type are the inventory's aura-245 row of 235450 (the DB2 leg, re-checked on every data refresh)", () => {
    const rows = (
      inventory as unknown as {
        rows: Array<{
          spellId: string;
          aura: number;
          misc0: number;
          basePoints: number;
          pvpMultiplier?: number;
          activation?: string;
        }>;
      }
    ).rows.filter(
      (r) => r.spellId === BARRIER_AURA && r.aura === 245,
    );
    expect(rows).toHaveLength(1);
    // SpellDispelType 1 = Magic
    expect(rows[0]!.misc0).toBe(1);
    expect(PRISMATIC_BARRIER_DISPEL_TYPE).toBe("Magic");
    expect(rows[0]!.activation).toBe("whileAura");
    expect(
      1 + (rows[0]!.basePoints * (rows[0]!.pvpMultiplier ?? 1)) / 100,
    ).toBeCloseTo(PRISMATIC_BARRIER_PVP_MAGIC_DURATION_MULT, 6);
    expect(PRISMATIC_BARRIER_PVP_MAGIC_DURATION_MULT).toBeCloseTo(0.85, 6);
  });

  it("a Magic CC under the barrier runs 0.85 of its length; a non-Magic one keeps it", () => {
    expect(prismaticBarrierShortens(POLYMORPH)).toBe(true);
    expect(prismaticBarrierShortens(CHEAP_SHOT)).toBe(false);
    expect(
      ccFullDurationForApplication(POLYMORPH, undefined, BARRIER),
    ).toBeCloseTo(6 * 0.85, 6);
    expect(
      ccFullDurationForApplication(HAMMER_OF_JUSTICE, undefined, BARRIER),
    ).toBeCloseTo(5 * 0.85, 6);
    expect(ccFullDurationForApplication(CHEAP_SHOT, undefined, BARRIER)).toBe(
      ccFullDurationSeconds(CHEAP_SHOT),
    );
  });

  it("the Roar and the barrier both apply: 6 × 1.3 × 0.85", () => {
    expect(
      ccFullDurationForApplication(POLYMORPH, undefined, {
        roar: true,
        prismaticBarrier: true,
      }),
    ).toBeCloseTo(6 * 1.3 * 0.85, 6);
  });

  it("the barrier is read off the interval builder: up between its APPLIED and REMOVED, and from before the round when only its REMOVED is logged", () => {
    const mage = (rows: ReturnType<typeof makeAuraEvent>[]) =>
      makeUnit("mage", { auraEvents: rows });
    const own = (ev: LogEvent, ms: number) =>
      makeAuraEvent(ev, BARRIER_AURA, ms, "mage", "mage", "BUFF");
    const inRound = mage([
      own(LogEvent.SPELL_AURA_APPLIED, T + 10_000),
      own(LogEvent.SPELL_AURA_REMOVED, T + 14_000),
    ]);
    expect(prismaticBarrierOnAtMs(inRound, T + 9_000)).toBe(false);
    expect(prismaticBarrierOnAtMs(inRound, T + 12_000)).toBe(true);
    expect(prismaticBarrierOnAtMs(inRound, T + 15_000)).toBe(false);
    // put up in the preparation room: the round logs only its fall
    const preRound = mage([own(LogEvent.SPELL_AURA_REMOVED, T + 3_000)]);
    expect(prismaticBarrierOnAtMs(preRound, T + 1_000)).toBe(true);
    expect(prismaticBarrierOnAtMs(preRound, T + 4_000)).toBe(false);
    // no barrier rows at all
    expect(prismaticBarrierOnAtMs(mage([]), T + 1_000)).toBe(false);
  });

  it("the landing state is read in log order: a Roar REMOVED after the CC's APPLIED in the same ms was on as it landed (the reading the DR gate shares — codex 20-cat4A-02)", () => {
    const roarRow = (ev: LogEvent, ms: number) =>
      makeAuraEvent(ev, OPPRESSING_ROAR_SPELL_ID, ms, "evoker", "mage", "DEBUFF");
    const poly = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      POLYMORPH,
      T + 5_000,
      "priest",
      "mage",
      "DEBUFF",
    );
    const mage = makeUnit("mage", {
      auraEvents: [
        roarRow(LogEvent.SPELL_AURA_APPLIED, T + 3_000),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, MERELY_A_SETBACK, T + 4_000, "mage", "mage", "BUFF"),
        poly,
        roarRow(LogEvent.SPELL_AURA_REMOVED, T + 5_000),
      ],
    });
    const landing = ccLandingStateAt(mage, poly as never);
    expect(landing).toEqual({ roar: true, prismaticBarrier: true });
    expect(ccFullDurationForApplication(POLYMORPH, undefined, landing)).toBeCloseTo(
      6 * 1.3 * 0.85,
      6,
    );
  });

  it("Merely a Setback counts as the barrier: the 8 s aura the barrier leaves when it falls (same DB2 aura-245 row; the inventory has no row for it, so its id and generated length are pinned here)", () => {
    expect([...PRISMATIC_BARRIER_AURA_IDS].sort()).toEqual([
      BARRIER_AURA,
      MERELY_A_SETBACK,
    ]);
    const setback = (
      spellEffects as unknown as Record<
        string,
        { name?: string; durationSeconds?: number }
      >
    )[MERELY_A_SETBACK];
    expect(setback?.name).toBe("Merely a Setback");
    expect(setback?.durationSeconds).toBe(8);
    const own = (id: string, ev: LogEvent, ms: number) =>
      makeAuraEvent(ev, id, ms, "mage", "mage", "BUFF");
    const fell = makeUnit("mage", {
      auraEvents: [
        own(BARRIER_AURA, LogEvent.SPELL_AURA_APPLIED, T + 10_000),
        own(BARRIER_AURA, LogEvent.SPELL_AURA_REMOVED, T + 14_000),
        own(MERELY_A_SETBACK, LogEvent.SPELL_AURA_APPLIED, T + 14_000),
        own(MERELY_A_SETBACK, LogEvent.SPELL_AURA_REMOVED, T + 22_000),
      ],
    });
    expect(prismaticBarrierOnAtMs(fell, T + 20_600)).toBe(true);
    expect(prismaticBarrierOnAtMs(fell, T + 23_000)).toBe(false);
    // a REMOVED never logged: it ends at its 8 s length
    const unlogged = makeUnit("mage", {
      auraEvents: [own(MERELY_A_SETBACK, LogEvent.SPELL_AURA_APPLIED, T + 14_000)],
    });
    expect(prismaticBarrierOnAtMs(unlogged, T + 21_000)).toBe(true);
    expect(prismaticBarrierOnAtMs(unlogged, T + 23_000)).toBe(false);
  });
});
