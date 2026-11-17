/**
 * Pipeline T116 (fact13 G1): a kick-eaten row printed a Felhunter's own name
 * — client-localized, in no roster — in `units=` and `source=`, while the
 * [KICK] line and the row's `nearestKicker=` named it through its owner.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { kickEatenEvents } from "../src/analysis/candidateFindings";
import { ensureAnalysisData } from "../src/data/ensure";
import { kickSourceLabel } from "../src/utils/ccTrinketAnalysis";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const warlock = makeUnit("Player-1", {
  name: "Lock-Realm-US",
  spec: CombatUnitSpec.Warlock_Affliction,
  reaction: CombatUnitReaction.Hostile,
});
const felhunter = Object.assign(
  makeUnit("Pet-0-1-1-1-417-1", { name: "斯洛索恩" }),
  { ownerId: "Player-1" },
);
const stray = makeUnit("Creature-0-1-1-1-999-1", { name: "陷地图腾" });
const units = [warlock, felhunter, stray] as any[];

describe("kickSourceLabel (T116)", () => {
  it("a player is its own name", () => {
    expect(kickSourceLabel("Player-1", "Lock-Realm-US", [warlock], units)).toBe(
      "Lock-Realm-US",
    );
  });
  it("a pet is named through its owner", () => {
    expect(
      kickSourceLabel("Pet-0-1-1-1-417-1", "斯洛索恩", [warlock], units),
    ).toBe("Lock-Realm-US's pet");
  });
  it("a summon with no enemy owner keeps the log's name", () => {
    expect(
      kickSourceLabel("Creature-0-1-1-1-999-1", "陷地图腾", [warlock], units),
    ).toBe("陷地图腾");
  });
});

describe("the kick-eaten row reads the label (T116)", () => {
  const kick = (sourceName: string, sourceLabel?: string) => ({
    atSeconds: 43.8,
    lockoutDurationSeconds: 5,
    kickSpellName: "Spell Lock",
    interruptedSpellName: "Glacial Spike",
    sourceName,
    ...(sourceLabel ? { sourceLabel } : {}),
    postKick: "idle" as const,
    firstActionDelayS: null,
    switchSpellName: null,
    switchDelayS: null,
    switchWasHardCast: null,
    nearestKickerDistYd: null,
    kickersInRange: null,
    kickDepthPct: null,
    ccInWindowS: null,
  });
  it("units= and source= carry the owner's label, not the pet's name", () => {
    const [row] = kickEatenEvents(
      [kick("斯洛索恩", "Lock-Realm-US's pet")] as any[],
      { id: "o", name: "Owner" },
    );
    expect(row!.unitNames).toEqual(["Owner", "Lock-Realm-US's pet"]);
    expect(row!.facts.source).toBe("Lock-Realm-US's pet");
  });
});
