import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  creditSpikesToWindows,
  DMG_SPIKE_THRESHOLD,
  isPointBucket,
  NO_CREDITED_SPIKE_CLAUSE,
  PEAK_SPIKE_MARKERS,
  peakSpikeMarker,
  peakSpikePlacement,
  spikeWindowOverlapSeconds,
} from "../src";
import {
  buildMatchTimeline,
  BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import { emitDmgSpikeEntries } from "../src/context/matchTimelineSections";
import { selectPressureWindows } from "../src/utils/cooldowns";
import { makeDamageEvent, makeUnit } from "./ported/testHelpers";

function mkUnit(
  id: string,
  name: string,
  reaction: CombatUnitReaction,
  spec: CombatUnitSpec = CombatUnitSpec.Priest_Discipline,
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Priest,
    spec,
    reaction,
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    auraEvents: [],
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
    advancedActions: [],
  };
}

describe("peakSpikePlacement", () => {
  it("classifies the three placements correctly", () => {
    // inside: spike entirely within window
    expect(peakSpikePlacement(30, 10, 25)).toBe("inside");
    expect(peakSpikeMarker("inside")).toBe("");
    expect(PEAK_SPIKE_MARKERS["inside"]).toBe("");

    // runs-past: spike starts inside window but ends after
    expect(peakSpikePlacement(30, 10, 35)).toBe("runs-past");
    expect(peakSpikeMarker("runs-past")).toBe(" (runs past window)");
    expect(PEAK_SPIKE_MARKERS["runs-past"]).toBe(" (runs past window)");

    // after: spike starts at or after window end
    expect(peakSpikePlacement(30, 35, 45)).toBe("after");
    expect(peakSpikeMarker("after")).toBe(" (lands after window)");
    expect(PEAK_SPIKE_MARKERS["after"]).toBe(" (lands after window)");
  });

  it("satisfies boundary equality: spikeFrom == windowTo is 'after', spikeTo == windowTo is 'inside'", () => {
    // spikeFrom == windowTo -> "after"
    expect(peakSpikePlacement(20, 20, 25)).toBe("after");

    // spikeTo == windowTo -> "inside"
    expect(peakSpikePlacement(20, 10, 20)).toBe("inside");
  });

  it("floors bounds to whole seconds on the render grid", () => {
    // windowTo 20.8 -> 20; spikeFrom 20.1 -> 20 (equal -> after)
    expect(peakSpikePlacement(20.8, 20.1, 25.4)).toBe("after");

    // windowTo 20.8 -> 20; spikeTo 20.9 -> 20 (equal -> inside)
    expect(peakSpikePlacement(20.8, 10.3, 20.9)).toBe("inside");

    // windowTo 20.2 -> 20; spikeFrom 19.9 -> 19; spikeTo 21.1 -> 21 (runs-past)
    expect(peakSpikePlacement(20.2, 19.9, 21.1)).toBe("runs-past");
  });
});

// ── T12 ③ (user ruling 2026-10-10): which spike a header names ──────────────

type Span = { fromSeconds: number; toSeconds: number };
type Spike = Span & { totalDamage: number; targetName?: string };

const isHeader = (l: string) => /^\d+:\d\d {2}\[OFFENSIVE WINDOW\]/.test(l);

function renderHeaders(
  windows: Span[],
  spikes: Spike[],
  over: Partial<BuildMatchTimelineParams> & { ownerDiedAtMs?: number } = {},
): string[] {
  return renderTimeline(windows, spikes, over).filter(isHeader);
}

