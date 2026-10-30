import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import type { IAuraInterval } from "@gladlog/analysis/src/utils/auraIntervals";
import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  cutShortMs,
  EDGES,
  GAP_MS,
  isClean,
  itemsOfRawText,
  scanLegacy,
} from "../scripts/auraSplitScan";

// The FT-T08 aura scan: SPLIT and EARLY against hand-built intervals and
// events (the classes fire on exactly what their doc comment names), and the
// real parser + the product's interval builder on a synthetic log with a
// re-broadcast (clean, as the corpus run is).

const T0 = 1_000_000;
const POLY = "118"; // Polymorph — a CC aura
const NOVA = "122"; // Frost Nova — a root, logs BROKEN_SPELL per hit

type Ev = {
  spellId: string;
  timestamp: number;
  srcUnitId: string;
  logLine: { event: string };
};
const ev = (
  event: string,
  spellId: string,
  atMs: number,
  srcUnitId = "e1",
): Ev => ({ spellId, timestamp: T0 + atMs, srcUnitId, logLine: { event } });
const iv = (
  spellId: string,
  fromS: number,
  toS: number,
  o: Partial<IAuraInterval> = {},
): IAuraInterval => ({
  spellId,
  spellName: spellId,
  srcUnitName: "E",
  fromS,
  toS,
  inferredStart: false,
  inferredEnd: false,
  ...o,
});
/** `info: null` = a unit with no COMBATANT_INFO row (a default parameter
 * would re-apply on `undefined`). */
const unitWith = (events: Ev[], info: object | null = {}) =>
  ({
    id: "p1",
    name: "P",
    info: info ?? undefined,
    auraEvents: events,
  }) as unknown as ICombatUnit;
const legacyOf = (u: ICombatUnit) => ({
  startTime: T0,
  endTime: T0 + 60_000,
  units: { p1: u },
});

describe("cutShortMs — an interval that ends on a BROKEN line before its REMOVED", () => {
  const end = 10_000;
  it("BROKEN_SPELL at the end and the REMOVED 400 ms later: cut 400", () => {
    const events = [
      ev("SPELL_AURA_APPLIED", NOVA, 5_000),
      ev("SPELL_AURA_BROKEN_SPELL", NOVA, end),
      ev("SPELL_AURA_REMOVED", NOVA, end + 400),
    ];
    expect(cutShortMs(events, T0, iv(NOVA, 5, 10))).toBe(400);
  });
  it("0 when the end IS the REMOVED, when no BROKEN sits there, when an APPLIED comes between, or when the REMOVED is over 1 s away", () => {
    expect(
      cutShortMs(
        [ev("SPELL_AURA_BROKEN_SPELL", NOVA, end), ev("SPELL_AURA_REMOVED", NOVA, end)],
        T0,
        iv(NOVA, 5, 10),
      ),
    ).toBe(0);
    expect(
      cutShortMs([ev("SPELL_AURA_REMOVED", NOVA, end + 400)], T0, iv(NOVA, 5, 10)),
    ).toBe(0);
    expect(
      cutShortMs(
        [
          ev("SPELL_AURA_BROKEN_SPELL", NOVA, end),
          ev("SPELL_AURA_APPLIED", NOVA, end + 200),
          ev("SPELL_AURA_REMOVED", NOVA, end + 400),
        ],
        T0,
        iv(NOVA, 5, 10),
      ),
    ).toBe(0);
    expect(
      cutShortMs(
        [ev("SPELL_AURA_BROKEN_SPELL", NOVA, end), ev("SPELL_AURA_REMOVED", NOVA, end + 1_500)],
        T0,
        iv(NOVA, 5, 10),
      ),
    ).toBe(0);
    // another spell's rows are not this aura's
    expect(
      cutShortMs(
        [ev("SPELL_AURA_BROKEN_SPELL", POLY, end), ev("SPELL_AURA_REMOVED", POLY, end + 400)],
        T0,
        iv(NOVA, 5, 10),
      ),
    ).toBe(0);
  });
});

