/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { specToString } from "../../src/utils/cooldowns";
import { IEnemyCDTimeline } from "../../src/utils/enemyCDs";
import {
  buildHealerOffenseSummary,
  computeSlackSegments,
  formatHealerOffenseForContext,
  HEALER_OFFENSE_FLAGS,
} from "../../src/utils/healerOffenseAnalysis";
import {
  makeAdvancedAction,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const T0 = 1_000_000; // match start ms

/** advancedActions giving a unit full HP for the whole match (samples every 5s for 120s). */
function fullHpActions(): unknown[] {
  const actions: unknown[] = [];
  for (let s = 0; s <= 120; s += 5)
    actions.push(makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, 500_000));
  return actions;
}

function makeFriend(
  id: string,
  overrides: Parameters<typeof makeUnit>[1] = {},
): ICombatUnit {
  return makeUnit(id, {
    reaction: CombatUnitReaction.Friendly,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    advancedActions: fullHpActions() as any[],
    ...overrides,
  });
}

function emptyEnemyTimeline(): IEnemyCDTimeline {
  return { players: [], alignedBurstWindows: [] };
}

const combat = { startTime: T0, endTime: T0 + 120_000 };

describe("computeSlackSegments", () => {
  it("returns one full-match slack segment when team is topped and nothing is active", () => {
    const owner = makeFriend("owner");
    const { advancedLoggingAvailable, segments } = computeSlackSegments(
      combat,
      owner,
      [owner],
      [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })],
      emptyEnemyTimeline(),
      [],
      [],
    );
    expect(advancedLoggingAvailable).toBe(true);
    expect(segments.length).toBe(1);
    expect(segments[0].fromSeconds).toBe(0);
    expect(segments[0].durationSeconds).toBeGreaterThanOrEqual(115);
    expect(segments[0].idle).toBe(true);
  });

  it("disables entirely when a friendly unit has no advancedActions", () => {
    const owner = makeFriend("owner");
    const mate = makeUnit("mate", { reaction: CombatUnitReaction.Friendly }); // no advancedActions
    const { advancedLoggingAvailable, segments } = computeSlackSegments(
      combat,
      owner,
      [owner, mate],
      [],
      emptyEnemyTimeline(),
      [],
      [],
    );
    expect(advancedLoggingAvailable).toBe(false);
    expect(segments).toEqual([]);
  });

  it("excludes seconds where a friendly is below 85% HP", () => {
    const owner = makeFriend("owner");
    // teammate drops to 60% HP from t=20s to t=40s (1s sample grid so the
    // nearest-sample HP reads have exact boundaries under the shared ±3s radius)
    const mateActions: unknown[] = [];
    for (let s = 0; s <= 120; s += 1) {
      const hp = s >= 20 && s < 40 ? 300_000 : 500_000;
      mateActions.push(makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, hp));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mate = makeUnit("mate", {
      reaction: CombatUnitReaction.Friendly,
      advancedActions: mateActions as any[],
    });
    const { segments } = computeSlackSegments(
      combat,
      owner,
      [owner, mate],
      [],
      emptyEnemyTimeline(),
      [],
      [],
    );
    // no segment may overlap [20, 40)
    for (const seg of segments) {
      expect(seg.toSeconds <= 20 || seg.fromSeconds >= 40).toBe(true);
    }
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("excludes seconds where an enemy offensive CD buff is active", () => {
    const owner = makeFriend("owner");
    const timeline: IEnemyCDTimeline = {
      alignedBurstWindows: [],
      players: [
        {
          playerName: "Enemy",
          specName: "Arms",
          offensiveCDs: [
            {
              spellId: "107574",
              spellName: "Avatar",
              castTimeSeconds: 30,
              cooldownSeconds: 90,
              availableAgainAtSeconds: 120,
              buffEndSeconds: 50,
            },
          ],
        },
      ],
    };
    const { segments } = computeSlackSegments(
      combat,
      owner,
      [owner],
      [],
      timeline,
      [],
      [],
    );
    for (const seg of segments) {
      expect(seg.toSeconds <= 30 || seg.fromSeconds >= 50).toBe(true);
    }
  });

  it("excludes seconds where the owner is CC-d and 3s after a speed-boost cast", () => {
    const owner = makeFriend("owner", {
      // Sprint-like: spells.json '2983' is type buffs_speed_boost
      spellCastEvents: [
        makeSpellCastEvent(
          "2983",
          T0 + 60_000,
          "owner",
          "Owner",
          "owner",
          "Owner",
        ),
      ],
    });
    const { segments } = computeSlackSegments(
      combat,
      owner,
      [owner],
      [],
      emptyEnemyTimeline(),
      [{ atSeconds: 10, durationSeconds: 6 }], // owner CC'd 10–16s
      [],
    );
    for (const seg of segments) {
      expect(seg.toSeconds <= 10 || seg.fromSeconds >= 16).toBe(true); // CC exclusion
      expect(seg.toSeconds <= 60 || seg.fromSeconds >= 63).toBe(true); // mobility exclusion
    }
  });

  it("drops segments shorter than 4s and fills owner activity counters", () => {
    // slack only in [50, 53) (3s) via HP dips elsewhere → no segment survives
    const mateActions: unknown[] = [];
    for (let s = 0; s <= 120; s += 1) {
      const hp = s >= 50 && s < 53 ? 500_000 : 300_000;
      mateActions.push(makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, hp));
    }
    const owner = makeFriend("owner");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mate = makeUnit("mate", {
      reaction: CombatUnitReaction.Friendly,
      advancedActions: mateActions as any[],
    });
    const { segments } = computeSlackSegments(
      combat,
      owner,
      [owner, mate],
      [],
      emptyEnemyTimeline(),
      [],
      [],
    );
    expect(segments).toEqual([]);
  });

  it("counts owner damage, CC casts, purges and kicks inside a segment (idle=false)", () => {
    const enemy = makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "118",
          T0 + 20_000,
          "enemy-1",
          "Enemy",
          "owner",
          "Owner",
        ), // Polymorph: type cc
        makeSpellCastEvent(
          "57994",
          T0 + 30_000,
          "enemy-1",
          "Enemy",
          "owner",
          "Owner",
        ), // Wind Shear: type interrupts
      ],
    });
    // makeUnit hardcodes damageOut: [] — assign after construction
    (owner as unknown as { damageOut: unknown[] }).damageOut = [
      {
        logLine: {
          event: LogEvent.SPELL_DAMAGE,
          timestamp: T0 + 25_000,
          parameters: [],
        },
        timestamp: T0 + 25_000,
        effectiveAmount: 50_000,
        amount: 50_000,
        srcUnitId: "owner",
        destUnitId: "enemy-1",
      },
    ];
    const { segments } = computeSlackSegments(
      combat,
      owner,
      [owner],
      [enemy],
      emptyEnemyTimeline(),
      [],
      [40], // one purge at t=40s
    );
    expect(segments.length).toBe(1);
    expect(segments[0].ownerDamage).toBe(50_000);
    expect(segments[0].ownerCCCasts).toBe(1);
    expect(segments[0].ownerKickCasts).toBe(1);
    expect(segments[0].ownerPurgeCasts).toBe(1);
    expect(segments[0].idle).toBe(false);
  });
});

