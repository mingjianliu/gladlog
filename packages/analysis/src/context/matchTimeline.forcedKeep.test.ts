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
 * GH #69: the owner's tracked CC normally renders on its [YOU] [CC] cast line
 * only. A QUICK FOLLOW-UPS line cites the aura landing, so the selected
 * instance keeps its [CC ON ENEMY] line — at its own landing second, not the
 * cast second (codex astra: cast 16.95 s, aura 17.05 s).
 */

const PSYCHIC_SCREAM = "8122";

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
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Shadow,
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

function render(keep: BuildMatchTimelineParams["keepOwnerCcOnEnemy"]) {
  const owner = mkUnit("o", "Me-Realm");
  const enemy = mkUnit("e", "Enemy-Realm", {
    reaction: CombatUnitReaction.Hostile,
  });
  return buildMatchTimeline({
    owner,
    ownerSpec: "Priest_Shadow",
    ownerCDs: [
      {
        spellId: PSYCHIC_SCREAM,
        spellName: "Psychic Scream",
        tag: "CC",
        cooldownSeconds: 30,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 16.95 }],
        availableWindows: [],
        neverUsed: false,
      },
    ],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [],
    enemyCCSummaries: [
      {
        playerName: "Enemy-Realm",
        trinketUseTimes: [16.2],
        trinketCooldownSeconds: 120,
        ccInstances: [
          {
            atSeconds: 17.05,
            durationSeconds: 6,
            spellId: PSYCHIC_SCREAM,
            spellName: "Psychic Scream",
            sourceName: "Me-Realm",
            sourceId: "o",
            trinketState: "on_cooldown",
          },
        ],
      },
    ] as never,
    keepOwnerCcOnEnemy: keep,
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
    friends: [owner],
    enemies: [enemy],
    matchStartMs: 0,
    matchEndMs: 120_000,
    isHealer: false,
    criticalWindowSeconds: new Set<number>(),
  });
}

const ccOnEnemy = (t: string) =>
  t.split("\n").filter((l) => l.includes("[CC ON ENEMY]"));

describe("keepOwnerCcOnEnemy (GH #69)", () => {
  it("without a follow-up, the owner's tracked CC has no [CC ON ENEMY] line", () => {
    const t = render(undefined);
    expect(t).toContain("0:16  [YOU] [CC]   Psychic Scream");
    expect(ccOnEnemy(t)).toEqual([]);
  });

  it("the selected instance keeps its aura line at the landing second, with its duration", () => {
    const t = render([
      { targetName: "Enemy-Realm", spellId: PSYCHIC_SCREAM, ccAtS: 17.05 },
    ]);
    const lines = ccOnEnemy(t);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^0:17 {2}\[CC ON ENEMY\] {3}\S+ ← Psychic Scream \(by \S+\) \(6s\)$/,
    );
  });

  it("matches the exact instance only (another time or target keeps nothing)", () => {
    expect(
      ccOnEnemy(
        render([
          { targetName: "Enemy-Realm", spellId: PSYCHIC_SCREAM, ccAtS: 17 },
        ]),
      ),
    ).toEqual([]);
    expect(
      ccOnEnemy(
        render([
          { targetName: "Other", spellId: PSYCHIC_SCREAM, ccAtS: 17.05 },
        ]),
      ),
    ).toEqual([]);
  });
});
