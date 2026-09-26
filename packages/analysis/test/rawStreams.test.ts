// packages/analysis/test/rawStreams.test.ts
/**
 * TDD fixture for rawStreams (BACKLOG #26 Task 1) — raw.txt's per-event mana
 * stream (SPELL_CAST_SUCCESS's advanced block, powerType 0) and
 * SPELL_CAST_FAILED intent stream. Line shapes below are copied field-for-
 * field from real raw.txt lines (see rawStreams.ts's module header for the
 * real match 60ab1e8f anchor this offset scheme was verified against) —
 * GUIDs/spellIds/mana values are the real Holy Paladin healer/Holy Shock
 * shape, timestamps use fractional seconds per the plan's Global Constraints
 * ("fixture 用小数时刻").
 */
import { describe, expect, it } from "vitest";

import {
  castFailedInWindow,
  drinkingSegments,
  manaAt,
  manaPct,
  oomWindows,
  parseRawStreams,
  roundDurationSOf,
  type RawStreams,
} from "../src/utils/rawStreams";

const GUID = "Player-57-0E0CB0B6";
const OTHER_GUID = "Player-11-0EAEB10E";

/** Advanced-info tail with an injected mana pair, matching the real block
 * shape verified against 60ab1e8f (`...,0,0,0,<mana>,<manaMax>,0,<x>,<y>,0,<facing>,<level>`). */
function castSuccessLine(
  ts: string,
  actorGuid: string,
  mana: number,
  manaMax: number,
): string {
  return `7/19/2026 ${ts}-4  SPELL_CAST_SUCCESS,${GUID},"Minilay-Illidan-US",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,${actorGuid},0000000000000000,612340,612340,3012,2896,2605,2385,0,0,0,${mana},${manaMax},0,1278.80,1721.48,0,4.8195,298`;
}

function castFailedLine(ts: string, reason: string): string {
  return `7/19/2026 ${ts}-4  SPELL_CAST_FAILED,${GUID},"Minilay-Illidan-US",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,"${reason}"`;
}

// BASE_MS matches 60ab1e8f's real ARENA_MATCH_START instant shape (2026-07-19
// 08:10:46.833 UTC, logged locally as "04:10:46.833-4").
const BASE_MS = Date.UTC(2026, 6, 19, 8, 10, 46, 833);