function renderTimeline(
  windows: Span[],
  spikes: Spike[],
  over: Partial<BuildMatchTimelineParams> & { ownerDiedAtMs?: number } = {},
): string[] {
  const { ownerDiedAtMs, ...paramOver } = over;
  const owner = mkUnit("o", "Me-Realm", CombatUnitReaction.Friendly);
  if (ownerDiedAtMs !== undefined)
    Object.assign(owner, {
      info: {},
      deathRecords: [{ timestamp: ownerDiedAtMs }],
    });
  const mate = mkUnit(
    "m",
    "Mate-Realm",
    CombatUnitReaction.Friendly,
    CombatUnitSpec.Shaman_Enhancement,
  );
  const enemy = mkUnit("e", "Enemy-Realm", CombatUnitReaction.Hostile);

  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Discipline Priest",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: {
      players: [],
      alignedBurstWindows: windows.map(
        (w) =>
          ({
            ...w,
            activeCDs: [
              {
                playerName: "Enemy-Realm",
                spellId: "107574",
                spellName: "Avatar",
                castSeconds: w.fromSeconds,
              },
            ],
            threatScore: 100,
            threatLabel: "Critical",
          }) as any,
      ),
    },
    ccTrinketSummaries: [],
    dispelSummary: {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      lateCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    },
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: spikes.map(
      (sp) =>
        ({
          targetName: mate.name,
          targetSpec: "Enhancement Shaman",
          ...sp,
        }) as any,
    ),
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy],
    matchStartMs: 0,
    matchEndMs: 200_000,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
    ...paramOver,
  };

  return buildMatchTimeline(params).split("\n");
}

const BIG = DMG_SPIKE_THRESHOLD + 1_600_000; // 1.90M
const MID = DMG_SPIKE_THRESHOLD + 1_360_000; // 1.66M

describe("spikeWindowOverlapSeconds", () => {
  it("counts the displayed seconds two intervals share", () => {
    expect(spikeWindowOverlapSeconds(32, 54, 37, 47)).toBe(10);
    expect(spikeWindowOverlapSeconds(32, 54, 50, 60)).toBe(4);
    expect(spikeWindowOverlapSeconds(55, 70, 50, 60)).toBe(5);
  });

  it("is zero where peakSpikePlacement says 'after', and for a spike that ended as the window began", () => {
    expect(peakSpikePlacement(54, 54, 64)).toBe("after");
    expect(spikeWindowOverlapSeconds(32, 54, 54, 64)).toBe(0);
    expect(spikeWindowOverlapSeconds(32, 54, 57, 67)).toBe(0);
    expect(spikeWindowOverlapSeconds(32, 54, 22, 32)).toBe(0);
  });

  it("floors both intervals onto the render grid first", () => {
    // window 32.9–54.9 prints 0:32–0:54; spike 53.2–63.2 prints 0:53–1:03
    expect(spikeWindowOverlapSeconds(32.9, 54.9, 53.2, 63.2)).toBe(1);
    // spike 54.1–64.1 prints 0:54–1:04: starts in the second the window ends
    expect(spikeWindowOverlapSeconds(32.9, 54.9, 54.1, 64.1)).toBe(0);
  });
});

describe("creditSpikesToWindows", () => {
  const A = { fromSeconds: 32, toSeconds: 54 };
  const B = { fromSeconds: 55, toSeconds: 70 };

  it("credits a spike only to a window it overlaps", () => {
    expect(
      creditSpikesToWindows(
        [A],
        [
          { fromSeconds: 57, toSeconds: 67 }, // after A
          { fromSeconds: 37, toSeconds: 47 }, // inside A
          { fromSeconds: 20, toSeconds: 30 }, // before A
        ],
      ),
    ).toEqual([-1, 0, -1]);
  });

  it("one spike, one window: the longest overlap", () => {
    // 0:50–1:00 shares 4 s with A (0:32–0:54) and 5 s with B (0:55–1:10)
    expect(
      creditSpikesToWindows([A, B], [{ fromSeconds: 50, toSeconds: 60 }]),
    ).toEqual([1]);
    // 0:48–0:58 shares 6 s with A and 3 s with B
    expect(
      creditSpikesToWindows([A, B], [{ fromSeconds: 48, toSeconds: 58 }]),
    ).toEqual([0]);
  });

  it("an equal overlap goes to the window that starts first, whatever the list order", () => {
    const C = { fromSeconds: 59, toSeconds: 70 };
    // 0:49–1:04 shares 5 s with A and 5 s with C
    const spike = [{ fromSeconds: 49, toSeconds: 64 }];
    expect(creditSpikesToWindows([A, C], spike)).toEqual([0]);
    expect(creditSpikesToWindows([C, A], spike)).toEqual([1]);
  });

  it("no windows, no credit", () => {
    expect(
      creditSpikesToWindows([], [{ fromSeconds: 1, toSeconds: 11 }]),
    ).toEqual([-1]);
  });
});

