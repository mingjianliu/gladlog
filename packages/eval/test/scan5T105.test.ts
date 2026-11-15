/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `softerTargetImmune` (T105, codex 85-tk-L-T105-1): an application
 * whose end the log does not show is not judged, a later application does
 * not bridge back to it, and both rendered tiers (`PRIME`, `gated`) are read.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t105";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const DIVINE_SHIELD = "642";

const aura = (event: string, s: number) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  spellId: DIVINE_SHIELD,
  spellName: "Divine Shield",
  srcUnitId: "e2",
  destUnitId: "e2",
});
const up = (s: number) => aura(LogEvent.SPELL_AURA_APPLIED, s);
const down = (s: number) => aura(LogEvent.SPELL_AURA_REMOVED, s);

function scan(sec: number, tier: string, rows: any[]): number {
  let n = 0;
  const e1 = { id: "e1", name: "e1", reaction: 2, auraEvents: [] };
  const e2 = { id: "e2", name: "e2", reaction: 2, auraEvents: rows };
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  run({
    lines: [
      `  [${mm}:${ss}–${mm}:${String((sec % 60) + 3).padStart(2, "0")}] on e1 — Avatar burst (no stun) | opportunity: trinket up (softer target then: e2 — ${tier}) | team focus 70%`,
    ],
    start: START,
    byName: new Map([
      ["e1", e1],
      ["e2", e2],
    ]),
    bump: () => {},
    violate: () => n++,
  } as any);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 softerTargetImmune (T105)", () => {
  it("a Divine Shield up across the bracket's first second is a violation, for either tier", () => {
    expect(scan(10, "PRIME (no trinket)", [up(5), down(15)])).toBe(1);
    expect(
      scan(10, "gated, Divine Protection in hand", [up(5), down(15)]),
    ).toBe(1);
  });

  it("an application with no REMOVED is not judged (codex #1)", () => {
    expect(scan(20, "PRIME (no trinket)", [up(5)])).toBe(0);
  });

  it("a later application's REMOVED does not close an earlier one (codex #1)", () => {
    expect(scan(20, "PRIME (no trinket)", [up(5), up(200), down(208)])).toBe(0);
  });

  it("an immunity that ended before the bracket is no violation", () => {
    expect(scan(20, "PRIME (no trinket)", [up(5), down(13)])).toBe(0);
  });
});
