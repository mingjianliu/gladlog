/**
 * A proc-only cooldown's activation is a timeline FACT, never a press
 * (reliability round 3 N5, matches 02c8 / ba8c / 3306, 2026-09-26): Renewing
 * Blaze 374348 has no cast line by design (aura 374349 is the only evidence),
 * the loadout already says [PASSIVE], yet the owner / teammate cooldown loops
 * iterated the ledger's activations as `[YOU] [CD]` presses — with "cheaper
 * available: Time Dilation", "[while stunned: …]" and a defensive-timing
 * label attached to something nobody pressed.
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  annotateDefensiveTimings,
  cdIsProcOnly,
  extractMajorCooldowns,
  findCheaperDefensiveAlternatives,
} from "../src/utils/cooldowns";
import { formatSpecBaselines } from "../src/utils/specBaselines";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const RB = "374348";
const RB_AURA = "374349";

function combatOf(...units: ICombatUnit[]): AtomicArenaCombat {
  return {
    startTime: 0,
    endTime: 120_000,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
  } as unknown as AtomicArenaCombat;
}

function evoker(id: string, name: string, procAtMs: number) {
  return makeUnit(id, {
    name,
    class: CombatUnitClass.Evoker,
    spec: CombatUnitSpec.Evoker_Preservation,
    spellCastEvents: [],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        RB_AURA,
        procAtMs,
        id,
        id,
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        RB_AURA,
        procAtMs + 8_000,
        id,
        id,
        "BUFF",
      ),
    ],
  });
}

const baseTimelineParams = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ccTrinketSummaries: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispelSummary: {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enemyDispelSummary: {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enemyCCSummaries: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  friendlyDeaths: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enemyDeaths: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pressureWindows: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  healingGaps: [] as any[],
  enemies: [] as ICombatUnit[],
  matchStartMs: 0,
  matchEndMs: 120_000,
  isHealer: true,
  criticalWindowSeconds: new Set<number>(),
};

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("proc-only activations render as [PROC], never as a press", () => {
  it("owner: the ledger holds the activation, the timeline says [YOU] [PROC] with no press annotations", () => {
    const owner = evoker("player-1", "Heal-Evoker", 25_000);
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    const rb = cds.find((c) => c.spellId === RB);
    expect(
      rb,
      "Renewing Blaze enters the ledger through its aura",
    ).toBeDefined();
    expect(cdIsProcOnly(rb!)).toBe(true);
    expect(rb!.casts).toHaveLength(1);

    const timeline = buildMatchTimeline({
      ...baseTimelineParams,
      owner,
      ownerSpec: "Preservation Evoker",
      ownerCDs: cds,
      teammateCDs: [],
      friends: [owner],
    });
    const lines = timeline.split("\n");
    const procLines = lines.filter((l) =>
      /\[YOU\] \[PROC\]\s+Renewing Blaze/.test(l),
    );
    expect(procLines).toHaveLength(1);
    expect(procLines[0]).toContain("0:25  [YOU] [PROC]   Renewing Blaze");
    expect(procLines[0]).not.toContain("cheaper available");
    expect(procLines[0]).not.toContain("[UNNECESSARY");
    expect(lines.some((l) => /\[YOU\] \[CD\]\s+Renewing Blaze/.test(l))).toBe(
      false,
    );
    expect(timeline).toContain("[PROC] = an automatically applied effect");
  });

  it("teammate: [TEAM] [PROC], not [TEAM] [CD]", () => {
    const owner = evoker("player-1", "Heal-Evoker", 25_000);
    const mate = evoker("player-2", "Mate-Evoker", 40_000);
    const combat = combatOf(owner, mate);
    const ownerCds = extractMajorCooldowns(owner, combat);
    const mateCds = extractMajorCooldowns(mate, combat);
    const timeline = buildMatchTimeline({
      ...baseTimelineParams,
      owner,
      ownerSpec: "Preservation Evoker",
      ownerCDs: ownerCds,
      teammateCDs: [
        { player: mate, spec: "Preservation Evoker", cds: mateCds },
      ],
      friends: [owner, mate],
    });
    const lines = timeline.split("\n");
    expect(
      lines.filter((l) => /\[TEAM\] \[PROC\]\s+.*Renewing Blaze/.test(l)),
    ).toHaveLength(1);
    expect(
      lines.some((l) => /\[TEAM\] \[CD\]\s+.*Renewing Blaze/.test(l)),
    ).toBe(false);
  });

  it("annotateDefensiveTimings never labels a proc activation; no cheaper alternative is offered for it", () => {
    const owner = evoker("player-1", "Heal-Evoker", 25_000);
    const combat = combatOf(owner);
    const cds = extractMajorCooldowns(owner, combat);
    const annotated = annotateDefensiveTimings(cds, owner, combat, {
      players: [],
      alignedBurstWindows: [{ fromSeconds: 20, toSeconds: 30 }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const rb = annotated.find((c) => c.spellId === RB)!;
    expect(rb.casts[0]!.timingLabel).toBeUndefined();
    expect(findCheaperDefensiveAlternatives(rb, cds, 25)).toEqual([]);
  });

  it("SPEC BASELINES drops proc-only rows — the table promises first-USE timing", () => {
    const owner = evoker("player-1", "Heal-Evoker", 25_000);
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    const lines = formatSpecBaselines("Preservation Evoker", cds, {
      bySpec: {
        "Preservation Evoker": {
          sampleCount: 10,
          defensiveTiming: null,
          cdUsage: {
            "Renewing Blaze": {
              neverUsedRate: 0.22,
              medianFirstUseSeconds: 26,
              p75FirstUseSeconds: 54,
            },
            "Obsidian Scales": {
              neverUsedRate: 0.22,
              medianFirstUseSeconds: 25,
              p75FirstUseSeconds: 52,
            },
          },
        },
      },
    });
    const joined = lines.join("\n");
    expect(joined).not.toContain("Renewing Blaze");
    expect(cds.some((c) => c.spellName === "Obsidian Scales")).toBe(true);
    expect(joined).toContain("Obsidian Scales");
  });
});
