import { describe, expect, it } from "vitest";
import { computeHealerMetrics } from "./healerMetrics";

// 最小合成 combat:一个治疗单位,无伤害无治疗 → offensiveIndex=0,其余为定义域内。
function stubCombat(): any {
  const healer = {
    name: "H-Realm-US",
    type: 1,
    reaction: 2,
    spec: "264", // Resto Shaman
    damageOut: [],
    damageIn: [],
    healOut: [],
    absorbsOut: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    info: { teamId: "0" },
  };
  return {
    units: { "H-Realm-US": healer },
    startTime: 0,
    endTime: 60000,
    playerId: "H-Realm-US",
    startInfo: { zoneId: 1 },
  };
}

describe("computeHealerMetrics", () => {
  it("returns all six metrics in-domain for a no-op healer", () => {
    const m = computeHealerMetrics(stubCombat(), "H-Realm-US");
    expect(m.offensiveIndex).toBe(0);
    expect(m.ccDensity).toBe(0);
    expect(m.reactionLatency).toBeNull();
    expect(m.effectiveCastRatio).toBeGreaterThanOrEqual(0);
    expect(m.ccAvoidanceRate).toBeGreaterThanOrEqual(0);
    expect(m.defensiveOverlapRatio).toBeGreaterThanOrEqual(0);
    expect(m.burstResponseCoverage).toEqual({ answered: 0, windows: 0 });
  });
  it("throws when the named healer is absent", () => {
    expect(() => computeHealerMetrics(stubCombat(), "Nobody")).toThrow(
      /not found/,
    );
  });
});