// Task 2: Kill-window contribution analysis
import { computeWindowContributions } from "../../src/utils/healerOffenseAnalysis";
import {
  computeBurstSubWindows,
  IOffensiveWindow,
} from "../../src/utils/offensiveWindows";

function makeWindow(
  fromSeconds: number,
  toSeconds: number,
  bursts?: IOffensiveWindow["bursts"],
): IOffensiveWindow {
  return {
    targetUnitId: "enemy-1",
    targetName: "Edk",
    targetSpec: "Frost Death Knight",
    fromSeconds,
    toSeconds,
    durationSeconds: toSeconds - fromSeconds,
    friendlyDamageInWindow: 0,
    damageRatio: 1,
    capitalized: false,
    friendlyOffensives: [],
    // Default: one burst spanning the whole window, so existing expectations
    // (contribution span == window span, [KILL WINDOW] label) keep holding.
    bursts: bursts ?? [{ fromSeconds, toSeconds, damage: 50_000 }],
  };
}

describe("computeWindowContributions", () => {
  const enemyHealer = makeUnit("enemy-h", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Shaman_Restoration,
    name: "Rsham",
  });
  const enemyDk = makeUnit("enemy-1", {
    reaction: CombatUnitReaction.Hostile,
    name: "Edk",
  });

  it("reports ready CC with enemy healer DR, no cast, free time and team HP", () => {
    // owner cast Psychic Scream (8122, type cc, 40s CD per spellEffectData) at t=100s → it was ready at t=40s
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    const result = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk, enemyHealer],
      [makeWindow(40, 50)],
      [], // owner never CC'd
      [], // enemy healer has no incoming CC history → DR Full
    );
    expect(result.length).toBe(1);
    expect(result[0].enemyHealerName).toBe("Rsham");
    expect(result[0].enemyHealerSpec).toBe(
      specToString(CombatUnitSpec.Shaman_Restoration),
    );
    expect(result[0].enemyHealerSpec).not.toBe(
      String(CombatUnitSpec.Shaman_Restoration),
    );
    expect(result[0].ownerCCReady).toEqual([
      { spellName: "Psychic Scream", enemyHealerDR: "Full" },
    ]);
    expect(result[0].ownerCastCCInWindow).toBe(false);
    expect(result[0].ownerFreeSeconds).toBe(10);
    expect(result[0].teamMinHpPct).toBe(100);
  });

  it("flags CC as NOT ready when inside its cooldown, and detects an in-window cast", () => {
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 35_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ), // cast at 35s → on CD at 40s
      ],
    });
    const result = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk, enemyHealer],
      [makeWindow(40, 50)],
      [],
      [],
    );
    expect(result[0].ownerCCReady).toEqual([]); // 8122 on CD (35+40 > 40)
    expect(result[0].ownerCastCCInWindow).toBe(false);

    const result2 = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk, enemyHealer],
      [makeWindow(30, 40)],
      [],
      [],
    );
    expect(result2[0].ownerCastCCInWindow).toBe(true); // cast at 35s ∈ [30, 40)
  });

  it("subtracts owner CC time from ownerFreeSeconds and reports decayed DR", () => {
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    const result = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk, enemyHealer],
      [makeWindow(40, 50)],
      [{ atSeconds: 42, durationSeconds: 4 }], // owner feared 42–46
      // enemy healer feared at t=38 for 6s → same 'Disorient'-category DR window is still hot at 40
      [
        {
          atSeconds: 38,
          durationSeconds: 6,
          drInfo: { category: "Disorient", level: "Full", sequenceIndex: 0 },
        },
      ],
    );
    expect(result[0].ownerFreeSeconds).toBe(6);
    expect(result[0].ownerCCReady[0].enemyHealerDR).toBe("50%");
  });

  it("does not double-count ownerFreeSeconds when owner CC instances overlap", () => {
    const owner = makeFriend("owner");
    const result = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk, enemyHealer],
      [makeWindow(40, 50)],
      [
        { atSeconds: 42, durationSeconds: 4 }, // 42–46
        { atSeconds: 43, durationSeconds: 3 }, // 43–46, overlaps the above
      ],
      [],
    );
    // Union of CC'd seconds is still {42,43,44,45} = 4s, so ownerFreeSeconds is 6, not 10-(4+3)=3.
    expect(result[0].ownerFreeSeconds).toBe(6);
  });
});

