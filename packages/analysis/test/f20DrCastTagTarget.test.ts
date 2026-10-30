import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  buildMatchTimeline,
  type BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import type { IOutgoingCCChain } from "../src/utils/drAnalysis";

// F20 residual (dr, 9fa2e09d r2 2:07): the `[YOU] [CC]` line's `[DR: …]`
// tag is the DR of this press's landing on a unit the line names — Mortal
// Coil → 6(HPaladin) printed the 50 % of the coil's other target (landed
// 127.573, the press second); the paladin's own landing (128.092) is Full.

const MORTAL_COIL = "6789";
const END_MS = 120_000;

function mkUnit(
  id: string,
  name: string,
  overrides: Partial<ICombatUnit> = {},
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Friendly,
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
    ...overrides,
  };
}
const NAME: Record<string, string> = {
  o: "Me-Realm",
  m: "Mate-Realm",
  e: "Enemy-Realm",
  e2: "Other-Realm",
  pet: "Felhunter",
};
function timelineOf(opts: {
  owner?: Partial<ICombatUnit>;
  mate?: Partial<ICombatUnit>;
  enemy?: Partial<ICombatUnit>;
  enemy2?: Partial<ICombatUnit>;
  isHealer?: boolean;
  ownerCDs?: BuildMatchTimelineParams["ownerCDs"];
  enemyCCSummaries?: unknown;
  outgoingCCChains?: IOutgoingCCChain[];
}): string[] {
  const owner = mkUnit("o", NAME.o!, opts.owner);
  const mate = mkUnit("m", NAME.m!, opts.mate);
  const enemy = mkUnit("e", NAME.e!, {
    reaction: CombatUnitReaction.Hostile,
    ...opts.enemy,
  });
  const enemy2 = mkUnit("e2", NAME.e2!, {
    reaction: CombatUnitReaction.Hostile,
    ...opts.enemy2,
  });
  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Mage_Frost",
    ownerCDs: opts.ownerCDs ?? [],
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
    enemyCCSummaries: opts.enemyCCSummaries as never,
    outgoingCCChains: opts.outgoingCCChains,
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy, enemy2],
    allUnits: [owner, mate, enemy, enemy2],
    matchStartMs: 0,
    matchEndMs: END_MS,
    isHealer: opts.isHealer ?? false,
    criticalWindowSeconds: new Set<number>(),
  };
  return buildMatchTimeline(params).split("\n");
}

beforeAll(async () => {
  await ensureAnalysisData();
});

const app = (atSeconds: number, level: "Full" | "50%") => ({
  atSeconds,
  durationSeconds: 3,
  spellId: MORTAL_COIL,
  spellName: "Mortal Coil",
  casterName: NAME.o!,
  casterSpec: "Warlock_Destruction",
  drInfo: {
    category: "Incapacitate",
    level,
    sequenceIndex: level === "Full" ? 0 : 1,
  },
});
const coilLine = (targetName: string, chains: IOutgoingCCChain[]) =>
  timelineOf({
    ownerCDs: [
      {
        spellId: MORTAL_COIL,
        spellName: "Mortal Coil",
        tag: "CC",
        cooldownSeconds: 45,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 27.108, targetName }],
        availableWindows: [],
        neverUsed: false,
      },
    ] as never,
    outgoingCCChains: chains,
  }).filter((l) => l.includes("[YOU] [CC]"));

describe("F20 residual — the [YOU] [CC] DR tag reads the units the line names", () => {
  const chains = [
    {
      targetName: NAME.e!,
      targetSpec: "",
      applications: [app(28.092, "Full")],
    },
    {
      targetName: NAME.e2!,
      targetSpec: "",
      applications: [app(27.573, "50%")],
    },
  ] as IOutgoingCCChain[];
  it("the named unit's landing after the press second, not another unit's in it", () => {
    const l = coilLine(NAME.e!, chains);
    expect(l).toHaveLength(1);
    expect(l[0]).toContain("[DR: Incapacitate Full]");
    expect(l[0]).not.toContain("50%");
  });
  it("no tag when the named unit has no landing of this press", () => {
    const l = coilLine(NAME.e!, [chains[1]!]);
    expect(l).toHaveLength(1);
    expect(l[0]).not.toContain("[DR:");
  });
  it("the named unit's landing in the press second keeps its tag", () => {
    const l = coilLine(NAME.e2!, chains);
    expect(l).toHaveLength(1);
    expect(l[0]).toContain("[DR: Incapacitate 50%]");
  });
});