describe("scanLegacy — SPLIT on hand-built intervals", () => {
  const rebroadcast = (openedBy = "e1", closeMs = 10_185, openMs = 10_186) => [
    ev("SPELL_AURA_APPLIED", POLY, 5_000),
    ev("SPELL_AURA_REMOVED", POLY, closeMs),
    ev("SPELL_AURA_APPLIED", POLY, openMs, openedBy),
    ev("SPELL_AURA_REMOVED", POLY, 13_000, openedBy),
  ];
  const two = (closeS = 10.185, openS = 10.186) => [
    iv(POLY, 5, closeS),
    iv(POLY, openS, 13),
  ];

  it("premises: the bound is 1 ms and Polymorph is a CC aura", () => {
    expect(GAP_MS).toBe(1);
    expect(ccSpellIds.has(POLY)).toBe(true);
  });

  it("two intervals of one aura from one source 1 ms apart, both ends logged: SPLIT (and a CC split)", () => {
    const t = scanLegacy(legacyOf(unitWith(rebroadcast())), {
      intervalsOf: () => two(),
      matchId: "m",
    });
    expect([t.rounds, t.intervals, t.split, t.splitCc, t.otherSource, t.ambiguous]).toEqual(
      [1, 2, 1, 1, 0, 0],
    );
    expect(t.hist[EDGES.indexOf(1)]).toBe(1);
    expect(t.histCc[EDGES.indexOf(1)]).toBe(1);
    expect([...t.bySpell.keys()]).toEqual(["Polymorph (118, CC)"]);
    expect(t.shows[0]).toMatch(/^ {2}SPLIT m P Polymorph/);
    expect(isClean(t)).toBe(false);
  });

  it("the next interval opened by ANOTHER source of the same name is not a split", () => {
    const t = scanLegacy(legacyOf(unitWith(rebroadcast("e2"))), {
      intervalsOf: () => two(),
    });
    expect([t.split, t.otherSource]).toEqual([0, 1]);
  });

  it("two sources closing and opening in the same ms cannot be read back: ambiguous, not a split", () => {
    const events = [
      ...rebroadcast("e1"),
      ev("SPELL_AURA_REMOVED", POLY, 10_185, "e3"),
      ev("SPELL_AURA_APPLIED", POLY, 10_186, "e3"),
    ];
    const t = scanLegacy(legacyOf(unitWith(events)), { intervalsOf: () => two() });
    expect([t.split, t.ambiguous]).toEqual([0, 1]);
  });

  it("a gap past the bound is histogrammed, not a split; an inferred end, an inferred start or a zero-length clamp is skipped", () => {
    const wide = scanLegacy(legacyOf(unitWith(rebroadcast("e1", 10_185, 10_188))), {
      intervalsOf: () => two(10.185, 10.188),
    });
    expect(wide.split).toBe(0);
    expect(wide.hist[EDGES.indexOf(5)]).toBe(1);
    const inferred = scanLegacy(legacyOf(unitWith(rebroadcast())), {
      intervalsOf: () => [iv(POLY, 5, 10.185, { inferredEnd: true }), iv(POLY, 10.186, 13)],
    });
    expect([inferred.split, inferred.hist.reduce((a, b) => a + b, 0)]).toEqual([0, 0]);
    const clamp = scanLegacy(legacyOf(unitWith(rebroadcast())), {
      intervalsOf: () => [iv(POLY, 5, 13), iv(POLY, 13, 13)],
    });
    expect(clamp.hist.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("a unit without COMBATANT_INFO is not scanned", () => {
    const t = scanLegacy(legacyOf(unitWith(rebroadcast(), null)), {
      intervalsOf: () => two(),
    });
    expect(t.intervals).toBe(0);
  });

  it("EARLY through the scan: the interval's end on a BROKEN line, 400 ms before the REMOVED", () => {
    const events = [
      ev("SPELL_AURA_APPLIED", NOVA, 5_000),
      ev("SPELL_AURA_BROKEN_SPELL", NOVA, 10_000),
      ev("SPELL_AURA_REMOVED", NOVA, 10_400),
    ];
    const t = scanLegacy(legacyOf(unitWith(events)), {
      intervalsOf: () => [iv(NOVA, 5, 10)],
      matchId: "m",
    });
    expect([t.early, t.earlyMs, t.split]).toEqual([1, 400, 0]);
    expect([...t.earlyBySpell.keys()]).toEqual(["Frost Nova (122)"]);
    expect(t.shows[0]).toMatch(/^ {2}EARLY m P Frost Nova/);
    expect(isClean(t)).toBe(false);
  });
});

describe("the real parser and the product's interval builder on a synthetic log", () => {
  const START_MS = Date.UTC(2026, 6, 19, 12, 0, 0);
  const ts = (offsetMs: number): string => {
    const d = new Date(START_MS + offsetMs);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const p3 = (n: number) => String(n).padStart(3, "0");
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(d.getUTCMilliseconds())}`;
  };
  const ALPHA = 'Player-1-0001,"Alpha-Realm",0x511,0x0';
  const DELTA = 'Player-1-0004,"Delta-Realm",0x548,0x0';
  const applied = (ms: number) =>
    `${ts(ms)}  SPELL_AURA_APPLIED,${ALPHA},${DELTA},${POLY},"Polymorph",0x40,DEBUFF`;
  const removed = (ms: number) =>
    `${ts(ms)}  SPELL_AURA_REMOVED,${ALPHA},${DELTA},${POLY},"Polymorph",0x40,DEBUFF,0`;
  const logWith = (extra: string[]) => {
    const lines = synthArenaLog({ startMs: START_MS }).split("\n");
    const end = lines.findIndex((l) => l.includes("ARENA_MATCH_END"));
    return [...lines.slice(0, end), ...extra, ...lines.slice(end)].join("\n");
  };

  it("a re-broadcast 1 ms apart, and one in the same ms, are one aura each — no SPLIT, no EARLY", () => {
    const items = itemsOfRawText(
      logWith([
        applied(5_000),
        removed(10_185),
        applied(10_186),
        removed(13_000),
        applied(20_000),
        removed(22_000),
        applied(22_000),
        removed(24_000),
      ]),
    );
    expect(items).toHaveLength(1);
    const { id, legacy } = items[0]!;
    expect(legacy.units["Player-1-0004"]?.info).toBeTruthy();
    const t = scanLegacy(legacy, { matchId: id });
    expect(t.rounds).toBe(1);
    expect(t.intervals).toBe(2);
    expect([t.split, t.early, t.otherSource, t.ambiguous]).toEqual([0, 0, 0, 0]);
    expect(isClean(t)).toBe(true);
  });
});