// Task 3: Window-creation opportunity facts
import {
  computeWindowCreationFacts,
  ISlackSegment,
} from "../../src/utils/healerOffenseAnalysis";

function slackSeg(fromSeconds: number, toSeconds: number): ISlackSegment {
  return {
    fromSeconds,
    toSeconds,
    durationSeconds: toSeconds - fromSeconds,
    ownerDamage: 0,
    ownerCCCasts: 0,
    ownerPurgeCasts: 0,
    ownerKickCasts: 0,
    idle: true,
  };
}

describe("computeWindowCreationFacts", () => {
  const enemyHealerWithTrinketDown = makeUnit("enemy-h", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Shaman_Restoration,
    name: "Rsham",
    // trinket (336126) used at t=10s; healer trinket CD 90s → on CD until 100s
    spellCastEvents: [
      makeSpellCastEvent(
        "336126",
        T0 + 10_000,
        "enemy-h",
        "Rsham",
        "enemy-h",
        "Rsham",
      ),
    ],
  });

  it("emits a fact when CC ready + enemy healer DR Full + trinket on CD + no kill window overlapping", () => {
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    const facts = computeWindowCreationFacts(
      combat,
      owner,
      [enemyHealerWithTrinketDown],
      [slackSeg(40, 50)],
      [],
      [],
    );
    expect(facts.length).toBe(1);
    expect(facts[0].atSeconds).toBe(40);
    expect(facts[0].ccSpellName).toBe("Psychic Scream");
    expect(facts[0].enemyHealerDRLevel).toBe("Full");
    expect(facts[0].enemyHealerTrinketOnCD).toBe(true);
  });

  it("suppresses facts during an active kill window, at decayed DR, and caps at 2 by slack length", () => {
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 115_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    // overlapping kill window suppresses the 40–50 segment
    const suppressed = computeWindowCreationFacts(
      combat,
      owner,
      [enemyHealerWithTrinketDown],
      [slackSeg(40, 50)],
      [makeWindow(45, 55)],
      [],
    );
    expect(suppressed).toEqual([]);

    // decayed DR suppresses (verify getDRCategory('8122') and reuse the real category string)
    const decayed = computeWindowCreationFacts(
      combat,
      owner,
      [enemyHealerWithTrinketDown],
      [slackSeg(40, 50)],
      [],
      [
        {
          atSeconds: 38,
          durationSeconds: 6,
          drInfo: { category: "Disorient", level: "Full", sequenceIndex: 0 },
        },
      ],
    );
    expect(decayed).toEqual([]);

    // 3 candidate segments → capped at 2, longest first
    const capped = computeWindowCreationFacts(
      combat,
      owner,
      [enemyHealerWithTrinketDown],
      [slackSeg(20, 25), slackSeg(40, 52), slackSeg(60, 68)],
      [],
      [],
    );
    expect(capped.length).toBe(2);
    expect(capped[0].atSeconds).toBe(40); // 12s slack
    expect(capped[1].atSeconds).toBe(60); // 8s slack
  });

  it("returns [] when there is no enemy healer or the owner has no observed CC", () => {
    const owner = makeFriend("owner");
    expect(
      computeWindowCreationFacts(
        combat,
        owner,
        [enemyHealerWithTrinketDown],
        [slackSeg(40, 50)],
        [],
        [],
      ),
    ).toEqual([]);
    const ownerWithCC = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent("8122", T0 + 100_000, "x", "X", "owner", "Owner"),
      ],
    });
    expect(
      computeWindowCreationFacts(
        combat,
        ownerWithCC,
        [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })],
        [slackSeg(40, 50)],
        [],
        [],
      ),
    ).toEqual([]);
  });

  it("emits fact with null trinketOnCD when enemy healer has never cast trinket", () => {
    // Enemy healer with no trinket cast history (trinket state unknown)
    const enemyHealerNoTrinket = makeUnit("enemy-h", {
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Shaman_Restoration,
      name: "Rsham",
      spellCastEvents: [], // no trinket cast
    });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 115_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    const facts = computeWindowCreationFacts(
      combat,
      owner,
      [enemyHealerNoTrinket],
      [slackSeg(40, 50)],
      [],
      [],
    );
    expect(facts.length).toBe(1);
    expect(facts[0].atSeconds).toBe(40);
    expect(facts[0].enemyHealerTrinketOnCD).toBe(null);
    expect(facts[0].enemyHealerSpec).toBe(
      specToString(CombatUnitSpec.Shaman_Restoration),
    );
  });
});

