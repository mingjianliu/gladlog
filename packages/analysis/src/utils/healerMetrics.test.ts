import { describe, expect, it } from "vitest";

import { computeHealerMetrics, playerAvoidedCcCount } from "./healerMetrics";

// Minimal synthetic combat: one healer unit, no damage and no healing →
// offensiveIndex=0 and everything else in its domain.
function stubCombat(): any {
  const healer = {
    id: "H-Realm-US",
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
    // #10 T3: a one-player combat has no teammate who can be under pressure →
    // gap totals of 0/0 (single source: detectHealingGaps).
    expect(m.healingGapSeconds).toBe(0);
    expect(m.healingGapCount).toBe(0);
  });
  it("healingGapSeconds/Count 反映 detectHealingGaps 检出的空窗(#10 T3,谓词单源)", () => {
    const c = stubCombat();
    const h = c.units["H-Realm-US"];
    // The healer casts once at 6s and is silent for the rest of the match → one
    // gap spanning 6s–60s.
    h.spellCastEvents = [
      {
        spellId: "2061",
        spellName: "Flash Heal",
        timestamp: 6_000,
        logLine: {
          event: "SPELL_CAST_SUCCESS",
          timestamp: 6_000,
          parameters: [],
        },
      },
    ];
    c.units["F-Realm-US"] = {
      id: "F-Realm-US",
      name: "F-Realm-US",
      type: 1,
      reaction: 2, // same side as the healer → teammate
      spec: "72", // Fury Warrior (not a healer, so the DPS pressure threshold applies)
      damageOut: [],
      damageIn: [
        {
          timestamp: 15_000,
          effectiveAmount: -100_000,
          logLine: { timestamp: 15_000 },
        },
      ],
      healOut: [],
      absorbsOut: [],
      spellCastEvents: [],
      actionIn: [],
      auraEvents: [],
      advancedActions: [],
      deathRecords: [],
      info: { teamId: "0" },
    };
    const m = computeHealerMetrics(c, "H-Realm-US");
    expect(m.healingGapCount).toBe(1);
    expect(m.healingGapSeconds).toBeCloseTo(54, 5); // 60s match - 6s last activity
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

describe("playerAvoidedCcCount (ccAvoidanceRate's numerator)", () => {
  // weekly review 2026-10-24: a Polymorph logged IMMUNE because the enemy's
  // own Freezing Trap 203337 was on the healer read as a control the healer
  // avoided
  it("an avoidance kept facts-only (the enemy's own Freezing Trap) is not the player's", () => {
    const at = (avoidanceSpellId: string) => ({ avoidanceSpellId }) as never;
    expect(
      playerAvoidedCcCount({
        ccAvoidedInstances: [at("203337"), at("8178"), at("378441")],
      }),
    ).toBe(1);
  });
});
