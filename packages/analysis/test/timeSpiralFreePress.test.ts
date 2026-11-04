/**
 * Time Spiral (GH #176): the movement press that consumes the unit's Time
 * Spiral aura neither spends a charge nor restarts the cooldown — it stands
 * on the cooldown of the last press that started one.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  TIME_SPIRAL_ECHO_MS,
  TIME_SPIRAL_FREE_PRESSES,
  TIME_SPIRAL_PAIR_MS,
  timeSpiralEchoMs,
  timeSpiralFreePressMs,
} from "../src/data/talentScriptedCooldowns";
import {
  chargeSpendTimesOf,
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
} from "../src/utils/cooldowns";
import { extractOffListPresses } from "../src/utils/offListPress";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PID = "player-1";
const T0 = 1_000_000;
const SPRINT = "2983";
const ROGUE_SPIRAL = "375255";

const removed = (auraId: string, atMs: number): any => ({
  logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + atMs },
  timestamp: T0 + atMs,
  spellId: auraId,
  srcUnitId: "evoker-1",
  destUnitId: PID,
});
const rogue = (pressS: number[], auraEvents: any[]) =>
  makeUnit(PID, {
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Outlaw,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: pressS.map((s) =>
      makeSpellCastEvent(SPRINT, T0 + s * 1000, ""),
    ),
    auraEvents,
  } as any);
const combatOf = (u: any) =>
  ({
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [PID]: u },
  }) as unknown as AtomicArenaCombat;

describe("Time Spiral — the free movement press", () => {
  it("each class aura lists its movement spell; the pairing is the REMOVED just after the row", () => {
    expect(TIME_SPIRAL_FREE_PRESSES[ROGUE_SPIRAL]!.spellIds).toContain(SPRINT);
    expect(TIME_SPIRAL_PAIR_MS).toBe(50);
    const u = rogue([], [removed(ROGUE_SPIRAL, 40_010)]);
    expect(timeSpiralFreePressMs(u, SPRINT, [T0 + 40_000])).toEqual([
      T0 + 40_000,
    ]);
    // a REMOVED before the row is an aura that ran out, not a consumed one
    expect(timeSpiralFreePressMs(u, SPRINT, [T0 + 40_100])).toEqual([]);
    // too late after the row
    expect(timeSpiralFreePressMs(u, SPRINT, [T0 + 39_900])).toEqual([]);
    // another class's aura does not free Sprint
    const v = rogue([], [removed("375238", 40_010)]);
    expect(timeSpiralFreePressMs(v, SPRINT, [T0 + 40_000])).toEqual([]);
  });

  it("the free press stands on the earlier press's cooldown", () => {
    const u = rogue([10, 40, 200], [removed(ROGUE_SPIRAL, 40_005)]);
    const entry = unitCooldownEntry(u, combatOf(u), SPRINT)!;
    const cd = entry.cooldownSeconds;
    expect(cd).toBeGreaterThan(30);
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([10, 40, 200]);
    expect(entry.casts[1]!.freeRecast).toBe(true);
    expect(pressReadyAgainAtSeconds(entry, 40)).toBeCloseTo(10 + cd, 6);
    expect(pressReadyAgainAtSeconds(entry, 10)).toBeCloseTo(10 + cd, 6);
    expect(chargeSpendTimesOf(entry)).toEqual([10, 200]);
    // the [PRESS] line reads it as a free press on the earlier cooldown
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(presses.map((p) => [p.timeSeconds, p.free ?? false])).toEqual([
      [10, false],
      [40, true],
      [200, false],
    ]);
    expect(presses[1]!.readyAgainAtSeconds).toBeCloseTo(10 + cd, 6);
  });

  it("under the rogue's Blessing of the Bronze (381754, −15 % on label 1381) the opener and its free press read 0.85 × the cooldown (fact10 D6)", () => {
    const botbRogue = (pressS: number[], auraEvents: any[]) => {
      const u = rogue(pressS, auraEvents);
      (u as any).info = {
        ...(u as any).info,
        interestingAurasJSON: JSON.stringify(["evoker-1", 381754, 1]),
      };
      return u;
    };
    const plain = unitCooldownEntry(
      rogue([10], []),
      combatOf(rogue([10], [])),
      SPRINT,
    )!.cooldownSeconds;
    const u = botbRogue([10, 40, 200], [removed(ROGUE_SPIRAL, 40_005)]);
    const entry = unitCooldownEntry(u, combatOf(u), SPRINT)!;
    expect(entry.casts[1]!.freeRecast).toBe(true);
    expect(pressReadyAgainAtSeconds(entry, 10)).toBeCloseTo(10 + plain * 0.85, 6);
    expect(pressReadyAgainAtSeconds(entry, 40)).toBeCloseTo(10 + plain * 0.85, 6);
  });

  it("Blessing of the Bronze's price is the base Restless Blades' give-back starts from (codex 20-F25-03 #2)", () => {
    const withBronze = (finisher: boolean) => {
      const u = rogue([10], []);
      (u as any).info = {
        ...(u as any).info,
        interestingAurasJSON: JSON.stringify(["evoker-1", 381754, 1]),
      };
      if (finisher)
        (u as any).spellCastEvents.push({
          ...makeSpellCastEvent("315341", T0 + 20_000, "enemy-1"),
          powerCosts: [
            { type: 3, cost: 25 },
            { type: 4, cost: 5 },
          ],
        });
      return unitCooldownEntry(u, combatOf(u), SPRINT)!;
    };
    const plain = unitCooldownEntry(
      rogue([10], []),
      combatOf(rogue([10], [])),
      SPRINT,
    )!.cooldownSeconds;
    expect(pressReadyAgainAtSeconds(withBronze(false), 10)).toBeCloseTo(
      10 + plain * 0.85,
      6,
    );
    // Between the Eyes at 20 s with 5 combo points: 5 s off the priced cooldown
    expect(pressReadyAgainAtSeconds(withBronze(true), 10)).toBeCloseTo(
      10 + plain * 0.85 - 5,
      6,
    );
  });

  it("a row 0.26 s after a free press is its echo, not a press that restarts the cooldown", () => {
    // corpus shape (605 set, Subtlety Sprint / Marksmanship Cheetah): the
    // second row lands before the cooldown could be back and puts no aura up
    const u = rogue([10, 40, 40.258], [removed(ROGUE_SPIRAL, 40_005)]);
    const entry = unitCooldownEntry(u, combatOf(u), SPRINT)!;
    expect(
      entry.casts.map((c) => [c.timeSeconds, c.freeRecast ?? false]),
    ).toEqual([
      [10, false],
      [40, true],
    ]);
    expect(pressReadyAgainAtSeconds(entry, 40)).toBeCloseTo(
      10 + entry.cooldownSeconds,
      6,
    );
    expect(
      timeSpiralEchoMs(u, SPRINT, [T0 + 10_000, T0 + 40_000, T0 + 40_258]),
    ).toEqual([T0 + 40_258]);
    // the [PRESS] line prints no line for the echo
    expect(
      extractOffListPresses([u], combatOf(u), T0 + 300_000).map(
        (p) => p.timeSeconds,
      ),
    ).toEqual([10, 40]);
    // 0.94 s later (an Evoker's Hover charge on the corpus) is a press
    expect(TIME_SPIRAL_ECHO_MS).toBeLessThan(940);
  });

  it("a free press spends no charge of the 2-second dedup window (codex review round 2)", () => {
    // Roll: two charges baseline, freed by the Monk's aura
    const ROLL = "109132";
    const u = makeUnit(PID, {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Windwalker,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [39_060, 40_000, 40_940].map((ms) =>
        makeSpellCastEvent(ROLL, T0 + ms, ""),
      ),
      auraEvents: [removed("375252", 40_005)],
    } as any);
    const entry = unitCooldownEntry(u, combatOf(u), ROLL)!;
    expect(entry.charges).toBe(2);
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([39.06, 40, 40.94]);
    expect(chargeSpendTimesOf(entry)).toEqual([39.06, 40.94]);
  });

  it("with no earlier press it is ready again at once", () => {
    const u = rogue([40], [removed(ROGUE_SPIRAL, 40_002)]);
    const entry = unitCooldownEntry(u, combatOf(u), SPRINT)!;
    expect(entry.casts[0]!.freeRecast).toBe(true);
    expect(pressReadyAgainAtSeconds(entry, 40)).toBe(40);
  });

  it("without the aura the same presses are ordinary", () => {
    const u = rogue([10, 40], []);
    const entry = unitCooldownEntry(u, combatOf(u), SPRINT)!;
    expect(entry.casts.some((c) => c.freeRecast)).toBe(false);
    expect(pressReadyAgainAtSeconds(entry, 40)).toBeCloseTo(
      40 + entry.cooldownSeconds,
      6,
    );
  });
});