describe("[OFFENSIVE WINDOW] names only a spike that overlaps it, and each spike once (T12 ③)", () => {
  it("539b6ed0's shape: each window names its own spike, not the larger one that follows it", () => {
    const headers = renderHeaders(
      [
        { fromSeconds: 32, toSeconds: 54 },
        { fromSeconds: 55, toSeconds: 70 },
      ],
      [
        { fromSeconds: 57, toSeconds: 67, totalDamage: BIG },
        { fromSeconds: 37, toSeconds: 47, totalDamage: MID },
      ],
    );
    expect(headers).toEqual([
      "0:32  [OFFENSIVE WINDOW]   0:32–0:54 | peak spike 1.66M on Mate (Enhancement Shaman) over 0:37–0:47 | CDs: Avatar@0:32",
      "0:55  [OFFENSIVE WINDOW]   0:55–1:10 | peak spike 1.90M on Mate (Enhancement Shaman) over 0:57–1:07 | CDs: Avatar@0:55",
    ]);
  });

  it("a spike that starts after the window ended is not credited: the header stays and says so", () => {
    // was: `1:15–1:35 | peak spike 1.03M on … over 1:37–1:47 (lands after window)`
    const headers = renderHeaders(
      [{ fromSeconds: 75, toSeconds: 95 }],
      [
        {
          fromSeconds: 97,
          toSeconds: 107,
          totalDamage: DMG_SPIKE_THRESHOLD + 100_000,
        },
      ],
    );
    expect(headers).toEqual([
      `1:15  [OFFENSIVE WINDOW]   1:15–1:35 | ${NO_CREDITED_SPIKE_CLAUSE} | CDs: Avatar@1:15`,
    ]);
    expect(NO_CREDITED_SPIKE_CLAUSE).toBe(
      "no listed [DMG SPIKE] credited to it",
    );
  });

  it("a spike shared by two windows is named on the one it overlaps longest; the other keeps its header", () => {
    const headers = renderHeaders(
      [
        { fromSeconds: 32, toSeconds: 54 },
        { fromSeconds: 55, toSeconds: 70 },
      ],
      [{ fromSeconds: 50, toSeconds: 60, totalDamage: BIG }],
    );
    expect(headers).toEqual([
      `0:32  [OFFENSIVE WINDOW]   0:32–0:54 | ${NO_CREDITED_SPIKE_CLAUSE} | CDs: Avatar@0:32`,
      "0:55  [OFFENSIVE WINDOW]   0:55–1:10 | peak spike 1.90M on Mate (Enhancement Shaman) over 0:50–1:00 | CDs: Avatar@0:55",
    ]);
  });

  it("a credited spike that ends after the window still carries (runs past window)", () => {
    const headers = renderHeaders(
      [{ fromSeconds: 75, toSeconds: 95 }],
      [{ fromSeconds: 90, toSeconds: 100, totalDamage: BIG }],
    );
    expect(headers).toEqual([
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.90M on Mate (Enhancement Shaman) over 1:30–1:40 (runs past window) | CDs: Avatar@1:15",
    ]);
  });

  it("which windows get a header is unchanged: one no listed spike starts within 5 s of gets none", () => {
    expect(
      renderHeaders(
        [{ fromSeconds: 75, toSeconds: 95 }],
        [{ fromSeconds: 120, toSeconds: 130, totalDamage: BIG }],
      ),
    ).toEqual([]);
  });

  it("T12 ① b: the header's end is cut at the round's end — the log's end, or a Solo Shuffle round's first death", () => {
    const window = [{ fromSeconds: 185, toSeconds: 215 }];
    const spike = [{ fromSeconds: 188, toSeconds: 198, totalDamage: BIG }];
    // the log ends at 3:20: a union of buff lengths ran to 3:35
    expect(renderHeaders(window, spike)).toEqual([
      "3:05  [OFFENSIVE WINDOW]   3:05–3:20 | peak spike 1.90M on Mate (Enhancement Shaman) over 3:08–3:18 | CDs: Avatar@3:05",
    ]);
    // Solo Shuffle: the round is over at the first player death (3:12), 8 s before the log's end
    expect(
      renderHeaders(window, spike, {
        bracket: "Rated Solo Shuffle",
        ownerDiedAtMs: 192_400,
      }),
    ).toEqual([
      "3:05  [OFFENSIVE WINDOW]   3:05–3:12 | peak spike 1.90M on Mate (Enhancement Shaman) over 3:08–3:18 (runs past window) | CDs: Avatar@3:05",
    ]);
    // a window that ends inside the round is untouched
    expect(
      renderHeaders(
        [{ fromSeconds: 32, toSeconds: 54 }],
        [{ fromSeconds: 37, toSeconds: 47, totalDamage: BIG }],
      )[0],
    ).toContain("0:32–0:54");
  });

  it("review 40-FT-54: two windows cut at the same round end — the spike goes where the PRINTED spans send it", () => {
    // unclamped, the later window overlaps the spike for 10 s and the earlier
    // one for 4 s; as printed (both end 3:12) they tie at 4 s and the earlier
    // one takes it — which is what the gate, reading the headers, computes
    const headers = renderHeaders(
      [
        { fromSeconds: 185, toSeconds: 215 },
        { fromSeconds: 180, toSeconds: 192 },
      ],
      [{ fromSeconds: 188, toSeconds: 198, totalDamage: BIG }],
      { bracket: "Rated Solo Shuffle", ownerDiedAtMs: 192_400 },
    );
    expect(headers.map((h) => h.split(" | ").slice(0, 2).join(" | "))).toEqual([
      "3:00  [OFFENSIVE WINDOW]   3:00–3:12 | peak spike 1.90M on Mate (Enhancement Shaman) over 3:08–3:18 (runs past window)",
      `3:05  [OFFENSIVE WINDOW]   3:05–3:12 | ${NO_CREDITED_SPIKE_CLAUSE}`,
    ]);
  });

  // Post-hoc review 45-FT-98, finding 3: a listed spike starts at or before
  // the round's end, so the 5 s rule admits a window opened up to 5 s after
  // it — and its end, cut at the round's end, read before its start.
  describe("a window that opens at or after the round's end gets no header", () => {
    // a cooldown in the owner's ledger, so the B14b row under a header prints
    const ownerCDs = [
      {
        spellId: "33206",
        spellName: "Pain Suppression",
        tag: "Defensive",
        cooldownSeconds: 180,
        maxChargesDetected: 1,
        casts: [],
        availableWindows: [],
        neverUsed: true,
      },
    ] as never;
    const threes = { ownerCDs };
    const shuffle = {
      ownerCDs,
      bracket: "Rated Solo Shuffle",
      ownerDiedAtMs: 192_400,
    };
    // the round's last listed spike: 3:10 to the round-ending death at 3:12
    const spike = [{ fromSeconds: 190, toSeconds: 192.4, totalDamage: BIG }];
    /** the `[RES]` rows printed for a window: the line under each header */
    const resRowsUnderHeaders = (lines: string[]) =>
      lines.filter(
        (l, i) => i > 0 && isHeader(lines[i - 1]!) && l.includes("[RES] rdy:"),
      );

    it("opened 1.6 s after the round-ending death: no `3:14–3:12` header, and no [RES] row for it", () => {
      const late = [{ fromSeconds: 194, toSeconds: 206 }];
      // the same window in a 3v3 — the round goes on — keeps header and row
      const inRound = renderTimeline(late, spike, threes);
      expect(inRound.filter(isHeader)).toEqual([
        `3:14  [OFFENSIVE WINDOW]   3:14–3:20 | ${NO_CREDITED_SPIKE_CLAUSE} | CDs: Avatar@3:14`,
      ]);
      expect(resRowsUnderHeaders(inRound)).toHaveLength(1);

      const lines = renderTimeline(late, spike, shuffle);
      expect(lines.filter(isHeader)).toEqual([]);
      expect(lines.join("\n")).not.toContain("3:14–3:12");
      expect(resRowsUnderHeaders(lines)).toEqual([]);
    });

    it("opened in the round's last second, before the death, it is in the round; opened in that second after the death it is not", () => {
      expect(
        renderHeaders([{ fromSeconds: 192.1, toSeconds: 206 }], spike, shuffle),
      ).toEqual([
        "3:12  [OFFENSIVE WINDOW]   3:12–3:12 | no listed [DMG SPIKE] credited to it | CDs: Avatar@3:12",
      ]);
      expect(
        renderHeaders([{ fromSeconds: 192.4, toSeconds: 206 }], spike, shuffle),
      ).toEqual([]);
      expect(
        renderHeaders([{ fromSeconds: 192.6, toSeconds: 206 }], spike, shuffle),
      ).toEqual([]);
    });

    it("the windows of the round keep their headers, their [RES] rows and their spike — the dropped one takes nothing", () => {
      const lines = renderTimeline(
        [
          { fromSeconds: 180, toSeconds: 200 },
          { fromSeconds: 194, toSeconds: 206 },
        ],
        spike,
        shuffle,
      );
      expect(lines.filter(isHeader)).toEqual([
        "3:00  [OFFENSIVE WINDOW]   3:00–3:12 | peak spike 1.90M on Mate (Enhancement Shaman) over 3:10–3:12 | CDs: Avatar@3:00",
      ]);
      expect(resRowsUnderHeaders(lines)).toHaveLength(1);
    });
  });

  it("the largest credited spike is the peak, whatever order the buckets arrive in", () => {
    const headers = renderHeaders(
      [{ fromSeconds: 32, toSeconds: 70 }],
      [
        { fromSeconds: 37, toSeconds: 47, totalDamage: MID },
        { fromSeconds: 57, toSeconds: 67, totalDamage: BIG },
      ],
    );
    expect(headers).toEqual([
      "0:32  [OFFENSIVE WINDOW]   0:32–1:10 | peak spike 1.90M on Mate (Enhancement Shaman) over 0:57–1:07 | CDs: Avatar@0:32",
    ]);
  });
});

