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
  it("computes a finite, nonzero offensiveIndex when the healer dealt damage and shielded", () => {
    // Regression: absorbsOut carries `absorbedAmount`, not `effectiveAmount`.
    // Reading the wrong field made totalHealOut NaN → offensiveIndex silently 0
    // for every real healer with shields (e.g. Disc Priest, Resto Shaman).
    const c = stubCombat();
    const h = c.units["H-Realm-US"];
    h.damageOut = [
      {
        spellId: "589",
        spellName: "Shadow Word: Pain",
        timestamp: 1000,
        effectiveAmount: -1000,
        logLine: { event: "SPELL_DAMAGE", timestamp: 1000, parameters: [] },
      },
    ];
    h.healOut = [
      {
        spellId: "2061",
        spellName: "Flash Heal",
        timestamp: 2000,
        effectiveAmount: 2000,
        logLine: { event: "SPELL_HEAL", timestamp: 2000, parameters: [] },
      },
    ];
    h.absorbsOut = [
      {
        spellId: "17",
        spellName: "Power Word: Shield",
        timestamp: 3000,
        absorbedAmount: 500,
        logLine: { event: "SPELL_ABSORBED", timestamp: 3000, parameters: [] },
      },
    ];
    const m = computeHealerMetrics(c, "H-Realm-US");
    expect(Number.isFinite(m.offensiveIndex)).toBe(true);
    expect(m.offensiveIndex).toBeGreaterThan(0);
    // 1000 damage / (2000 heal + 500 absorb) = 0.4
    expect(m.offensiveIndex).toBeCloseTo(0.4, 5);
  });
  it("throws when the named healer is absent", () => {
    expect(() => computeHealerMetrics(stubCombat(), "Nobody")).toThrow(
      /not found/,
    );
  });
});
