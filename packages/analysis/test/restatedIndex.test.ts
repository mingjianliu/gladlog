import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  RESTATED_END_TOLERANCE_MS,
  restatedAuraWasUp,
} from "../src/utils/auraIntervals";
import {
  isResyncBatchAt,
  RESYNC_BATCH_MIN_APPLIED,
  RESYNC_BATCH_SPAN_MS,
} from "../src/utils/hiddenPress";

// The 2026-11-03 first-paint regression fix indexes `isResyncBatchAt` and
// `restatedAuraWasUp` (sorted instants per stream array). Performance only:
// the readings must stay the plain scans they replaced, row for row.

/** deterministic LCG, so a failure reproduces */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const EVENTS = [
  LogEvent.SPELL_AURA_APPLIED,
  LogEvent.SPELL_AURA_REMOVED,
  LogEvent.SPELL_AURA_REFRESH,
];
const IDS = ["1", "2", "3"];
const SPELLS = ["10", "11", "12"];
const T0 = 1_000_000;

function auraRows(r: () => number, n: number) {
  // clustered instants, so batches (MIN rows within SPAN) actually occur,
  // and not in time order (the plain scans never assumed it)
  return Array.from({ length: n }, () => ({
    spellId: SPELLS[Math.floor(r() * SPELLS.length)],
    srcUnitId: IDS[Math.floor(r() * IDS.length)]!,
    destUnitId: IDS[Math.floor(r() * IDS.length)]!,
    logLine: {
      event: EVENTS[Math.floor(r() * EVENTS.length)]!,
      timestamp: T0 + Math.floor(r() * 10) * 200 + Math.floor(r() * 3),
    },
  }));
}
function spellRows(r: () => number, n: number) {
  return Array.from({ length: n }, () => ({
    spellId: r() < 0.1 ? undefined : SPELLS[Math.floor(r() * SPELLS.length)],
    logLine: { timestamp: T0 + Math.floor(r() * 2000) },
  }));
}

/** the scan `isResyncBatchAt` was until 2026-11-03 */
function resyncPlain(
  unit: { id: string; auraEvents: ReturnType<typeof auraRows> },
  ms: number,
) {
  let n = 0;
  for (const a of unit.auraEvents)
    if (
      a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
      a.destUnitId === unit.id &&
      Math.abs(a.logLine.timestamp - ms) <= RESYNC_BATCH_SPAN_MS &&
      ++n >= RESYNC_BATCH_MIN_APPLIED
    )
      return true;
  return false;
}

/** the scan `restatedAuraWasUp` was until 2026-11-03 */
function wasUpPlain(
  unit: {
    absorbsIn: ReturnType<typeof spellRows>;
    healIn: ReturnType<typeof spellRows>;
    damageIn: ReturnType<typeof spellRows>;
    auraEvents: ReturnType<typeof auraRows>;
  },
  applied: { spellId?: string; srcUnitId: string; timestamp: number },
  pressMs: number,
  d: number,
) {
  const id = applied.spellId;
  if (!id) return false;
  const between = (ms: number) => ms >= pressMs && ms < applied.timestamp;
  if (
    [unit.absorbsIn, unit.healIn, unit.damageIn].some((rows) =>
      rows.some((x) => x.spellId === id && between(x.logLine.timestamp)),
    )
  )
    return true;
  const removed = unit.auraEvents.find(
    (x) =>
      x.spellId === id &&
      x.srcUnitId === applied.srcUnitId &&
      x.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
      x.logLine.timestamp > applied.timestamp,
  );
  return (
    !!removed &&
    Math.abs(removed.logLine.timestamp - pressMs - d * 1000) <=
      RESTATED_END_TOLERANCE_MS
  );
}