// Post-hoc review 45-FT-98, finding 4: a bucket closed in the second it opened
// (T12 ① c closes it at its victim's death / the round's end) prints
// `m:ss–m:ss` on one second, has no length to share with any window, and was
// credited to none.
describe("a [DMG SPIKE] bucket that prints one second is in the window whose span holds it", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const victim = (hits: Array<[number, number]>, deathS?: number) =>
    makeUnit("f1", {
      name: "Victim-Realm",
      spec: CombatUnitSpec.Warlock_Affliction,
      info: {},
      damageIn: hits.map(([s, amount]) => makeDamageEvent(at(s), amount, "f1")),
      deathRecords: deathS === undefined ? [] : [{ timestamp: at(deathS) }],
    });
  const combatOf = (units: ReturnType<typeof makeUnit>[], bracket: string) =>
    ({
      startTime: T0,
      endTime: at(60),
      startInfo: { bracket },
      units: Object.fromEntries(units.map((u) => [u.id, u])),
    }) as never;
  const spikeLines = (
    unit: ReturnType<typeof makeUnit>,
    combat: Parameters<typeof selectPressureWindows>[1],
  ) => {
    const out: string[] = [];
    emitDmgSpikeEntries({
      pressureWindows: selectPressureWindows([unit], combat).listed,
      friends: [unit],
      matchStartMs: T0,
      pid: (n) => n.split("-")[0]!,
      addEntry: (_t, ...ls) =>
        out.push(...ls.filter((l) => typeof l === "string")),
    });
    return out.filter((l) => l.includes("[DMG SPIKE]"));
  };

  // The premise, on the real selection: the review's bucket exists.
  it("selectPressureWindows does list one: the hits of the death second, when no earlier bucket of the unit reaches them", () => {
    // 0.50M at 0:30 (its bucket runs to 0:40), then 0.40M inside the death second
    const dead = victim(
      [
        [30, 500_000],
        [45.05, 200_000],
        [45.6, 200_000],
      ],
      45.6,
    );
    const combat = combatOf([dead], "3v3");
    const { listed } = selectPressureWindows([dead], combat);
    expect(listed.map((b) => [b.fromSeconds, b.toSeconds])).toEqual([
      [30, 40],
      [45.05, 45.6],
    ]);
    expect(listed[1]!.totalDamage).toBeGreaterThanOrEqual(DMG_SPIKE_THRESHOLD);
    expect(isPointBucket(45.05, 45.6)).toBe(true);
    expect(isPointBucket(30, 40)).toBe(false);
    expect(spikeLines(dead, combat)[1]).toContain("0:45–0:45  [DMG SPIKE]");

    // the killing blow alone: the bucket opens and closes on one timestamp
    const oneShot = victim([[45.2, 400_000]], 45.2);
    expect(
      selectPressureWindows([oneShot], combatOf([oneShot], "3v3")).listed,
    ).toMatchObject([{ fromSeconds: 45.2, toSeconds: 45.2 }]);

    // …and at a Solo Shuffle round's end, on a unit that lived
    const survivor = victim([[45.05, 400_000]]);
    const other = makeUnit("f2", {
      name: "Other-Realm",
      info: {},
      deathRecords: [{ timestamp: at(45.6) }],
    });
    expect(
      selectPressureWindows(
        [survivor],
        combatOf([survivor, other], "Rated Solo Shuffle"),
      ).listed,
    ).toMatchObject([{ fromSeconds: 45.05, toSeconds: 45.6 }]);
  });

  it("spikeWindowOverlapSeconds: one second in every window whose printed span holds it, both ends included", () => {
    // inside a window; at its printed end (the reviewed case); at its start
    expect(spikeWindowOverlapSeconds(40, 60, 45.05, 45.6)).toBe(1);
    expect(spikeWindowOverlapSeconds(40, 45.6, 45.05, 45.6)).toBe(1);
    expect(spikeWindowOverlapSeconds(45.3, 60, 45.05, 45.6)).toBe(1);
    // a window that prints 0:45–0:45 itself
    expect(spikeWindowOverlapSeconds(45.1, 45.6, 45.05, 45.6)).toBe(1);
    // not a window that ended the second before, or opens the second after
    expect(spikeWindowOverlapSeconds(30, 44.9, 45.05, 45.6)).toBe(0);
    expect(spikeWindowOverlapSeconds(46, 60, 45.05, 45.6)).toBe(0);
    // a bucket WITH a length keeps the open far end: one starting in the
    // second the window ends still shares nothing with it
    expect(spikeWindowOverlapSeconds(40, 45.6, 45.05, 46.2)).toBe(0);
    expect(spikeWindowOverlapSeconds(40, 45.6, 44.9, 45.6)).toBe(1);
  });

  it("peakSpikePlacement agrees: in the window's last second it is inside — no `(lands after window)` on a credited spike", () => {
    expect(peakSpikePlacement(45.6, 45.05, 45.6)).toBe("inside");
    expect(peakSpikePlacement(60, 45.05, 45.6)).toBe("inside");
    expect(peakSpikePlacement(44.9, 45.05, 45.6)).toBe("after");
    // unchanged for a bucket with a length
    expect(peakSpikePlacement(45.6, 45.05, 55)).toBe("after");
    // wherever the overlap is positive the placement is not "after", and
    // the reverse — the two readings of one pair cannot disagree
    for (const wTo of [44, 45, 46, 50])
      for (const [sFrom, sTo] of [
        [45, 45],
        [45, 46],
        [44, 45],
        [46, 46],
        [40, 50],
      ] as const)
        expect(
          spikeWindowOverlapSeconds(30, wTo, sFrom, sTo) > 0,
          `window 30–${wTo}, spike ${sFrom}–${sTo}`,
        ).toBe(peakSpikePlacement(wTo, sFrom, sTo) !== "after");
  });

  it("creditSpikesToWindows: among the windows that hold it, the one that starts first", () => {
    const point = [{ fromSeconds: 45.05, toSeconds: 45.6 }];
    const A = { fromSeconds: 40, toSeconds: 45.6 };
    const B = { fromSeconds: 44, toSeconds: 60 };
    const C = { fromSeconds: 46, toSeconds: 60 };
    expect(creditSpikesToWindows([A], point)).toEqual([0]);
    expect(creditSpikesToWindows([B, A], point)).toEqual([1]);
    expect(creditSpikesToWindows([C], point)).toEqual([-1]);
    // beside a spike with a length: each is credited on its own
    expect(
      creditSpikesToWindows(
        [A, C],
        [...point, { fromSeconds: 47, toSeconds: 57 }],
      ),
    ).toEqual([0, 1]);
  });

  const LETHAL = DMG_SPIKE_THRESHOLD + 100_000; // 0.40M
  it("the header: a Solo Shuffle window cut at the round-ending death names the death second's spike (it said none was credited)", () => {
    expect(
      renderHeaders(
        [{ fromSeconds: 40, toSeconds: 60 }],
        [{ fromSeconds: 45.05, toSeconds: 45.6, totalDamage: LETHAL }],
        { bracket: "Rated Solo Shuffle", ownerDiedAtMs: 45_600 },
      ),
    ).toEqual([
      "0:40  [OFFENSIVE WINDOW]   0:40–0:45 | peak spike 0.40M on Mate (Enhancement Shaman) over 0:45–0:45 | CDs: Avatar@0:40",
    ]);
  });

  it("the header: in a 3v3 the window runs on past the death, and names the spike in its middle", () => {
    expect(
      renderHeaders(
        [{ fromSeconds: 40, toSeconds: 60 }],
        [{ fromSeconds: 45.05, toSeconds: 45.6, totalDamage: LETHAL }],
      ),
    ).toEqual([
      "0:40  [OFFENSIVE WINDOW]   0:40–1:00 | peak spike 0.40M on Mate (Enhancement Shaman) over 0:45–0:45 | CDs: Avatar@0:40",
    ]);
  });

  it("a larger spike with a length credited to the same window is still the peak", () => {
    expect(
      renderHeaders(
        [{ fromSeconds: 30, toSeconds: 60 }],
        [
          { fromSeconds: 45.05, toSeconds: 45.6, totalDamage: LETHAL },
          { fromSeconds: 32, toSeconds: 42, totalDamage: BIG },
        ],
        { bracket: "Rated Solo Shuffle", ownerDiedAtMs: 45_600 },
      ),
    ).toEqual([
      "0:30  [OFFENSIVE WINDOW]   0:30–0:45 | peak spike 1.90M on Mate (Enhancement Shaman) over 0:32–0:42 | CDs: Avatar@0:30",
    ]);
  });
});
