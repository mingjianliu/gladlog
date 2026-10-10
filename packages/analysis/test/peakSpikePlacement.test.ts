import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildMatchTimeline,
  BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import {
  creditSpikesToWindows,
  DMG_SPIKE_THRESHOLD,
  NO_CREDITED_SPIKE_CLAUSE,
  PEAK_SPIKE_MARKERS,
  peakSpikeMarker,
  peakSpikePlacement,
  spikeWindowOverlapSeconds,
} from "../src";

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

function renderHeaders(
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

  return buildMatchTimeline(params)
    .split("\n")
    .filter((l) => /^\d+:\d\d {2}\[OFFENSIVE WINDOW\]/.test(l));
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
