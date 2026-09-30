import { describe, expect, it } from "vitest";
import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import {
  computeRootReachability,
  formatRootReachabilityEntries,
  ROOT_SPELL_IDS,
  ROOT_UNREACHABLE_MIN_S,
  rootReachProvenFact,
} from "../src/utils/rootReachability";
import { CLOSE_RANGE_YARDS } from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
function unit(
  id: string,
  spec: CombatUnitSpec,
  reaction: CombatUnitReaction,
  x: number,
  opts: { rootedBy?: string; damagedAt?: number[] } = {},
): any {
  const samples = Array.from({ length: 30 }, (_, i) => ({
    timestamp: T0 + i * 1000,
    advancedActorPositionX: x,
    advancedActorPositionY: 0,
    logLine: { event: "ADVANCED_SAMPLE", timestamp: T0 + i * 1000 },
  }));
  const auraEvents = opts.rootedBy
    ? [
        {
          timestamp: T0 + 5000,
          spellId: "122",
          spellName: "Frost Nova",
          destUnitId: id,
          srcUnitId: opts.rootedBy,
          srcUnitName: "Mage",
          logLine: {
            event: "SPELL_AURA_APPLIED",
            timestamp: T0 + 5000,
            parameters: [],
          },
        },
        {
          timestamp: T0 + 11000,
          spellId: "122",
          spellName: "Frost Nova",
          destUnitId: id,
          srcUnitId: opts.rootedBy,
          srcUnitName: "Mage",
          logLine: {
            event: "SPELL_AURA_REMOVED",
            timestamp: T0 + 11000,
            parameters: [],
          },
        },
      ]
    : [];
  return {
    id,
    name: id,
    spec,
    reaction,
    info: { specId: spec },
    advancedActions: samples,
    auraEvents,
    damageIn: (opts.damagedAt ?? []).map((s) => ({
      timestamp: T0 + s * 1000,
      amount: 1000,
      effectiveAmount: 1000,
      logLine: { event: "SPELL_DAMAGE", timestamp: T0 + s * 1000 },
    })),
    deathRecords: [],
    spellCastEvents: [],
    healIn: [],
    damageOut: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
  };
}
const combat = {
  startTime: T0,
  endTime: T0 + 30_000,
  startInfo: { zoneId: "0" },
};

describe("rootReachability (GH #24)", () => {
  it("official root class is the universe (Frost Nova in, a stun out)", () => {
    expect(ROOT_SPELL_IDS.has("122")).toBe(true);
    expect(ROOT_SPELL_IDS.has("408")).toBe(false); // Kidney Shot
  });
  it("melee rooted with every enemy beyond CLOSE_RANGE_YARDS → 6 unreachable s, significant", () => {
    const me = unit(
      "Rogue",
      CombatUnitSpec.Rogue_Assassination,
      CombatUnitReaction.Friendly,
      0,
      { rootedBy: "Mage" },
    );
    const mage = unit(
      "Mage",
      CombatUnitSpec.Mage_Frost,
      CombatUnitReaction.Hostile,
      CLOSE_RANGE_YARDS + 10,
    );
    const [r] = computeRootReachability(combat, [me, mage]);
    expect(r.rootedRole).toBe("melee");
    expect(r.unreachableSeconds).toBe(6);
    expect(r.significant).toBe(true);
    expect(r.unreachableSeconds).toBeGreaterThanOrEqual(ROOT_UNREACHABLE_MIN_S);
    const [line] = formatRootReachabilityEntries([r], "Rogue");
    expect(line.line).toContain("[ROOT]");
    expect(line.line).toContain("[YOU] Rogue (melee)");
    expect(line.line).toContain(`beyond ${CLOSE_RANGE_YARDS}yd for 6s`);
  });
  it("melee rooted with an enemy inside melee reach → 0 unreachable, not rendered", () => {
    const me = unit(
      "Rogue",
      CombatUnitSpec.Rogue_Assassination,
      CombatUnitReaction.Friendly,
      0,
      { rootedBy: "Mage" },
    );
    const mage = unit(
      "Mage",
      CombatUnitSpec.Mage_Frost,
      CombatUnitReaction.Hostile,
      5,
    );
    const [r] = computeRootReachability(combat, [me, mage]);
    expect(r.unreachableSeconds).toBe(0);
    expect(formatRootReachabilityEntries([r], "Rogue")).toEqual([]);
  });
  it("healer: only a DAMAGED ally out of range counts; an idle ally far away does not", () => {
    const heal = unit(
      "Priest",
      CombatUnitSpec.Priest_Holy,
      CombatUnitReaction.Friendly,
      0,
      { rootedBy: "Mage" },
    );
    const farIdle = unit(
      "Idle",
      CombatUnitSpec.Warrior_Arms,
      CombatUnitReaction.Friendly,
      60,
    );
    const farHit = unit(
      "Hit",
      CombatUnitSpec.Rogue_Assassination,
      CombatUnitReaction.Friendly,
      60,
      { damagedAt: [6, 7, 8] },
    );
    const mage = unit(
      "Mage",
      CombatUnitSpec.Mage_Frost,
      CombatUnitReaction.Hostile,
      20,
    );
    const idleOnly = computeRootReachability(combat, [heal, farIdle, mage])[0];
    expect(idleOnly.unreachableSeconds).toBe(0);
    const withHit = computeRootReachability(combat, [heal, farHit, mage])[0];
    expect(withHit.unreachableSeconds).toBe(6);
    expect(withHit.worstAlly).toEqual({ name: "Hit", seconds: 6 });
    expect(
      formatRootReachabilityEntries([withHit], "Priest")[0].line,
    ).toContain("Hit (taking damage) out of range/LoS for 6s");
  });
});

