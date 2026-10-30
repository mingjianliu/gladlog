/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T10: the [STATE] tick's `unit:ghost` token — a priest in Spirit of
 * Redemption form. The token's code existed and no caller passed its
 * intervals (0 `:ghost` in 3,520 contexts of the 605-file capture).
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import {
  extractSpiritOfRedemptionIntervals,
  SPIRIT_OF_REDEMPTION_AURA_IDS,
} from "../src/utils/combatStates";
import { makeUnit } from "./ported/testHelpers";

const emptyDispels = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
} as any;
const baseParams = {
  enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
  ccTrinketSummaries: [] as any[],
  dispelSummary: emptyDispels,
  enemyDispelSummary: emptyDispels,
  enemyCCSummaries: [] as any[],
  friendlyDeaths: [] as any[],
  enemyDeaths: [] as any[],
  pressureWindows: [] as any[],
  healingGaps: [] as any[],
  enemies: [] as ICombatUnit[],
  matchStartMs: 0,
  matchEndMs: 60000,
  isHealer: true,
  outgoingCCChains: [] as any[],
  criticalWindowSeconds: new Set<number>(),
};

describe("[STATE] `unit:ghost` (FT-T10)", () => {
  it("a priest in Spirit of Redemption form is `unit:ghost`, with its legend line", () => {
    const owner = makeUnit("PlayerYou", {
      name: "PlayerYou",
      spec: CombatUnitSpec.Warrior_Fury,
    });
    const priest = makeUnit("Priest1", {
      name: "Priest1",
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
    });
    const params = {
      ...baseParams,
      owner,
      ownerSpec: "Fury Warrior",
      ownerCDs: [],
      teammateCDs: [],
      friends: [owner, priest],
      allUnits: [owner, priest],
      criticalWindowSeconds: new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    };
    const ghost = buildMatchTimeline({
      ...params,
      spiritOfRedemptionIntervals: [
        { player: priest, intervals: [{ startSeconds: 2.6, endSeconds: 7.4 }] },
      ],
    });
    const ticks = ghost
      .split("\n")
      .filter((l) => /^\s*\d+:\d\d\s+\[STATE\]/.test(l));
    expect(ticks.some((l) => /Priest1:ghost\b/.test(l))).toBe(true);
    // the token covers the whole seconds inside the form, and no other
    for (const l of ticks) {
      const sec = Number(l.trim().slice(2, 4));
      expect(/:ghost\b/.test(l)).toBe(sec >= 3 && sec <= 7);
    }
    expect(ghost).toContain("`unit:ghost` on a [STATE] line");
    // nothing in the form → no token, no legend line
    const none = buildMatchTimeline(params);
    expect(none).not.toContain(":ghost");
    expect(none).not.toContain("`unit:ghost`");
  });

  it("the form's intervals: the aura on the unit itself, the two live ids only", () => {
    const aura = (event: LogEvent, spellId: string, ms: number, dest = "p") =>
      ({
        logLine: { event, timestamp: ms },
        timestamp: ms,
        spellId,
        srcUnitId: "p",
        destUnitId: dest,
      }) as any;
    const combat = { startTime: 0, endTime: 60_000 };
    const pressed = {
      id: "p",
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "215769", 13_871),
        aura(LogEvent.SPELL_AURA_REMOVED, "215769", 22_877),
        // on another unit, and the PvP talent's own id (never an aura): not the form
        aura(LogEvent.SPELL_AURA_APPLIED, "215769", 30_000, "other"),
        aura(LogEvent.SPELL_AURA_APPLIED, "215982", 31_000),
        // the on-death proc, still up at the end of the log
        aura(LogEvent.SPELL_AURA_APPLIED, "27827", 50_000),
      ],
    };
    expect(extractSpiritOfRedemptionIntervals(pressed, combat)).toEqual([
      { startSeconds: 13.871, endSeconds: 22.877 },
      { startSeconds: 50, endSeconds: 60 },
    ]);
    expect([...SPIRIT_OF_REDEMPTION_AURA_IDS].sort()).toEqual([
      "215769",
      "27827",
    ]);
  });
});
