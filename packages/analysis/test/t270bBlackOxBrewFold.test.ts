/**
 * Pipeline T270b (codex 85-tk-L6-T270-1 #2): Black Ox Brew gives one charge
 * of Celestial Brew (`oneCharge`). On a one-charge Celestial Brew — no
 * Endless Draught — that is the whole pool back, so a Celestial Brew pressed
 * again within 2 s after it is a press of its own, not a duplicate row of the
 * first (the 2 s fold, `resetBetween`). On a two-charge pool the window's
 * own charge count decides, as before.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { cdAvailableAt, unitCooldownEntry } from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PID = "player-1";
const T0 = 1_000_000;
const CELESTIAL = "322507";
const BOB = "115399";

const monk = (casts: Array<[string, number]>) =>
  makeUnit(PID, {
    class: CombatUnitClass.Monk,
    spec: CombatUnitSpec.Monk_Brewmaster,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: casts.map(([id, s]) =>
      makeSpellCastEvent(id, T0 + s * 1000, ""),
    ),
    auraEvents: [],
  } as any);
const combatOf = (u: any) =>
  ({
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [PID]: u },
  }) as unknown as AtomicArenaCombat;

describe("T270b — Black Ox Brew's Celestial Brew charge is a reset for the 2 s fold", () => {
  it("Celestial Brew 10.0 s, Black Ox Brew 10.8 s, Celestial Brew 11.5 s: two presses", () => {
    const u = monk([
      [CELESTIAL, 10.0],
      [BOB, 10.8],
      [CELESTIAL, 11.5],
    ]);
    const entry = unitCooldownEntry(u, combatOf(u), CELESTIAL)!;
    expect(entry.charges).toBe(1);
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([10.0, 11.5]);
    // the second press spent the charge Black Ox Brew gave back
    expect(cdAvailableAt(entry, 12)).toBe(false);
  });

  it("without the Black Ox Brew between, the second row inside 2 s is still the first press's", () => {
    const u = monk([
      [CELESTIAL, 10.0],
      [CELESTIAL, 11.5],
    ]);
    const entry = unitCooldownEntry(u, combatOf(u), CELESTIAL)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([10.0]);
  });

  it("a Black Ox Brew outside the pair resets nothing between them", () => {
    const u = monk([
      [BOB, 9.0],
      [CELESTIAL, 10.0],
      [CELESTIAL, 11.5],
    ]);
    const entry = unitCooldownEntry(u, combatOf(u), CELESTIAL)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([10.0]);
  });
});