describe("parseRawStreams", () => {
  it("extracts 2 castFailed (reason verbatim) + 3 manaSamples forming a decline; skips a malformed line and a non-GUID block-start line silently", () => {
    const raw = [
      castFailedLine("04:10:47.150", "尚未恢复"),
      castSuccessLine("04:10:47.267", GUID, 10000, 20000),
      "this is not a combat log line at all — no double-space, no comma-event shape",
      castFailedLine("04:10:47.612", "法力值不足"),
      castSuccessLine("04:10:47.900", GUID, 8000, 20000),
      // block-start (actorGuid, params[11]) is a bare hex zero GUID, not a
      // real unit — must be skipped, not crash or produce a bogus sample.
      castSuccessLine("04:10:48.100", "0000000000000000", 999, 20000),
      castSuccessLine("04:10:48.400", GUID, 6000, 20000),
    ].join("\n");

    const streams = parseRawStreams(raw, BASE_MS);

    expect(streams.available).toBe(true);
    expect(streams.castFailed).toHaveLength(2);
    expect(streams.castFailed.map((c) => c.reason)).toEqual([
      "尚未恢复",
      "法力值不足",
    ]);
    expect(streams.castFailed.every((c) => c.unitGuid === GUID)).toBe(true);
    expect(streams.castFailed.every((c) => c.spellId === 20473)).toBe(true);
    expect(streams.castFailed.every((c) => c.spellName === "神圣震击")).toBe(
      true,
    );

    expect(streams.manaSamples).toHaveLength(3);
    expect(streams.manaSamples.map((m) => m.mana)).toEqual([10000, 8000, 6000]);
    expect(streams.manaSamples.every((m) => m.manaMax === 20000)).toBe(true);
    expect(streams.manaSamples.every((m) => m.unitGuid === GUID)).toBe(true);

    // fractional-second timestamps are preserved, not floored (that's a
    // consumer-side render-grid concern, not this module's job).
    for (const m of streams.manaSamples) {
      expect(Number.isInteger(m.tSeconds)).toBe(false);
    }
    // strictly increasing, matching file order.
    const times = streams.manaSamples.map((m) => m.tSeconds);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("rawText null → available:false, empty arrays, no throw", () => {
    const streams = parseRawStreams(null, BASE_MS);
    expect(streams).toEqual({
      available: false,
      manaSamples: [],
      castFailed: [],
    });
  });

  it("rawText empty string → available:false", () => {
    const streams = parseRawStreams("", BASE_MS);
    expect(streams.available).toBe(false);
  });

  it("ignores mana samples belonging to a different unit's advanced block", () => {
    const raw = [castSuccessLine("04:10:47.267", OTHER_GUID, 5000, 20000)].join(
      "\n",
    );
    const streams = parseRawStreams(raw, BASE_MS);
    expect(streams.manaSamples).toHaveLength(1);
    expect(streams.manaSamples[0]!.unitGuid).toBe(OTHER_GUID);
    expect(manaAt(streams, GUID, 100)).toBeNull();
  });
});

describe("parseRawStreams round-boundary clamp (BACKLOG #32 — Solo Shuffle cross-round contamination)", () => {
  // `BASE_MS` is round N's own startTime ("04:10:46.833-4"). A Solo Shuffle
  // raw.txt is ONE file shared by all 6 rounds, so lines belonging to an
  // EARLIER round land at negative tSeconds (relative to round N's baseMs)
  // and lines belonging to a LATER round land at tSeconds > this round's own
  // duration — both directions leak today (BACKLOG #32). This fixture shapes
  // a two-round-adjacent raw text: one event clearly from the PRECEDING
  // round (-3s), three events inside round N's own 5s span (0s/2.5s/5s —
  // boundary-inclusive), and one event clearly from the FOLLOWING round
  // (+8s) — mirroring the real file layout (one raw.txt, multiple rounds'
  // events interleaved by wall-clock order).
  const ROUND_DURATION_S = 5;

  function buildTwoRoundShapedRaw(): string {
    return [
      // previous round's tail — negative tSeconds relative to this round.
      castFailedLine("04:10:43.800", "尚未恢复"), // t=-3.033
      castSuccessLine("04:10:44.000", GUID, 15000, 20000), // t=-2.833
      // this round's own content — must all survive.
      castSuccessLine("04:10:46.833", GUID, 10000, 20000), // t=0 (inclusive lower bound)
      castFailedLine("04:10:48.500", "法力值不足"), // t=1.667
      castSuccessLine("04:10:51.833", GUID, 8000, 20000), // t=5 (inclusive upper bound)
      // next round's head — tSeconds beyond this round's own duration.
      castFailedLine("04:10:55.900", "尚未恢复"), // t=9.067
      castSuccessLine("04:10:58.000", GUID, 6000, 20000), // t=11.167
    ].join("\n");
  }

  it("no roundDurationS passed (3rd arg omitted) → unbounded, byte-identical to pre-#32 behavior", () => {
    const streams = parseRawStreams(buildTwoRoundShapedRaw(), BASE_MS);
    expect(streams.manaSamples).toHaveLength(4);
    expect(streams.castFailed).toHaveLength(3);
  });

  it("roundDurationS passed → only in-round content survives (negative AND beyond-duration both excluded)", () => {
    const streams = parseRawStreams(
      buildTwoRoundShapedRaw(),
      BASE_MS,
      ROUND_DURATION_S,
    );
    expect(streams.available).toBe(true);

    // 2 mana samples: t=0 and t=5, both boundary-inclusive.
    expect(streams.manaSamples).toHaveLength(2);
    expect(streams.manaSamples.map((m) => m.mana)).toEqual([10000, 8000]);
    for (const m of streams.manaSamples) {
      expect(m.tSeconds).toBeGreaterThanOrEqual(0);
      expect(m.tSeconds).toBeLessThanOrEqual(ROUND_DURATION_S);
    }

    // 1 castFailed: t=1.667 only — the -3.033s and +9.067s events excluded.
    expect(streams.castFailed).toHaveLength(1);
    expect(streams.castFailed[0]!.reason).toBe("法力值不足");
  });

  it("roundDurationS=0 (degenerate/zero-length round) excludes everything except an exact t=0 sample", () => {
    const raw = [
      castSuccessLine("04:10:46.833", GUID, 10000, 20000), // t=0
      castFailedLine("04:10:47.000", "尚未恢复"), // t=0.167 — excluded
    ].join("\n");
    const streams = parseRawStreams(raw, BASE_MS, 0);
    expect(streams.manaSamples).toHaveLength(1);
    expect(streams.castFailed).toHaveLength(0);
  });
});

describe("manaAt", () => {
  const fixture: RawStreams = {
    available: true,
    manaSamples: [
      { tSeconds: 1.1, unitGuid: GUID, mana: 100, manaMax: 1000 },
      { tSeconds: 3.4, unitGuid: GUID, mana: 80, manaMax: 1000 },
      { tSeconds: 5.9, unitGuid: GUID, mana: 60, manaMax: 1000 },
    ],
    castFailed: [],
  };

  it("returns the nearest sample at-or-before t", () => {
    expect(manaAt(fixture, GUID, 2)).toEqual({ mana: 100, manaMax: 1000 });
    expect(manaAt(fixture, GUID, 3.4)).toEqual({ mana: 80, manaMax: 1000 });
    expect(manaAt(fixture, GUID, 100)).toEqual({ mana: 60, manaMax: 1000 });
  });

  it("returns null when t is before every sample for that unit", () => {
    expect(manaAt(fixture, GUID, 0)).toBeNull();
  });

  it("returns null when unavailable", () => {
    expect(manaAt({ ...fixture, available: false }, GUID, 10)).toBeNull();
  });
});

describe("oomWindows", () => {
  const fixture: RawStreams = {
    available: true,
    manaSamples: [
      { tSeconds: 0.5, unitGuid: GUID, mana: 500, manaMax: 1000 }, // 50% — not OOM
      { tSeconds: 1.5, unitGuid: GUID, mana: 90, manaMax: 1000 }, // 9% — OOM starts
      { tSeconds: 2.5, unitGuid: GUID, mana: 50, manaMax: 1000 }, // 5%
      { tSeconds: 3.5, unitGuid: GUID, mana: 95, manaMax: 1000 }, // 9.5% — still OOM
      { tSeconds: 4.5, unitGuid: GUID, mana: 200, manaMax: 1000 }, // 20% — OOM ends
      { tSeconds: 5.5, unitGuid: GUID, mana: 80, manaMax: 1000 }, // 8% — new single-sample OOM window
      { tSeconds: 6.5, unitGuid: GUID, mana: 300, manaMax: 1000 }, // 30% — closes it
    ],
    castFailed: [],
  };

  it("groups contiguous below-threshold samples into windows", () => {
    expect(oomWindows(fixture, GUID, 10)).toEqual([
      { fromS: 1.5, toS: 3.5, minMana: 50 },
      { fromS: 5.5, toS: 5.5, minMana: 80 },
    ]);
  });

  it("a trailing below-threshold run still closes into a window (open at EOF)", () => {
    const trailing: RawStreams = {
      available: true,
      manaSamples: [
        { tSeconds: 1, unitGuid: GUID, mana: 500, manaMax: 1000 },
        { tSeconds: 2, unitGuid: GUID, mana: 10, manaMax: 1000 },
      ],
      castFailed: [],
    };
    expect(oomWindows(trailing, GUID, 10)).toEqual([
      { fromS: 2, toS: 2, minMana: 10 },
    ]);
  });

  it("returns [] when unavailable or no samples cross the threshold", () => {
    expect(oomWindows({ ...fixture, available: false }, GUID, 10)).toEqual([]);
    expect(oomWindows(fixture, GUID, 1)).toEqual([]);
  });
});

describe("manaPct", () => {
  // Single-sourced (BACKLOG #26 final review §2.d.1): `oomWindows` above and
  // `extendOomTailWithFailedCasts` (candidateFindings.ts) both consume this
  // exact fact — byte-identical output is load-bearing, not just style.
  it("mana over manaMax, as a raw percent, no rounding", () => {
    expect(manaPct({ mana: 500, manaMax: 1000 })).toBe(50);
    expect(manaPct({ mana: 1, manaMax: 3 })).toBeCloseTo(33.333333, 5);
  });

  it("manaMax <= 0 falls back to 0, not NaN/Infinity", () => {
    expect(manaPct({ mana: 500, manaMax: 0 })).toBe(0);
    expect(manaPct({ mana: 500, manaMax: -10 })).toBe(0);
  });

  it("agrees with oomWindows' own below-threshold grouping on the fixture above", () => {
    // 90/1000 = 9% is the exact boundary oomWindows' fixture comments assert.
    expect(manaPct({ mana: 90, manaMax: 1000 })).toBe(9);
  });
});

describe("roundDurationSOf", () => {
  // Single-sourced (BACKLOG #26 final review §2.d.2): the guarded convention
  // `rawStreamsCache.ts`/`p1p2Ab.ts` already used, now threaded through all 6
  // `parseRawStreams`-3rd-arg call sites.
  it("derives seconds from a well-formed span", () => {
    expect(roundDurationSOf(1000, 181000)).toBe(180);
  });

  it("non-finite endTime falls back to undefined (unbounded), not NaN", () => {
    expect(roundDurationSOf(1000, undefined)).toBeUndefined();
    expect(roundDurationSOf(1000, NaN)).toBeUndefined();
    expect(roundDurationSOf(1000, Infinity)).toBeUndefined();
  });

  it("endTime before startTime falls back to undefined, not a negative duration", () => {
    expect(roundDurationSOf(5000, 1000)).toBeUndefined();
  });

  it("endTime === startTime is a valid zero-length round, not undefined", () => {
    expect(roundDurationSOf(1000, 1000)).toBe(0);
  });
});

describe("castFailedInWindow", () => {
  const fixture: RawStreams = {
    available: true,
    manaSamples: [],
    castFailed: [
      {
        tSeconds: 1,
        unitGuid: GUID,
        spellId: 20473,
        spellName: "神圣震击",
        reason: "法力值不足",
      },
      {
        tSeconds: 2,
        unitGuid: GUID,
        spellId: 156322,
        spellName: "永恒之火",
        reason: "尚未恢复",
      },
      {
        tSeconds: 6,
        unitGuid: GUID,
        spellId: 20473,
        spellName: "神圣震击",
        reason: "法力值不足",
      },
    ],
  };

  it("filters to the [fromS, toS] window, inclusive both ends", () => {
    expect(
      castFailedInWindow(fixture, GUID, 0, 5).map((c) => c.tSeconds),
    ).toEqual([1, 2]);
    expect(
      castFailedInWindow(fixture, GUID, 1, 1).map((c) => c.tSeconds),
    ).toEqual([1]);
  });

  it("optionally narrows to one spellId", () => {
    expect(
      castFailedInWindow(fixture, GUID, 0, 10, 20473).map((c) => c.tSeconds),
    ).toEqual([1, 6]);
  });

  it("returns [] when unavailable", () => {
    expect(
      castFailedInWindow({ ...fixture, available: false }, GUID, 0, 10),
    ).toEqual([]);
  });
});

describe("drinkingSegments", () => {
  const fixture: RawStreams = {
    available: true,
    manaSamples: [
      { tSeconds: 0, unitGuid: GUID, mana: 500, manaMax: 1000 },
      { tSeconds: 1, unitGuid: GUID, mana: 500, manaMax: 1000 }, // flat
      { tSeconds: 2, unitGuid: GUID, mana: 600, manaMax: 1000 }, // rising
      { tSeconds: 3, unitGuid: GUID, mana: 800, manaMax: 1000 }, // rising
      { tSeconds: 4, unitGuid: GUID, mana: 800, manaMax: 1000 }, // flat — closes segment
      { tSeconds: 5, unitGuid: GUID, mana: 400, manaMax: 1000 }, // drop
      { tSeconds: 6, unitGuid: GUID, mana: 900, manaMax: 1000 }, // rising — open at EOF
    ],
    castFailed: [],
  };

  it("emits one segment per contiguous rising run, baseline-to-peak", () => {
    expect(drinkingSegments(fixture, GUID)).toEqual([
      { fromS: 1, toS: 3, manaGained: 300 },
      { fromS: 5, toS: 6, manaGained: 500 },
    ]);
  });

  it("returns [] when unavailable or nothing ever rises", () => {
    expect(drinkingSegments({ ...fixture, available: false }, GUID)).toEqual(
      [],
    );
    const flat: RawStreams = {
      available: true,
      manaSamples: [
        { tSeconds: 0, unitGuid: GUID, mana: 500, manaMax: 1000 },
        { tSeconds: 1, unitGuid: GUID, mana: 500, manaMax: 1000 },
        { tSeconds: 2, unitGuid: GUID, mana: 400, manaMax: 1000 },
      ],
      castFailed: [],
    };
    expect(drinkingSegments(flat, GUID)).toEqual([]);
  });
});

describe("CRLF logs (reliability leftovers batch 10, 02c8e3ac)", () => {
  it("the cast-failed reason carries no trailing carriage return", () => {
    const text = [castFailedLine("04:10:50.000", "尚未恢复")].join("\r\n") + "\r\n";
    const rs = parseRawStreams(text, BASE_MS);
    expect(rs.castFailed).toHaveLength(1);
    expect(rs.castFailed[0]!.reason).toBe("尚未恢复");
  });
});
