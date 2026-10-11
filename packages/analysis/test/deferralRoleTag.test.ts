/**
 * FT F01: Time Dilation's role tag. It read `[ally heal-over-time]` (19 lines
 * on the 60 re-eval prompts, 258 on the 605-file capture) while the log shows
 * no heal under 357170 at all — it holds part of each hit back and that part
 * lands later as the unit's own periodic damage (`DEFERRAL_SHIELD_DAMAGE_IDS`).
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
  CD_ROLE_TAGS,
  cdRoleTag,
  DEFERRAL_ROLE_TAG,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import { DEFERRAL_SHIELD_DAMAGE_IDS } from "../src/utils/incomingPressure";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const TIME_DILATION = "357170";

const empty = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
} as never;
const baseTimelineParams = {
  enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
  ccTrinketSummaries: [] as never[],
  dispelSummary: empty,
  enemyDispelSummary: empty,
  enemyCCSummaries: [] as never[],
  friendlyDeaths: [] as never[],
  enemyDeaths: [] as never[],
  pressureWindows: [] as never[],
  healingGaps: [] as never[],
  enemies: [] as ICombatUnit[],
  matchStartMs: 0,
  matchEndMs: 120_000,
  isHealer: true,
  criticalWindowSeconds: new Set<number>(),
};

function timelineOf(castIds: string[]): string {
  const mate = makeUnit("player-2", {
    name: "Mate",
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
  });
  const owner = makeUnit("player-1", {
    name: "Evoker",
    class: CombatUnitClass.Evoker,
    spec: CombatUnitSpec.Evoker_Preservation,
    spellCastEvents: castIds.map((id, i) => ({
      ...makeSpellCastEvent(id, 30_000 + i * 20_000, "player-1", "player-2"),
      destUnitName: "Mate",
    })),
  });
  const combat = {
    startTime: 0,
    endTime: 120_000,
    units: { [owner.id]: owner, [mate.id]: mate },
  } as unknown as AtomicArenaCombat;
  return buildMatchTimeline({
    ...baseTimelineParams,
    owner,
    ownerSpec: "Preservation Evoker",
    ownerCDs: extractMajorCooldowns(owner, combat),
    teammateCDs: [],
    friends: [owner, mate],
  });
}

describe("Time Dilation's role tag (FT F01)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a deferral shield's tag is the deferral tag, and says nothing about healing", () => {
    expect(TIME_DILATION in DEFERRAL_SHIELD_DAMAGE_IDS).toBe(true);
    expect(cdRoleTag(TIME_DILATION)).toBe(DEFERRAL_ROLE_TAG);
    expect(DEFERRAL_ROLE_TAG).not.toMatch(/heal/i);
    // the one table decides: no deferral shield may carry another role
    for (const id of Object.keys(DEFERRAL_SHIELD_DAMAGE_IDS))
      if (id in CD_ROLE_TAGS)
        expect(CD_ROLE_TAGS[id], id).toBe(DEFERRAL_ROLE_TAG);
  });

  it("the press line carries the tag and the legend explains it", () => {
    const out = timelineOf([TIME_DILATION]);
    const press = out
      .split("\n")
      .filter((l) => /\[YOU\] \[CD\]\s+Time Dilation/.test(l));
    expect(press).toHaveLength(1);
    expect(press[0]).toContain(`Time Dilation [${DEFERRAL_ROLE_TAG}]`);
    expect(out).not.toContain("heal-over-time");
    expect(out).toContain(
      `\`[${DEFERRAL_ROLE_TAG}]\` after a cooldown's name = it does not heal`,
    );
  });

  it("no such press, no legend line", () => {
    const out = timelineOf([]);
    expect(out).not.toContain(`[${DEFERRAL_ROLE_TAG}]`);
  });
});