// Task 4: Summary entry point + context formatter

describe("buildHealerOffenseSummary + formatHealerOffenseForContext", () => {
  it("returns an empty format block when advanced logging is missing", () => {
    const owner = makeUnit("owner", { reaction: CombatUnitReaction.Friendly }); // no advancedActions
    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner],
      [],
      [],
      emptyEnemyTimeline(),
      [],
      [],
      [],
    );
    expect(summary.advancedLoggingAvailable).toBe(false);
    expect(formatHealerOffenseForContext(summary)).toEqual([]);
  });

  it("renders header, aggregate slack line, idle segments, window and opportunity lines", () => {
    const enemyHealer = makeUnit("enemy-h", {
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Shaman_Restoration,
      name: "Rsham",
      spellCastEvents: [
        makeSpellCastEvent(
          "336126",
          T0 + 10_000,
          "enemy-h",
          "Rsham",
          "enemy-h",
          "Rsham",
        ),
      ],
    });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 115_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    // Enemy offensive CD from 40-50s (matching kill window) creates a gap in slack segments
    // This allows segment [50, 120) to exist without overlapping the kill window
    const enemyTimeline: IEnemyCDTimeline = {
      players: [
        {
          playerName: "Enemy DPS",
          specName: "Arms",
          offensiveCDs: [
            {
              spellId: "107574",
              spellName: "Avatar",
              castTimeSeconds: 40,
              cooldownSeconds: 90,
              availableAgainAtSeconds: 130,
              buffEndSeconds: 50,
            },
          ],
        },
      ],
      alignedBurstWindows: [],
    };
    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner],
      [enemyHealer],
      [makeWindow(40, 50)],
      enemyTimeline,
      [],
      [],
      [],
    );
    const lines = formatHealerOffenseForContext(summary);
    const text = lines.join("\n");
    expect(text).toContain("HEALER OFFENSE");
    expect(text).toContain("slack");
    expect(text).toContain("[KILL WINDOW]");
    expect(text).toContain("you cast no CC");
    expect(text).toContain("[OPPORTUNITY]");
    expect(text).toContain("opportunity, not a verdict");
    // Note trimmed 2026-07-09 (week-eval tokens.md #4): redundant guidance lives in the system
    // prompt; only the load-bearing "outranks" rule remains in the block.
    expect(text).toContain("healing under pressure always outranks offense");
  });
});

