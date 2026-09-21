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

  it("handles out-of-order and jittered timestamps via sorted view (N12)", () => {
    // Jittered array: [10000, 10020, 10010]
    const unitJitter = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 100_000, max: 250_000 },
        ],
      },
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_020 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 120_000, max: 250_000 },
        ],
      },
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_010 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 110_000, max: 250_000 },
        ],
      },
    ]);
    const reading = getUnitResourceAtTimestamp(unitJitter, 10_010);
    expect(reading).toEqual({
      current: 110_000,
      max: 250_000,
      pct: 44,
    });

    // Completely reversed array
    const unitReversed = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_200 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 200_000, max: 250_000 },
        ],
      },
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_100 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 150_000, max: 250_000 },
        ],
      },
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 100_000, max: 250_000 },
        ],
      },
    ]);
    expect(getUnitResourceAtTimestamp(unitReversed, 10_100)).toEqual({
      current: 150_000,
      max: 250_000,
      pct: 60,
    });
  });

  it("handles exact radius boundary vs outside radius", () => {
    const unit = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 + HP_SAMPLE_RADIUS_MS },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 150_000, max: 250_000 },
        ],
      },
    ]);
    // Exactly at HP_SAMPLE_RADIUS_MS -> valid
    expect(getUnitResourceAtTimestamp(unit, 10_000)).toEqual({
      current: 150_000,
      max: 250_000,
      pct: 60,
    });
    // At HP_SAMPLE_RADIUS_MS + 1 -> null
    expect(getUnitResourceAtTimestamp(unit, 10_000 - 1)).toBeNull();
  });

  it("handles equidistant neighbors by choosing the earlier timestamp", () => {
    const unit = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_000 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 100_000, max: 250_000 },
        ],
      },
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_020 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 200_000, max: 250_000 },
        ],
      },
    ]);
    // Query exactly halfway at 10_010 (both are 10ms away) -> picks earlier (10_000)
    expect(getUnitResourceAtTimestamp(unit, 10_010)).toEqual({
      current: 100_000,
      max: 250_000,
      pct: 40,
    });
  });

  it("returns null when nearest sample lacks mana without skipping to farther sample", () => {
    // Nearest sample is at 10_050 (50ms away) but only has Rage.
    // Farther sample at 10_500 (500ms away) has Mana.
    const unit = makeUnit([
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_050 },
        advancedActorPowers: [
          { type: CombatUnitPowerType.Rage, current: 100, max: 100 },
        ],
      },
      {
        advancedActorId: "Player-1234",
        logLine: { timestamp: 10_500 },
        advancedActorPowers: [
          { type: MANA_POWER_TYPE, current: 200_000, max: 250_000 },
        ],
      },
    ]);
    // Closest sample is 10_050, which lacks mana -> must return null (not 10_500)
    expect(getUnitResourceAtTimestamp(unit, 10_000)).toBeNull();
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
