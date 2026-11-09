/**
 * `cleanAuraRuns` (scripts/lib/auraRuns.ts), what `buffDurationScan
 * --per-app` measures: rebroadcasts and duplicate APPLIED rows are one run
 * (codex B25 #3 — APPLIED 0, REMOVED/APPLIED 10/10.001, REMOVED 20 is one
 * 20 s lifetime, not two shorter ones).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { cleanAuraRuns } from "../scripts/lib/auraRuns";

const row = (event: LogEvent, s: number, src = "w") => ({
  spellId: "1719",
  srcUnitId: src,
  destUnitId: "w",
  timestamp: s * 1000,
  logLine: { event, timestamp: s * 1000 },
});

describe("cleanAuraRuns", () => {
  it("a 1 ms re-broadcast is one run", () => {
    expect(
      cleanAuraRuns([
        row(LogEvent.SPELL_AURA_APPLIED, 0),
        row(LogEvent.SPELL_AURA_REMOVED, 10),
        row(LogEvent.SPELL_AURA_APPLIED, 10.001),
        row(LogEvent.SPELL_AURA_REMOVED, 20),
      ]),
    ).toEqual([{ srcUnitId: "w", fromMs: 0, toMs: 20_000 }]);
  });
  it("a duplicate APPLIED inside a run starts nothing; a REFRESH makes it unclean", () => {
    expect(
      cleanAuraRuns([
        row(LogEvent.SPELL_AURA_APPLIED, 0),
        row(LogEvent.SPELL_AURA_APPLIED, 5),
        row(LogEvent.SPELL_AURA_REMOVED, 18),
      ]),
    ).toEqual([{ srcUnitId: "w", fromMs: 0, toMs: 18_000 }]);
    expect(
      cleanAuraRuns([
        row(LogEvent.SPELL_AURA_APPLIED, 0),
        row(LogEvent.SPELL_AURA_REFRESH, 5),
        row(LogEvent.SPELL_AURA_REMOVED, 18),
        row(LogEvent.SPELL_AURA_APPLIED, 30),
        row(LogEvent.SPELL_AURA_REMOVED, 48),
      ]),
    ).toEqual([{ srcUnitId: "w", fromMs: 30_000, toMs: 48_000 }]);
  });
  it("runs are per source", () => {
    expect(
      cleanAuraRuns([
        row(LogEvent.SPELL_AURA_APPLIED, 0, "a"),
        row(LogEvent.SPELL_AURA_APPLIED, 1, "b"),
        row(LogEvent.SPELL_AURA_REMOVED, 6, "a"),
        row(LogEvent.SPELL_AURA_REMOVED, 9, "b"),
      ]),
    ).toEqual([
      { srcUnitId: "a", fromMs: 0, toMs: 6_000 },
      { srcUnitId: "b", fromMs: 1_000, toMs: 9_000 },
    ]);
  });
  // codex 85-tk-A-T18-2 #3: a BROKEN line its REMOVED follows is not the
  // end, whoever broke it
  it("a BROKEN line superseded by its REMOVED does not end the run", () => {
    const rows = (breaker: string) => [
      { ...row(LogEvent.SPELL_AURA_APPLIED, 0), spellId: "122" },
      { ...row(LogEvent.SPELL_AURA_BROKEN_SPELL, 5.5, breaker), spellId: "122" },
      { ...row(LogEvent.SPELL_AURA_REMOVED, 6), spellId: "122" },
    ];
    expect(cleanAuraRuns(rows("w"))).toEqual([
      { srcUnitId: "w", fromMs: 0, toMs: 6_000 },
    ]);
    expect(cleanAuraRuns(rows("x"))).toEqual([
      { srcUnitId: "w", fromMs: 0, toMs: 6_000 },
    ]);
  });
  // codex 85-tk-A-T18-2 #2: `--dose-unclean` keeps a stacking run out
  it("with doseUnclean an APPLIED_DOSE makes the run unclean", () => {
    const rows = [
      row(LogEvent.SPELL_AURA_APPLIED, 0),
      row(LogEvent.SPELL_AURA_APPLIED_DOSE, 5),
      row(LogEvent.SPELL_AURA_REMOVED, 35),
    ];
    expect(cleanAuraRuns(rows)).toHaveLength(1);
    expect(cleanAuraRuns(rows, { doseUnclean: true })).toEqual([]);
  });
});
