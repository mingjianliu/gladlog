/**
 * GH #99 item 1: Lay on Hands double spell id (633 and 471195) deduplication.
 * Pins:
 * 1. A Holy Paladin kit contains Lay on Hands exactly once across all talent/cast states.
 * 2. A cast of Lay on Hands under either id (471195 or 633) yields exactly one [YOU] [CD] line.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  extractMajorCooldowns,
  FORBEARANCE_GATED_IDS,
  SPELL_CANONICAL_IDS,
  spellAliasIds,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

function combatOf(owner: ICombatUnit): AtomicArenaCombat {
  return {
    startTime: 0,
    endTime: 120_000,
    units: { [owner.id]: owner },
  } as unknown as AtomicArenaCombat;
}

const baseTimelineParams = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ccTrinketSummaries: [] as any[],
  dispelSummary: {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  enemyDispelSummary: {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

describe("GH #99 — Lay on Hands kit deduplication and timeline rendering", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("every alias of a Forbearance-gated id is itself gated (the kit entry may carry any alias)", () => {
    for (const id of FORBEARANCE_GATED_IDS) {
      for (const alias of spellAliasIds(id)) {
        expect(
          FORBEARANCE_GATED_IDS.has(alias),
          `alias ${alias} of ${id}`,
        ).toBe(true);
      }
    }
    // The concrete case that regressed on 2026-09-16 (2/309 prompts).
    expect(SPELL_CANONICAL_IDS["633"]).toBe("471195");
    expect(FORBEARANCE_GATED_IDS.has("471195")).toBe(true);
  });

  it("Holy Paladin kit contains Lay on Hands exactly once when talented (633) and cast under 12.x id (471195)", () => {
    const owner = makeUnit("player-1", {
      name: "HealerPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: {
        talents: [{ id1: 81597, id2: 0, count: 1 }],
      },
      spellCastEvents: [
        makeSpellCastEvent("471195", 30_000, "player-1", "player-1"),
      ],
    });
    const combat = combatOf(owner);
    const cds = extractMajorCooldowns(owner, combat);
    const loh = cds.filter((c) => c.spellName === "Lay on Hands");
    expect(loh).toHaveLength(1);
    expect(loh[0].spellId).toBe("471195");
    expect(loh[0].neverUsed).toBe(false);
    expect(loh[0].casts).toHaveLength(1);
  });

  it("Holy Paladin kit contains Lay on Hands exactly once when talented (633) and uncast", () => {
    const owner = makeUnit("player-1", {
      name: "HealerPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: {
        talents: [{ id1: 81597, id2: 0, count: 1 }],
      },
      spellCastEvents: [],
    });
    const combat = combatOf(owner);
    const cds = extractMajorCooldowns(owner, combat);
    const loh = cds.filter((c) => c.spellName === "Lay on Hands");
    expect(loh).toHaveLength(1);
    expect(loh[0].neverUsed).toBe(true);
    expect(loh[0].casts).toHaveLength(0);
  });

  it("a cast of Lay on Hands under 471195 yields exactly one [YOU] [CD] line", () => {
    const owner = makeUnit("player-1", {
      name: "HealerPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: {
        talents: [{ id1: 81597, id2: 0, count: 1 }],
      },
      spellCastEvents: [
        makeSpellCastEvent("471195", 30_000, "player-1", "player-1"),
      ],
    });
    const combat = combatOf(owner);
    const cds = extractMajorCooldowns(owner, combat);
    expect(cds.filter((c) => c.spellName === "Lay on Hands")).toHaveLength(1);

    const timeline = buildMatchTimeline({
      ...baseTimelineParams,
      owner,
      ownerSpec: "Holy Paladin",
      ownerCDs: cds,
      teammateCDs: [],
      friends: [owner],
    });

    const lohLines = timeline
      .split("\n")
      .filter((l) => /\[YOU\] \[CD\]\s+Lay on Hands/.test(l));
    expect(lohLines).toHaveLength(1);
    expect(lohLines[0]).toContain("0:30  [YOU] [CD]   Lay on Hands");
  });

  it("a cast of Lay on Hands under 633 yields exactly one [YOU] [CD] line", () => {
    const owner = makeUnit("player-1", {
      name: "HealerPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: {
        talents: [{ id1: 81597, id2: 0, count: 1 }],
      },
      spellCastEvents: [
        makeSpellCastEvent("633", 30_000, "player-1", "player-1"),
      ],
    });
    const combat = combatOf(owner);
    const cds = extractMajorCooldowns(owner, combat);
    expect(cds.filter((c) => c.spellName === "Lay on Hands")).toHaveLength(1);

    const timeline = buildMatchTimeline({
      ...baseTimelineParams,
      owner,
      ownerSpec: "Holy Paladin",
      ownerCDs: cds,
      teammateCDs: [],
      friends: [owner],
    });

    const lohLines = timeline
      .split("\n")
      .filter((l) => /\[YOU\] \[CD\]\s+Lay on Hands/.test(l));
    expect(lohLines).toHaveLength(1);
    expect(lohLines[0]).toContain("0:30  [YOU] [CD]   Lay on Hands");
  });
});
