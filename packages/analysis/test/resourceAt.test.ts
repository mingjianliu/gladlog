import { CombatUnitPowerType, ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { HP_SAMPLE_RADIUS_MS } from "../src/utils/cooldowns";
import {
  getUnitResourceAtTimestamp,
  MANA_POWER_TYPE,
  resourceDeltaPct,
} from "../src/utils/resourceAt";

describe("resourceAt — getUnitResourceAtTimestamp", () => {
  const makeUnit = (advancedActions: unknown[] = []): ICombatUnit =>
    ({
      id: "Player-1234",
      name: "Healer",
      advancedActions,
    }) as unknown as ICombatUnit;

  it("returns null when unit has no advanced actions", () => {
    const unit = makeUnit([]);
    expect(getUnitResourceAtTimestamp(unit, 10_000)).toBeNull();
  });

  it("returns null when closest action belongs to a different unit", () => {
    const unit = makeUnit([
      {
        advancedActorId: "Other-Unit",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Mana, current: 200_000, max: 250_000 },
        ],
      },
    ]);
    expect(getUnitResourceAtTimestamp(unit, 10_000)).toBeNull();
  });

  it("returns null when closest action timestamp is outside maxDtMs radius", () => {
    const unit = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 + HP_SAMPLE_RADIUS_MS + 1 },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Mana, current: 200_000, max: 250_000 },
        ],
      },
    ]);
    expect(getUnitResourceAtTimestamp(unit, 10_000)).toBeNull();
  });

  it("returns null when power type is missing from sample", () => {
    const unit = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Rage, current: 50, max: 100 },
        ],
      },
    ]);
    expect(getUnitResourceAtTimestamp(unit, 10_000, CombatUnitPowerType.Mana)).toBeNull();
  });

  it("returns null when max power is non-positive or non-finite", () => {
    const unitZeroMax = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Mana, current: 0, max: 0 },
        ],
      },
    ]);
    expect(getUnitResourceAtTimestamp(unitZeroMax, 10_000)).toBeNull();

    const unitNaN = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Mana, current: NaN, max: 250_000 },
        ],
      },
    ]);
    expect(getUnitResourceAtTimestamp(unitNaN, 10_000)).toBeNull();
  });

  it("returns correct current, max, and rounded pct when sample matches", () => {
    const unit = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_050 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 175_000, max: 250_000 },
        ],
      },
    ]);
    const reading = getUnitResourceAtTimestamp(unit, 10_000);
    expect(reading).toEqual({
      current: 175_000,
      max: 250_000,
      pct: 70,
    });
  });
});

describe("resourceAt — resourceDeltaPct", () => {
  const makeUnit = (samples: Array<{ t: number; current: number; max: number }>): ICombatUnit =>
    ({
      id: "Player-1234",
      name: "Healer",
      advancedActions: samples.map((s) => ({
        advancedActorId: "Player-1234",
        logLine: { timestamp: s.t },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Mana, current: s.current, max: s.max },
        ],
      })),
    }) as unknown as ICombatUnit;

  it("returns null if either endpoint has no reading in range", () => {
    const unit = makeUnit([{ t: 10_000, current: 200_000, max: 250_000 }]);
    // 30_000 is 20s away, beyond HP_SAMPLE_RADIUS_MS
    expect(resourceDeltaPct(unit, 10_000, 30_000)).toBeNull();
    expect(resourceDeltaPct(unit, 5_000, 10_000)).toBeNull();
  });

  it("computes fromPct, toPct, and deltaPct correctly", () => {
    const unit = makeUnit([
      { t: 10_000, current: 200_000, max: 250_000 }, // 80%
      { t: 25_000, current: 150_000, max: 250_000 }, // 60%
    ]);
    const delta = resourceDeltaPct(unit, 10_000, 25_000);
    expect(delta).toEqual({
      fromPct: 80,
      toPct: 60,
      deltaPct: -20,
    });
  });
});
