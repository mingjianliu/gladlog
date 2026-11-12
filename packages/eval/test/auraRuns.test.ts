/**
 * `cleanAuraRuns` (scripts/lib/auraRuns.ts), what `buffDurationScan
 * --per-app` measures: rebroadcasts and duplicate APPLIED rows are one run
 * (codex B25 #3 — APPLIED 0, REMOVED/APPLIED 10/10.001, REMOVED 20 is one
 * 20 s lifetime, not two shorter ones).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { casterUnitOf, cleanAuraRuns } from "../scripts/lib/auraRuns";

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
      {
        ...row(LogEvent.SPELL_AURA_BROKEN_SPELL, 5.5, breaker),
        spellId: "122",
      },
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
  // codex 85-tk-A-T18-2b #1: a re-APPLIED its source pressed is a new
  // run; the earlier one lost its REMOVED and is no lifetime
  it("a re-APPLIED the source pressed starts a run and drops the open one", () => {
    const rows = [
      row(LogEvent.SPELL_AURA_APPLIED, 0),
      row(LogEvent.SPELL_AURA_APPLIED, 90),
      row(LogEvent.SPELL_AURA_REMOVED, 100),
    ];
    expect(cleanAuraRuns(rows)).toEqual([
      { srcUnitId: "w", fromMs: 0, toMs: 100_000 },
    ]);
    expect(
      cleanAuraRuns(rows, {
        isNewApplication: (a) => a.logLine.timestamp === 90_000,
      }),
    ).toEqual([{ srcUnitId: "w", fromMs: 90_000, toMs: 100_000 }]);
  });
  // codex 85-tk-A-T18-2b #3: a closing row from another source ends the
  // oldest open run, which keeps its own source
  it("a closing row of another source ends the oldest open run", () => {
    expect(
      cleanAuraRuns([
        row(LogEvent.SPELL_AURA_APPLIED, 0, "w"),
        row(LogEvent.SPELL_AURA_REMOVED, 18, "x"),
      ]),
    ).toEqual([{ srcUnitId: "w", fromMs: 0, toMs: 18_000 }]);
  });
  // codex 85-tk-A-T18-2c #2: a re-press keeps its run's place among the
  // open runs, as in buildAuraIntervals (A 2–3 s, B 1–4 s)
  it("a re-pressed run keeps its place for the oldest-open fallback", () => {
    expect(
      cleanAuraRuns(
        [
          row(LogEvent.SPELL_AURA_APPLIED, 0, "a"),
          row(LogEvent.SPELL_AURA_APPLIED, 1, "b"),
          row(LogEvent.SPELL_AURA_APPLIED, 2, "a"),
          row(LogEvent.SPELL_AURA_REMOVED, 3, "x"),
          row(LogEvent.SPELL_AURA_REMOVED, 4, "x"),
        ],
        { isNewApplication: (a) => a.logLine.timestamp === 2_000 },
      ),
    ).toEqual([
      { srcUnitId: "a", fromMs: 2_000, toMs: 3_000 },
      { srcUnitId: "b", fromMs: 1_000, toMs: 4_000 },
    ]);
  });
  // codex 85-tk-A-T18-2d #2: the callback sees the open run's start (the
  // builder also splits a re-APPLIED past the open copy's length)
  it("the re-APPLIED split is told the open run's start", () => {
    const seen: number[] = [];
    expect(
      cleanAuraRuns(
        [
          row(LogEvent.SPELL_AURA_APPLIED, 0),
          row(LogEvent.SPELL_AURA_APPLIED, 60),
          row(LogEvent.SPELL_AURA_REMOVED, 65),
        ],
        {
          isNewApplication: (a, from) => {
            seen.push(from);
            return a.logLine.timestamp > from + 18_000;
          },
        },
      ),
    ).toEqual([{ srcUnitId: "w", fromMs: 60_000, toMs: 65_000 }]);
    expect(seen).toEqual([0]);
  });
  // codex 85-tk-A-T18-2e #1: the length is counted from the builder's
  // anchor, the latest REFRESH — APPLIED 0, REFRESH 15, APPLIED 20 is one
  // refreshed (unclean) run, no 13 s sample
  it("the re-APPLIED split counts from the latest REFRESH", () => {
    const seen: number[] = [];
    expect(
      cleanAuraRuns(
        [
          row(LogEvent.SPELL_AURA_APPLIED, 0),
          row(LogEvent.SPELL_AURA_REFRESH, 15),
          row(LogEvent.SPELL_AURA_APPLIED, 20),
          row(LogEvent.SPELL_AURA_REMOVED, 33),
        ],
        {
          isNewApplication: (a, anchor) => {
            seen.push(anchor);
            return a.logLine.timestamp > anchor + 18_000;
          },
        },
      ),
    ).toEqual([]);
    expect(seen).toEqual([15_000]);
  });
});

describe("casterUnitOf — a summon's aura is its owner's (T76)", () => {
  const units: Record<
    string,
    { id: string; info?: unknown; ownerId?: string }
  > = {
    "Player-1": { id: "Player-1", info: { talents: [] } },
    "Creature-totem": { id: "Creature-totem", ownerId: "Player-1" },
    "Creature-wild": { id: "Creature-wild" },
  };
  it("a player source is itself, a totem its owner, an ownerless unit itself", () => {
    expect(casterUnitOf(units, "Player-1")?.id).toBe("Player-1");
    expect(casterUnitOf(units, "Creature-totem")?.id).toBe("Player-1");
    expect(casterUnitOf(units, "Creature-wild")?.id).toBe("Creature-wild");
    expect(casterUnitOf(units, undefined)).toBeUndefined();
  });
});