import { MAX_KILL_WINDOW_LINES } from "../../src/utils/healerOffenseAnalysis";

describe("burst sub-windows (2026-07-17 kill-window redesign)", () => {
  it("computeBurstSubWindows: splits on gaps, drops sub-threshold clusters, caps count, clamps to span", () => {
    const events = [
      // burst 1: 40k at t=10..12
      { t: 10, amount: 20_000 },
      { t: 12, amount: 20_000 },
      // gap > KW_BURST_GAP_S
      { t: 30, amount: 5_000 }, // lone dribble < KW_BURST_MIN_DAMAGE → dropped
      // burst 2: 100k at t=50..53
      { t: 50, amount: 60_000 },
      { t: 53, amount: 40_000 },
    ];
    const bursts = computeBurstSubWindows(events, 5, 60);
    expect(bursts.length).toBe(2);
    expect(bursts[0].damage).toBe(40_000);
    expect(bursts[1].damage).toBe(100_000);
    // chronological, padded ±0.5s, clamped inside [5, 60]
    expect(bursts[0].fromSeconds).toBeCloseTo(9.5);
    expect(bursts[0].toSeconds).toBeCloseTo(12.5);
    expect(bursts[1].fromSeconds).toBeCloseTo(49.5);
    expect(bursts[1].toSeconds).toBeCloseTo(53.5);
  });

  it("computeBurstSubWindows: single big hit gets a non-zero-width span", () => {
    const bursts = computeBurstSubWindows([{ t: 20, amount: 80_000 }], 0, 100);
    expect(bursts.length).toBe(1);
    expect(bursts[0].toSeconds - bursts[0].fromSeconds).toBeGreaterThanOrEqual(
      1.5,
    );
  });

  it("computeWindowContributions: one contribution per burst carrying the vuln span; empty bursts → unpunished full span", () => {
    const owner = makeFriend("owner", { spellCastEvents: [] });
    const enemyDk = makeUnit("enemy-1", {
      reaction: CombatUnitReaction.Hostile,
      name: "Edk",
    });
    const withBursts = makeWindow(40, 140, [
      { fromSeconds: 50, toSeconds: 55, damage: 90_000 },
      { fromSeconds: 100, toSeconds: 108, damage: 60_000 },
    ]);
    const punished = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk],
      [withBursts],
      [],
      [],
    );
    expect(punished.length).toBe(2);
    expect(punished[0]).toMatchObject({
      fromSeconds: 50,
      toSeconds: 55,
      vulnFromSeconds: 40,
      vulnToSeconds: 140,
      unpunished: false,
    });
    expect(punished[1].fromSeconds).toBe(100);

    const unpunished = computeWindowContributions(
      combat,
      owner,
      [owner],
      [enemyDk],
      [makeWindow(40, 140, [])],
      [],
      [],
    );
    expect(unpunished.length).toBe(1);
    expect(unpunished[0]).toMatchObject({
      fromSeconds: 40,
      toSeconds: 140,
      unpunished: true,
    });
  });

  it("format: bursts render [KILL WINDOW] with the defenseless span note; unpunished renders [VULNERABLE] never punished", () => {
    const base = {
      targetName: "Edk",
      targetSpec: "Frost Death Knight",
      enemyHealerName: "Rsham",
      enemyHealerSpec: "Restoration Shaman",
      ownerCCReady: [],
      ownerCastCCInWindow: false,
      ownerDamageInWindow: 12_000,
      ownerFreeSeconds: 5,
      teamMinHpPct: 80,
    };
    const summary = {
      advancedLoggingAvailable: true,
      slackSegments: [],
      windowContributions: [
        {
          ...base,
          fromSeconds: 50,
          toSeconds: 55,
          vulnFromSeconds: 40,
          vulnToSeconds: 140,
          unpunished: false,
          teamDamageInVulnSpan: 90_000,
        },
        {
          ...base,
          fromSeconds: 200,
          toSeconds: 260,
          vulnFromSeconds: 200,
          vulnToSeconds: 260,
          unpunished: true,
          teamDamageInVulnSpan: 8_000,
        },
      ],
      windowCreationFacts: [],
      contestedTradeFacts: [],
    };
    const text = formatHealerOffenseForContext(summary).join("\n");
    expect(text).toContain(
      "[KILL WINDOW] 0:50–0:55 on Frost Death Knight (Edk)",
    );
    expect(text).toContain("target defenseless 0:40–2:20");
    expect(text).toContain(
      "[VULNERABLE] 3:20–4:20 (60s) on Frost Death Knight (Edk): no major defensives, never punished (team damage 8k total)",
    );
  });
});

