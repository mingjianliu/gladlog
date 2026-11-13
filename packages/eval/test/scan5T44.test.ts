/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `stayedInRootUnder` (T44, codex 85-tk-H-T44-1 #2): where the check
 * ends a movement root of the owner.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t44";

const START = 1_000_000;
const row = (event: string, s: number) => ({
  timestamp: START + s * 1000,
  logLine: { event, timestamp: START + s * 1000 },
  spellId: "122",
  spellName: "Frost Nova",
  srcUnitId: "e1",
});

function scan(auraEvents: any[], rooted: string, roundEndS = 600): number {
  let n = 0;
  run({
    lines: [
      "  STAYED IN during enemy burst",
      `    0:10–0:20 [High] stood 5 yd from the enemy${rooted}`,
    ],
    start: START,
    end: START + 600_000,
    roundEndAt: START + roundEndS * 1000,
    owner: { id: "o", auraEvents },
    bump: () => {},
    violate: () => n++,
  } as any);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("stayedInRootUnder", () => {
  it("flags a line that leaves out a root its REMOVED row closes", () => {
    const auras = [
      row(LogEvent.SPELL_AURA_APPLIED, 12),
      row(LogEvent.SPELL_AURA_REMOVED, 16),
    ];
    expect(scan(auras, "")).toBe(1);
    expect(scan(auras, " — rooted 4s")).toBe(0);
  });

  it("a root a hit broke ends at its BROKEN row", () => {
    const auras = [
      row(LogEvent.SPELL_AURA_APPLIED, 12),
      row(LogEvent.SPELL_AURA_BROKEN_SPELL, 13),
    ];
    expect(scan(auras, " — rooted 1s")).toBe(0);
  });

  it("a root the log never closes is not judged", () => {
    expect(scan([row(LogEvent.SPELL_AURA_APPLIED, 12)], " — rooted 6s")).toBe(
      0,
    );
  });

  it("a root is not counted past the round's end", () => {
    const auras = [
      row(LogEvent.SPELL_AURA_APPLIED, 12),
      row(LogEvent.SPELL_AURA_REMOVED, 19),
    ];
    expect(scan(auras, " — rooted 3s", 15)).toBe(0);
    expect(scan(auras, " — rooted 3s")).toBe(1);
  });
});
