/**
 * T135 — three cooldown mechanisms DB2 names and the model did not read:
 * Ranger's Finesse (Aspect of the Turtle), Healing Hands (Lay on Hands, an
 * "up to N %" range) and Glaciate (Ray of Frost).
 */
import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
  eventTriggersFor,
  UP_TO_COOLDOWN_REDUCTIONS,
  upToCooldownPctFor,
} from "../src/data/talentScriptedCooldowns";

const T0 = 1_000_000;
const row = (event: string, spellId: string, atS: number, unit = "h") => ({
  spellId,
  srcUnitId: unit,
  destUnitId: unit,
  logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
});

describe("Ranger's Finesse — a Volley that consumes the stacks: Aspect of the Turtle −20 s", () => {
  const r = EVENT_COOLDOWN_REDUCTIONS["248443"]!;
  // 20bba87d r2: Volley 71.38 s (the buff REMOVED 71.52 s) and 141.58 s
  // (REMOVED 141.74 s) consume it; the buff running out at 96.83 s does not,
  // nor does a Volley with no buff (23.37 s)
  const hunter = {
    id: "h",
    spec: "254",
    spellCastEvents: [23.37, 71.38, 141.58].map((s) =>
      row("SPELL_CAST_SUCCESS", "260243", s),
    ),
    damageOut: [],
    auraEvents: [71.52, 96.83, 141.74].map((s) =>
      row("SPELL_AURA_REMOVED", "408518", s),
    ),
  } as never;
  it("targets the Turtle and fires once per consuming Volley", () => {
    expect(r.targets).toEqual(["186265"]);
    const got = eventTriggersFor(hunter, [r]);
    expect(got.map((g) => g.seconds)).toEqual([20, 20]);
    expect(got.map((g) => Math.round((g.atMs - T0) / 10) / 100)).toEqual([
      // dated at the buff's removal
      71.52, 141.74,
    ]);
  });
  it("the audited pair: pressed 83.55 s on the 120 s model, back at 183.55 s — pressed again 185.51 s", () => {
    const triggers = eventTriggersFor(hunter, [r]).map((g) => ({
      atSeconds: (g.atMs - T0) / 1000,
      seconds: g.seconds,
    }));
    expect(eventReducedCooldownSeconds(83.55, 120, triggers)).toBeCloseTo(
      100,
      6,
    );
  });
});

describe("Healing Hands — Lay on Hands up to −30 % in the arena", () => {
  it("is the held talent's percent for both Lay on Hands ids, 0 without it", () => {
    expect(UP_TO_COOLDOWN_REDUCTIONS["326734"]!.pct).toBe(30);
    for (const id of ["633", "471195"]) {
      expect(upToCooldownPctFor(id, (t) => t === "326734")).toBe(30);
      expect(upToCooldownPctFor(id, () => false)).toBe(0);
    }
    expect(upToCooldownPctFor("642", () => true)).toBe(0);
  });
});

describe("Glaciate — each Freezing stack an Ice Lance shatters: Ray of Frost −0.1 s", () => {
  it("reads the shattered stacks the way White Out does", () => {
    const r = EVENT_COOLDOWN_REDUCTIONS["1247798"]!;
    expect(r.targets).toEqual(["205021"]);
    expect(r.seconds).toBe(0.1);
    expect(r.triggerOwnAuraStacksLost).toEqual(
      EVENT_COOLDOWN_REDUCTIONS["1281638:shatter"]!.triggerOwnAuraStacksLost,
    );
  });
});