describe("rootReachProvenS (triage missed-cleanse F-C5, A40 = B, U7)", () => {
  const rooted = () =>
    unit(
      "Rogue",
      CombatUnitSpec.Rogue_Assassination,
      CombatUnitReaction.Friendly,
      0,
      {
        rootedBy: "Mage",
      },
    );
  const near = () =>
    unit("Mage", CombatUnitSpec.Mage_Frost, CombatUnitReaction.Hostile, 2);
  const aura = (event: string, s: number, spellId: string) => ({
    timestamp: T0 + s * 1000,
    spellId,
    spellName: "Incapacitating Roar",
    destUnitId: "Rogue",
    srcUnitId: "Mage",
    srcUnitName: "Mage",
    logLine: { event, timestamp: T0 + s * 1000, parameters: [] },
  });
  it("every second reachable → N/N; the [ROOT] counts are unchanged", () => {
    const [r] = computeRootReachability(combat, [rooted(), near()]);
    expect(r.unreachableSeconds).toBe(0);
    expect(rootReachProvenFact(r)).toBe("6/6");
  });
  it("6062daf2 shape: a 3 s incapacitate inside the 6 s root → 3/6", () => {
    const me = rooted();
    me.auraEvents.push(
      aura("SPELL_AURA_APPLIED", 6.207, "99"),
      aura("SPELL_AURA_REMOVED", 9.209, "99"),
    );
    me.auraEvents.sort((a: any, b: any) => a.timestamp - b.timestamp);
    const [r] = computeRootReachability(combat, [me, near()]);
    expect(r.reachSweep).toMatchObject({ swept: 6, hardCc: 3, proven: 3 });
    expect(rootReachProvenFact(r)).toBe("3/6");
  });
  it("codex review: two hard CCs covering the same 0.3 s are 0.3 s of hard CC, not 0.6", () => {
    const me = rooted();
    me.auraEvents.push(
      aura("SPELL_AURA_APPLIED", 6.7, "99"),
      aura("SPELL_AURA_REMOVED", 7.0, "99"),
      aura("SPELL_AURA_APPLIED", 6.7, "408"),
      aura("SPELL_AURA_REMOVED", 7.0, "408"),
    );
    me.auraEvents.sort((a: any, b: any) => a.timestamp - b.timestamp);
    const [r] = computeRootReachability(combat, [me, near()]);
    // 300 ms < the 500 ms threshold → that second stays a reach second
    expect(r.reachSweep).toMatchObject({ swept: 6, hardCc: 0, proven: 6 });
    expect(rootReachProvenFact(r)).toBe("6/6");
  });
  it("positions removed → unknown seconds → no fact", () => {
    const me = rooted();
    me.advancedActions = [];
    const [r] = computeRootReachability(combat, [me, near()]);
    expect(rootReachProvenFact(r)).toBeNull();
  });
  it("an unreachable second → no fact", () => {
    const far = unit(
      "Mage",
      CombatUnitSpec.Mage_Frost,
      CombatUnitReaction.Hostile,
      CLOSE_RANGE_YARDS + 10,
    );
    const [r] = computeRootReachability(combat, [rooted(), far]);
    expect(rootReachProvenFact(r)).toBeNull();
  });
});
