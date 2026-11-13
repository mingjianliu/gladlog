/**
 * T43 (r12 D13 / r12b N5, 60bfdea9 0:12): a landed control is timed by the
 * cast that made it even when that cast's SUCCESS row is logged just after
 * its own aura — never by an earlier untargeted press of the same player.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  AIMED_CONTROL_LANDING_LEAD_MS,
  controlLandedResponses,
} from "../src/analysis/burstWindowDecisionPoints";
import { ensureAnalysisData } from "../src/data/ensure";

const PROWL = "102547";
const RAKE = "1822";
const RAKE_STUN = "163505";
const SHADOW_DANCE = "185313";

const HUNT_PRESS = "1246167";
const HUNT_IMPACT = "1246169";
const HUNT_ROOT = "370970";

const stunOnE1 = (tMs: number, spellId = RAKE_STUN) => ({
  id: "E1",
  auraEvents: [
    {
      timestamp: tMs,
      spellId,
      srcUnitId: "F1",
      logLine: { event: "SPELL_AURA_APPLIED" },
    },
  ],
});
const run = (
  casts: Array<{ spellId: string; dest: string | undefined; tMs: number }>,
  auraMs = 13_454,
  auraId = RAKE_STUN,
) =>
  controlLandedResponses(
    [stunOnE1(auraMs, auraId)],
    new Set(["E1"]),
    (id) => (id === "F1" ? "F1" : undefined),
    casts.map((c) => ({ unitId: "F1", ...c })),
    12_326,
    30_000,
  );

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T43 — the producing cast logged just after its aura times the control", () => {
  it("Rake's SUCCESS 2 ms after its stun aura times it, not the Prowl before it", () => {
    expect(
      run([
        { spellId: PROWL, dest: undefined, tMs: 13_218 },
        { spellId: RAKE, dest: "E1", tMs: 13_456 },
      ]),
    ).toMatchObject([{ unitId: "F1", spellId: RAKE_STUN, tMs: 13_456 }]);
  });

  it("a cast of it past the lead is a later press: the earlier untargeted press keeps the timing", () => {
    expect(
      run([
        { spellId: PROWL, dest: undefined, tMs: 13_218 },
        {
          spellId: RAKE,
          dest: "E1",
          tMs: 13_454 + AIMED_CONTROL_LANDING_LEAD_MS + 1,
        },
      ]),
    ).toMatchObject([{ tMs: 13_218 }]);
  });

  it("another press logged just after the aura never times it", () => {
    expect(
      run([{ spellId: SHADOW_DANCE, dest: undefined, tMs: 13_460 }]),
    ).toMatchObject([{ tMs: 13_454 }]);
  });

  // codex 85-tk-H-T43-1
  it("a press's impact row logged just after the aura never replaces the press", () => {
    expect(
      run(
        [
          { spellId: HUNT_PRESS, dest: "E1", tMs: 13_000 },
          { spellId: HUNT_IMPACT, dest: "E1", tMs: 13_456 },
        ],
        13_454,
        HUNT_ROOT,
      ),
    ).toMatchObject([{ spellId: HUNT_ROOT, tMs: 13_000 }]);
  });

  it("a cast of it on another enemy logged just after the aura never times it", () => {
    expect(
      run([
        { spellId: PROWL, dest: undefined, tMs: 13_218 },
        { spellId: RAKE, dest: "E2", tMs: 13_456 },
      ]),
    ).toMatchObject([{ tMs: 13_218 }]);
  });

  it("an earlier cast of it on another enemy does not hide the one that made the aura", () => {
    expect(
      run([
        { spellId: RAKE, dest: "E2", tMs: 12_400 },
        { spellId: RAKE, dest: "E1", tMs: 13_456 },
      ]),
    ).toMatchObject([{ tMs: 13_456 }]);
  });
});