describe("formatHealerOffenseForContext KILL WINDOW cap", () => {
  function synthWindow(i: number, freeSeconds: number) {
    return {
      fromSeconds: i * 20,
      toSeconds: i * 20 + 10,
      vulnFromSeconds: i * 20,
      vulnToSeconds: i * 20 + 10,
      unpunished: false,
      teamDamageInVulnSpan: 50_000,
      targetName: `Enemy${i}`,
      targetSpec: "Frost Death Knight",
      enemyHealerName: "Rsham",
      enemyHealerSpec: "Restoration Shaman",
      ownerCCReady: [],
      ownerCastCCInWindow: i % 2 === 0,
      ownerDamageInWindow: 1000 * i,
      ownerFreeSeconds: freeSeconds,
      teamMinHpPct: 95,
    };
  }

  it("caps [KILL WINDOW] lines at MAX_KILL_WINDOW_LINES, keeps most-free windows chronologically, rolls up the rest", () => {
    const n = MAX_KILL_WINDOW_LINES + 3;
    // Free time increases with index, so the FIRST 3 windows (least free) get omitted.
    const summary = {
      advancedLoggingAvailable: true,
      slackSegments: [],
      windowContributions: Array.from({ length: n }, (_, i) =>
        synthWindow(i, i + 1),
      ),
      windowCreationFacts: [],
      contestedTradeFacts: [],
    };
    const text = formatHealerOffenseForContext(summary).join("\n");
    const killLines = (text.match(/\[KILL WINDOW\]/g) ?? []).length;
    expect(killLines).toBe(MAX_KILL_WINDOW_LINES);
    // Omitted = windows 0..2 (least free); shown windows keep chronological order.
    expect(text).toContain(`[+3 more windows omitted`);
    expect(text).not.toContain("(Enemy0)");
    expect(text).not.toContain("(Enemy1):");
    expect(text).toContain("(Enemy3)");
    const idxA = text.indexOf("(Enemy3)");
    const idxB = text.indexOf(`(Enemy${n - 1})`);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
    // Rollup aggregates: damage of omitted 0+1+2 = 3k, CC cast in windows 0 and 2 => 2 of 3
    expect(text).toContain("your damage 3k total, CC cast in 2 of 3");
  });

  it("leaves blocks at or under the cap untouched", () => {
    const summary = {
      advancedLoggingAvailable: true,
      slackSegments: [],
      windowContributions: Array.from(
        { length: MAX_KILL_WINDOW_LINES },
        (_, i) => synthWindow(i, i + 1),
      ),
      windowCreationFacts: [],
      contestedTradeFacts: [],
    };
    const text = formatHealerOffenseForContext(summary).join("\n");
    expect((text.match(/\[KILL WINDOW\]/g) ?? []).length).toBe(
      MAX_KILL_WINDOW_LINES,
    );
    expect(text).not.toContain("more windows omitted");
  });
});

