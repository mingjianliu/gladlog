import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

/**
 * `[CC BROKEN]` (BACKLOG #36(e)): our damage breaking CC our side had landed.
 * `analyzeCcBreaks` carried the full attribution since 2026-08-02 — the log's
 * own ground truth, SPELL_AURA_BROKEN_SPELL's src IS the breaker — but only the
 * desktop dashboard consumed it. The prompt showed the CC landing and then
 * silently ending, so the model could not tell "the sheep ran its course" from
 * "your teammate cleaved it".
 */

const MATCH_START_MS = 0;
const MATCH_END_MS = 120_000;

function mkUnit(
  id: string,
  name: string,
  reaction: CombatUnitReaction,
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
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

function paramsWith(
  ccBreakEvents: BuildMatchTimelineParams["ccBreakEvents"],
): BuildMatchTimelineParams {
  const owner = mkUnit("o", "Me-Realm", CombatUnitReaction.Friendly);
  const mate = mkUnit("m", "Mate-Realm", CombatUnitReaction.Friendly);
  const enemy = mkUnit("e", "Enemy-Realm", CombatUnitReaction.Hostile);
  return {
    owner,
    ownerSpec: "Mage_Frost",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
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
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy],
    matchStartMs: MATCH_START_MS,
    matchEndMs: MATCH_END_MS,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
    ccBreakEvents,
  };
}

const breakEvent = (remainingSeconds: number | null) => ({
  atSeconds: 42,
  ccSpellId: "118",
  ccSpellName: "Polymorph",
  holderName: "Enemy-Realm",
  holderIsFriendly: false,
  casterName: "Me-Realm",
  breakerName: "Mate-Realm",
  breakerIsFriendly: true,
  breakSpellId: "1464",
  breakSpellName: "Slam",
  heldSeconds: 1.8,
  remainingSeconds,
  isRoot: false,
});

describe("[CC BROKEN] — squandered CC reaches the prompt", () => {
  it("renders breaker, break spell, CC, holder and the wasted time", () => {
    const timeline = buildMatchTimeline(paramsWith([breakEvent(3.2)]));
    const line = timeline.split("\n").find((l) => l.includes("[CC BROKEN]"));
    expect(line).toBeDefined();
    expect(line).toContain("Slam");
    expect(line).toContain("Polymorph");
    expect(line).toContain("3.2s of CC wasted");
  });

  it("unknown remaining time renders without a fabricated number", () => {
    const timeline = buildMatchTimeline(paramsWith([breakEvent(null)]));
    const line = timeline.split("\n").find((l) => l.includes("[CC BROKEN]"));
    expect(line).toBeDefined();
    expect(line).not.toContain("wasted");
  });

  it("no events → no section", () => {
    const timeline = buildMatchTimeline(paramsWith([]));
    expect(timeline).not.toContain("[CC BROKEN]");
  });

  // FT leftovers 2026-10-11: the roster's id maps answer to a name with and
  // without its realm, the spec tag answered to the full name only — and a
  // pet's break was rendered through `breakerName` ("Owner-Realm(宠物)"),
  // which read as the owner, bare: `2's Kill Command` (430 lines / 605 files).
  describe("the breaker's label", () => {
    const withIds = (
      ev: ReturnType<typeof breakEvent> & {
        breakerUnitId?: string;
        breakerUnitName?: string;
      },
    ): BuildMatchTimelineParams => {
      const p = paramsWith([ev]);
      // a hunter pet that carries its owner's character name
      const pet = {
        ...mkUnit("Pet-0-1-2-3-4-5", "Mate", CombatUnitReaction.Friendly),
        type: CombatUnitType.Pet,
        ownerId: "m",
      };
      return {
        ...p,
        allUnits: [...p.friends, ...(p.enemies ?? []), pet],
        playerIdMap: new Map([
          ["Me-Realm", 1],
          ["Me", 1],
          ["Mate-Realm", 2],
          ["Mate", 2],
        ]),
        enemyIdMap: new Map([
          ["Enemy-Realm", 4],
          ["Enemy", 4],
        ]),
      };
    };
    const lineOf = (p: BuildMatchTimelineParams) =>
      buildMatchTimeline(p)
        .split("\n")
        .find((l) => l.includes("[CC BROKEN]"));

    it("a player breaker carries the spec tag", () => {
      expect(lineOf(withIds(breakEvent(3.2)))).toContain(
        "[CC BROKEN]   2(FMage)'s Slam broke own team's Polymorph on 4(FMage)",
      );
    });

    it("a name the id map only knows without its realm is still tagged", () => {
      expect(
        lineOf(withIds({ ...breakEvent(3.2), breakerName: "Mate" })),
      ).toContain("[CC BROKEN]   2(FMage)'s Slam");
    });

    it("a pet's break is the pet's — also when the pet is named like its owner", () => {
      const line = lineOf(
        withIds({
          ...breakEvent(3.2),
          breakerName: "Mate-Realm(宠物)",
          breakerUnitId: "Pet-0-1-2-3-4-5",
          breakerUnitName: "Mate",
          breakSpellName: "Kill Command",
        }),
      );
      expect(line).toContain("[CC BROKEN]   2(FMage)'s pet's Kill Command");
    });

    it("no line carries a bare roster id", () => {
      for (const ev of [
        breakEvent(3.2),
        { ...breakEvent(3.2), breakerName: "Mate" },
        { ...breakEvent(3.2), breakerName: "Mate-Realm(宠物)" },
      ])
        expect(lineOf(withIds(ev))).not.toMatch(/\b\d's /);
    });
  });
});
