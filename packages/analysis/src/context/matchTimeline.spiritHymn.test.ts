import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

/**
 * User ruling 2026-09-30: the pressed Spirit of Redemption (215769) that
 * carries a Divine Hymn is the Hymn throughput combo, not a survival cooldown
 * — no "cheaper available" on it. Pressed alone it is still judged as one.
 */

const SOR = "215769";
const HYMN = "64843";
const GUARDIAN_SPIRIT = "47788";

function mkUnit(id: string, overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id,
    name: `${id}-Realm`,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Holy,
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

const sorAura = (event: LogEvent, t: number) => ({
  spellId: SOR,
  spellName: "Spirit of Redemption",
  timestamp: t,
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: "o",
  srcUnitName: "o-Realm",
  destUnitId: "o",
  destUnitName: "o-Realm",
  auraType: "BUFF" as const,
  logLine: { event, timestamp: t, parameters: [] },
});

const ledgerEntry = (
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: number[],
) => ({
  spellId,
  spellName,
  tag: "Defensive" as const,
  cooldownSeconds,
  maxChargesDetected: 1,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  availableWindows: [{ fromSeconds: 0, toSeconds: 120, durationSeconds: 120 }],
  neverUsed: casts.length === 0,
});

function timeline(hymnAt: number[]): string {
  const owner = mkUnit("o", {
    auraEvents: [
      sorAura(LogEvent.SPELL_AURA_APPLIED, 30_000),
      sorAura(LogEvent.SPELL_AURA_REMOVED, 39_000),
    ] as never,
  });
  const enemy = mkUnit("e", { reaction: CombatUnitReaction.Hostile });
  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Priest_Holy",
    ownerCDs: [
      ledgerEntry(SOR, "Spirit of Redemption", 120, [30]),
      ledgerEntry(HYMN, "Divine Hymn", 180, hymnAt),
      ledgerEntry(GUARDIAN_SPIRIT, "Guardian Spirit", 60, []),
    ],
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
    friends: [owner],
    enemies: [enemy],
    matchStartMs: 0,
    matchEndMs: 120_000,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
  return buildMatchTimeline(params);
}

const sorLine = (t: string) =>
  t
    .split("\n")
    .find((l) => l.includes("Spirit of Redemption") && l.includes("[CD]"));

describe("Spirit of Redemption carrying Divine Hymn (user ruling 2026-09-30)", () => {
  it("pressed alone it keeps the cheaper-alternative note", () => {
    expect(sorLine(timeline([]))).toContain(
      "cheaper available: Guardian Spirit",
    );
  });

  it("with a Hymn started inside the spirit form it carries no cheaper-alternative note", () => {
    const line = sorLine(timeline([30.4]));
    expect(line).toBeDefined();
    expect(line).not.toContain("cheaper available");
  });

  it("a Hymn after the spirit form ended does not count", () => {
    expect(sorLine(timeline([45]))).toContain("cheaper available");
  });
});