describe("F193 V2 — contested trade facts", () => {
  const enemyHealer = makeUnit("enemy-h", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Shaman_Restoration,
    name: "Rsham",
  });

  it("1. emits fact and contains [CONTESTED] and EV framing when team is at 75% HP and CC is ready at Full DR", () => {
    const partialHpActions = [];
    for (let s = 0; s <= 120; s += 5) {
      partialHpActions.push(
        makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, 375_000),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mate = makeFriend("mate", {
      advancedActions: partialHpActions as any[],
    });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });
    // Add an enemy with an interrupt to test enemyInterruptsReady count
    const enemyWarrior = makeUnit("enemy-w", {
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Warrior,
      name: "Ewar",
    });

    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner, mate],
      [enemyHealer, enemyWarrior],
      [],
      emptyEnemyTimeline(),
      [],
      [],
      [],
    );

    expect(summary.advancedLoggingAvailable).toBe(true);
    expect(summary.contestedTradeFacts.length).toBe(1);
    const fact = summary.contestedTradeFacts[0];
    expect(fact.teamMinHpPct).toBe(75);
    expect(fact.ccSpellName).toBe("Psychic Scream");
    expect(fact.enemyHealerTrinket).toBe("unknown"); // trinket never used/observed
    expect(fact.enemyInterruptsReady).toBe(1); // Warrior interrupt is ready

    const lines = formatHealerOffenseForContext(summary);
    const text = lines.join("\n");
    expect(text).toContain("[CONTESTED]");
    expect(text).toContain("EV question, not a verdict");
  });

  it("2. emits no facts when team is at 60% HP (below the band)", () => {
    const partialHpActions = [];
    for (let s = 0; s <= 120; s += 5) {
      partialHpActions.push(
        makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, 300_000),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mate = makeFriend("mate", {
      advancedActions: partialHpActions as any[],
    });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });

    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner, mate],
      [enemyHealer],
      [],
      emptyEnemyTimeline(),
      [],
      [],
      [],
    );

    expect(summary.contestedTradeFacts.length).toBe(0);
  });

  it("3. emits no facts when enemy healer DR level is not Full at segment start", () => {
    const partialHpActions = [];
    for (let s = 0; s <= 120; s += 5) {
      partialHpActions.push(
        makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, 375_000),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mate = makeFriend("mate", {
      advancedActions: partialHpActions as any[],
    });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });

    // Enemy healer has been CC'd recently, so DR is not Full (e.g. 50%)
    const enemyHealerCCInstances = [
      {
        atSeconds: -2,
        durationSeconds: 6,
        drInfo: { category: "Disorient", level: "Full", sequenceIndex: 0 },
      },
    ];

    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner, mate],
      [enemyHealer],
      [],
      emptyEnemyTimeline(),
      [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enemyHealerCCInstances as any[],
      [],
    );

    expect(summary.contestedTradeFacts.length).toBe(0);
  });

  it("4. emits no contested facts or [CONTESTED] formatted line when flag is disabled", () => {
    const partialHpActions = [];
    for (let s = 0; s <= 120; s += 5) {
      partialHpActions.push(
        makeAdvancedAction(T0 + s * 1000, 0, 0, 500_000, 375_000),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mate = makeFriend("mate", {
      advancedActions: partialHpActions as any[],
    });
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });

    HEALER_OFFENSE_FLAGS.V2_CONTESTED_TRADES = false;
    try {
      const summary = buildHealerOffenseSummary(
        combat,
        owner,
        [owner, mate],
        [enemyHealer],
        [],
        emptyEnemyTimeline(),
        [],
        [],
        [],
      );

      expect(summary.contestedTradeFacts.length).toBe(0);
      const lines = formatHealerOffenseForContext(summary);
      const text = lines.join("\n");
      expect(text).not.toContain("[CONTESTED]");
    } finally {
      HEALER_OFFENSE_FLAGS.V2_CONTESTED_TRADES = true;
    }
  });

  it("5. does not eat slack when all friends are at 100% HP (contested segments empty)", () => {
    // Both owner and mate at 100% HP (covered by slack)
    const mate = makeFriend("mate");
    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 100_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });

    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner, mate],
      [enemyHealer],
      [],
      emptyEnemyTimeline(),
      [],
      [],
      [],
    );

    // slackSegments should have the full-match slack segment, contestedTradeFacts should be empty
    expect(summary.slackSegments.length).toBe(1);
    expect(summary.contestedTradeFacts.length).toBe(0);
  });

  it("covers contested segment early endings, damage/healing in contested segments, damage in windows, and multi-CC formatting", () => {
    // mate at 80% HP (contested band) from t=10s to t<25s, full HP otherwise.
    // 1s sample grid: the shared ±3s nearest-sample HP reader (B4 fix) no longer
    // back-fills sparse gaps, so the contested window must be actually sampled.
    const mateActions: unknown[] = [];
    for (let s = 0; s <= 120; s += 1) {
      const hp = s >= 10 && s < 25 ? 160_000 : 200_000;
      mateActions.push(makeAdvancedAction(T0 + s * 1000, 0, 0, 200_000, hp));
    }
    const mate = makeFriend("mate", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      advancedActions: mateActions as any[],
    });

    const enemy = makeUnit("enemy-1", {
      reaction: CombatUnitReaction.Hostile,
      name: "Edk",
    });

    const enemyHealer = makeUnit("enemy-h", {
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Shaman_Restoration,
      name: "Rsham",
      spellCastEvents: [
        makeSpellCastEvent(
          "336126",
          T0 + 5000,
          "enemy-h",
          "Rsham",
          "enemy-h",
          "Rsham",
        ),
      ],
    });

    const owner = makeFriend("owner", {
      spellCastEvents: [
        makeSpellCastEvent(
          "8122",
          T0 + 50_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
        makeSpellCastEvent(
          "118",
          T0 + 60_000,
          "enemy-h",
          "Rsham",
          "owner",
          "Owner",
        ),
      ],
    });

    (owner as any).damageOut = [
      {
        logLine: {
          event: LogEvent.SPELL_DAMAGE,
          timestamp: T0 + 15_000,
          parameters: [],
        },
        timestamp: T0 + 15_000,
        effectiveAmount: 10_000,
        amount: 10_000,
        srcUnitId: "owner",
        destUnitId: "enemy-1",
      },
      {
        logLine: {
          event: LogEvent.SPELL_DAMAGE,
          timestamp: T0 + 32_000,
          parameters: [],
        },
        timestamp: T0 + 32_000,
        effectiveAmount: 30_000,
        amount: 30_000,
        srcUnitId: "owner",
        destUnitId: "enemy-1",
      },
    ];
    (owner as any).healOut = [
      {
        logLine: {
          event: LogEvent.SPELL_HEAL,
          timestamp: T0 + 20_000,
          parameters: [],
        },
        timestamp: T0 + 20_000,
        effectiveAmount: 20_000,
        amount: 20_000,
        srcUnitId: "owner",
        destUnitId: "mate",
      },
    ];

    const summary = buildHealerOffenseSummary(
      combat,
      owner,
      [owner, mate],
      [enemy, enemyHealer],
      [makeWindow(30, 36)],
      emptyEnemyTimeline(),
      [],
      [],
      [],
    );

    expect(summary.contestedTradeFacts.length).toBe(1);
    expect(summary.contestedTradeFacts[0].ownerHealing).toBe(20_000);
    expect(summary.windowContributions[0].ownerDamageInWindow).toBe(30_000);

    const lines = formatHealerOffenseForContext(summary);
    const text = lines.join("\n");
    expect(text).toContain("your CC ready:");
  });
});
