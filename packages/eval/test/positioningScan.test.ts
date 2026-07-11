/**
 * 几何 grounding 扫描器单测——合成静止单位夹具(位移为零,变异必须 100% 检出,
 * 快速移动逃逸不可触发),承担变异检出硬门。
 */
import { describe, expect, it } from "vitest";
import {
  checkGeoClaims,
  extractGeoClaims,
} from "../src/quality/positioningScan";

/** 静止单位:整场固定坐标。 */
function staticUnit(name: string, x: number, y: number, startMs: number): any {
  const advancedActions = Array.from({ length: 61 }, (_, i) => i * 2_000).map((dt) => ({
    timestamp: startMs + dt,
    advancedActorCurrentHp: 100,
    advancedActorMaxHp: 100,
    advancedActorPositionX: x,
    advancedActorPositionY: y,
    advanced: true,
    advancedActorPowers: [],
  }));
  return { name, advancedActions };
}

const START = 1_000_000;
// owner 在原点,敌方施法者在 (10, 0) —— 距离恒 10yd
const owner = staticUnit("Me-Realm-US", 0, 0, START);
const friendB = staticUnit("Buddy-Realm-US", 0, 5, START);
const caster = staticUnit("Bad-Realm-US", 10, 0, START);

const ctx = {
  owner,
  friends: [owner, friendB],
  enemies: [caster],
  zoneId: "1505", // Nagrand — 无障碍物数据的 zone 用于 G5 测试时另配
  matchStartMs: START,
  unitIdMap: new Map<number, string>([
    [1, "Me-Realm-US"],
    [2, "Buddy-Realm-US"],
    [3, "Bad-Realm-US"],
  ]),
};

const PROMPT = [
  '  <unit id="1" name="Me-Realm-US" spec="Holy Paladin" role="log owner">',
  '  <unit id="2" name="Buddy-Realm-US" spec="Arms Warrior" role="teammate">',
  '  <unit id="3" name="Bad-Realm-US" spec="Subtlety Rogue" role="enemy">',
  "0:30  [CC ON TEAM]   1(HPaladin) ← Cheap Shot (by 3(SRogue)) | 4s [DR: Stun Full] | 10.0yd from caster",
  "  0:40–0:50 you were camped by Bad-Realm-US (closest 10.0yd) — peel or reposition opportunity",
  "    0:55 [High burst] 10→10yd from Bad-Realm-US — you were the burst target",
].join("\n");

describe("extractGeoClaims", () => {
  it("extracts unit id map and all claim kinds", () => {
    const { claims, unitIdMap } = extractGeoClaims(PROMPT);
    expect(unitIdMap.get(3)).toBe("Bad-Realm-US");
    expect(claims.map((c) => c.kind)).toEqual([
      "CC_DISTANCE",
      "TRAINED",
      "STAYED_OR_KITED",
    ]);
    const cc = claims[0];
    expect(cc.targetName).toBe("1(HPaladin)");
    expect(cc.unitName).toBe("3(SRogue)");
    expect(cc.distanceYards).toBe(10);
  });
});

describe("checkGeoClaims on static fixture", () => {
  it("true claims pass with 0 violations", () => {
    const { claims } = extractGeoClaims(PROMPT);
    const r = checkGeoClaims(claims, ctx);
    expect(r.checked).toBeGreaterThan(0);
    // TRAINED 定义违规(10yd > 8yd)是预期内的一条——把它换成合规距离验证
    const defViolations = r.violations.filter(
      (v) => v.code !== "G2_TRAINED_DEFINITION",
    );
    expect(defViolations).toEqual([]);
  });

  it("distance mutation (+15yd) is detected on every claim kind (静止单位无逃逸)", () => {
    const { claims } = extractGeoClaims(PROMPT);
    for (const c of claims) {
      const r = checkGeoClaims(
        [{ ...c, distanceYards: c.distanceYards + 15 }],
        ctx,
      );
      expect(r.checked, c.kind).toBe(1);
      expect(r.violations.length, c.kind).toBeGreaterThan(0);
    }
  });

  it("wrong-unit mutation is detected (CC caster swapped to a friend 5yd away)", () => {
    const { claims } = extractGeoClaims(PROMPT);
    const cc = claims.find((c) => c.kind === "CC_DISTANCE")!;
    // 施法者换成 (0,5) 的队友 → caster→target 距离 5yd ≠ 主张 10yd
    const r = checkGeoClaims([{ ...cc, unitName: "2(AWarrior)" }], ctx);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it("impossible CC distance (>50yd) flags G6", () => {
    const far = staticUnit("Far-Realm-US", 60, 0, START);
    const farCtx = {
      ...ctx,
      enemies: [far],
      unitIdMap: new Map([
        [1, "Me-Realm-US"],
        [3, "Far-Realm-US"],
      ]),
    };
    const prompt =
      "0:30  [CC ON TEAM]   1(HPaladin) ← Freezing Trap (by 3(BMHunter)) | 4s [DR: Stun Full] | 60.0yd from caster";
    const { claims } = extractGeoClaims(prompt);
    const r = checkGeoClaims(claims, farCtx);
    expect(r.violations.some((v) => v.code === "G6_IMPOSSIBLE_CC")).toBe(true);
  });

  it("LoS-break claim on a zone without obstacle data flags G5_NO_GEOMETRY", () => {
    const prompt =
      "0:07  [HEALER EXPOSURE]   Moderate burst — trinket ready — ⚠ Exposed — LoS break ~12.3yd away (pillar-blocks Bad-Realm-US) | …";
    const { claims } = extractGeoClaims(prompt);
    expect(claims).toHaveLength(1);
    const r = checkGeoClaims(claims, { ...ctx, zoneId: "999999" });
    expect(r.violations.some((v) => v.code === "G5_NO_GEOMETRY")).toBe(true);
  });
});