describe("indexed re-stating readings = the plain scans", () => {
  it("isResyncBatchAt, every instant of 200 random streams", () => {
    let trues = 0;
    let checks = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const auraEvents = auraRows(r, 5 + Math.floor(r() * 400));
      for (const id of IDS) {
        const unit = { id, auraEvents };
        // every row's own instant and the span's edges around it (where
        // the callers ask), inclusive and one past
        const instants = auraEvents.flatMap((a) =>
          [0, 1, -1, 5, -5, 6, -6].map((o) => a.logLine.timestamp + o),
        );
        for (const ms of instants) {
          const want = resyncPlain(unit, ms);
          expect(isResyncBatchAt(unit as never, ms)).toBe(want);
          if (want) trues++;
          checks++;
        }
      }
    }
    // both answers are exercised, not a stream that never batches (916 of
    // 480,921 when written; batches are rare, as in a real log)
    expect(trues).toBeGreaterThan(500);
    expect(trues).toBeLessThan(checks);
  });

  it("isResyncBatchAt reads a row added to the same stream array", () => {
    const rows = [0, 1, 2, 3, 4].map((k) => ({
      spellId: "10",
      srcUnitId: "1",
      destUnitId: "1",
      logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + k },
    }));
    const unit = { id: "1", auraEvents: rows };
    const before = resyncPlain(unit, T0);
    expect(isResyncBatchAt(unit as never, T0)).toBe(before);
    rows.push({ ...rows[0]!, logLine: { ...rows[0]!.logLine } });
    expect(isResyncBatchAt(unit as never, T0)).toBe(resyncPlain(unit, T0));
  });

  it("restatedAuraWasUp, 400 random holders", () => {
    let trues = 0;
    let checks = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed * 7919);
      const unit = {
        absorbsIn: spellRows(r, Math.floor(r() * 15)),
        healIn: spellRows(r, Math.floor(r() * 15)),
        damageIn: spellRows(r, Math.floor(r() * 15)),
        auraEvents: auraRows(r, 5 + Math.floor(r() * 60)),
      };
      for (let k = 0; k < 40; k++) {
        const applied = {
          spellId: r() < 0.05 ? undefined : SPELLS[Math.floor(r() * 3)],
          srcUnitId: IDS[Math.floor(r() * IDS.length)]!,
          timestamp: T0 + Math.floor(r() * 2000),
        };
        const pressMs = applied.timestamp - Math.floor(r() * 600);
        const d = r() < 0.5 ? 0.5 : Math.floor(r() * 3);
        const want = wasUpPlain(unit, applied, pressMs, d);
        expect(restatedAuraWasUp(unit as never, applied, pressMs, d)).toBe(
          want,
        );
        if (want) trues++;
        checks++;
      }
    }
    expect(trues).toBeGreaterThan(checks / 50);
    expect(trues).toBeLessThan(checks);
  });

  it("non-finite and fractional instants read as the scan did (codex 20-F24-17)", () => {
    const applied = (t: number) => ({
      spellId: "10",
      srcUnitId: "1",
      destUnitId: "1",
      logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: t },
    });
    const holder = (ts: number[]) => ({ id: "1", auraEvents: ts.map(applied) });
    const cases: Array<[number[], number]> = [
      [[100, 100, 100, NaN, 100, 100, 100], 100], // #1: true before
      [[Infinity, Infinity, Infinity, Infinity, Infinity, Infinity], Infinity],
      [[0.2, 0.2, 0.2, 0.2, 0.2, 0.2], 5.2], // #3: |0.2 − 5.2| is 5
      [[1, 2, 3, 4, 5, 6], NaN],
    ];
    for (const [ts, ms] of cases) {
      const unit = holder(ts);
      expect(isResyncBatchAt(unit as never, ms)).toBe(resyncPlain(unit, ms));
    }
    const rows = (ts: number[]) =>
      ts.map((t) => ({ spellId: "10", logLine: { timestamp: t } }));
    const wasUp: Array<[number[], number, number]> = [
      [[NaN, 100], 50, 150], // #2: true before
      [[100], NaN, 150], // #2: false before
      [[100, Infinity, -Infinity], 50, Infinity],
    ];
    for (const [ts, pressMs, at] of wasUp) {
      const unit = {
        absorbsIn: [],
        healIn: [],
        damageIn: rows(ts),
        auraEvents: [],
      };
      const a = { spellId: "10", srcUnitId: "1", timestamp: at };
      expect(restatedAuraWasUp(unit as never, a, pressMs, 1)).toBe(
        wasUpPlain(unit as never, a, pressMs, 1),
      );
    }
  });
});
