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
 * F170 regression anchor (2026-07-29): `[ENEMY HARD CAST]` used to read
 * `enemy.spellCastEvents` and filter for SPELL_CAST_START -- but the new L3
 * parser splits START out into a separate `castStartEvents`, leaving only
 * SUCCESS in `spellCastEvents`, so the filter always came up empty (measured:
 * 0 of 178 matches produced the line across a 60-match sample; investigation in
 * /tmp/f170-investigation.md).
 * These two tests lock down the post-fix field source: a whitelisted START
 * event produces the line only when it is in castStartEvents, and a SUCCESS
 * event sitting alone in spellCastEvents produces nothing.
 */

const CHAOS_BOLT_ID = "116858";

function mkUnit(
  id: string,
  name: string,
  reaction: CombatUnitReaction,
  spec: CombatUnitSpec,
  overrides: Partial<ICombatUnit> = {},
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Mage,
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
    ...overrides,
  };
}

const MATCH_START_MS = 0;
const MATCH_END_MS = 60_000;

function baseParams(
  owner: ICombatUnit,
  enemy: ICombatUnit,
): BuildMatchTimelineParams {
  return {
    owner,
    ownerSpec: "Priest_Discipline",
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
    friends: [owner],
    enemies: [enemy],
    matchStartMs: MATCH_START_MS,
    matchEndMs: MATCH_END_MS,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
}

describe("F170 [ENEMY HARD CAST]", () => {
  it("白名单技能出现在 castStartEvents(START)时产出该行", () => {
    const owner = mkUnit(
      "o",
      "Healer-Area52",
      CombatUnitReaction.Friendly,
      CombatUnitSpec.Priest_Discipline,
      { class: CombatUnitClass.Priest },
    );
    const enemy = mkUnit(
      "e",
      "Emage-Area52",
      CombatUnitReaction.Hostile,
      CombatUnitSpec.Warlock_Destruction,
      {
        class: CombatUnitClass.Warlock,
        // 2026-09-26 (round 3 N10): a line needs the bar to have LANDED — the
        // same spell's SUCCESS ≥ 300 ms after the START (2.5 s here).
        spellCastEvents: [
          {
            spellId: CHAOS_BOLT_ID,
            spellName: "Chaos Bolt",
            timestamp: MATCH_START_MS + 7_500,
            srcUnitFlags: 0,
            destUnitFlags: 0,
            srcUnitId: "e",
            srcUnitName: "Emage-Area52",
            destUnitId: "o",
            destUnitName: "Healer-Area52",
            logLine: {
              event: LogEvent.SPELL_CAST_SUCCESS,
              timestamp: MATCH_START_MS + 7_500,
              parameters: [],
              lineIndex: 1,
            },
          },
        ],
        castStartEvents: [
          {
            spellId: CHAOS_BOLT_ID,
            spellName: "Chaos Bolt",
            timestamp: MATCH_START_MS + 5_000,
            srcUnitFlags: 0,
            destUnitFlags: 0,
            srcUnitId: "e",
            srcUnitName: "Emage-Area52",
            destUnitId: "o",
            destUnitName: "Healer-Area52",
            logLine: {
              event: LogEvent.SPELL_CAST_START,
              timestamp: MATCH_START_MS + 5_000,
              parameters: [],
              lineIndex: 0,
            },
          },
        ],
      },
    );

    const timeline = buildMatchTimeline(baseParams(owner, enemy));

    expect(timeline).toContain("[ENEMY HARD CAST]");
    expect(timeline).toContain("Chaos Bolt");
    expect(timeline).toContain("(2.5s cast, landed)");
  });

  it("an instant (SUCCESS 20 ms after START) or an aborted bar (no SUCCESS) is not a hard cast", () => {
    const owner = mkUnit("o", "Healer-Area52", CombatUnitReaction.Friendly, CombatUnitSpec.Priest_Discipline, { class: CombatUnitClass.Priest });
    const mk = (startMs: number, successMs?: number) =>
      mkUnit("e", "Emage-Area52", CombatUnitReaction.Hostile, CombatUnitSpec.Warlock_Destruction, {
        class: CombatUnitClass.Warlock,
        spellCastEvents: successMs === undefined ? [] : [{
          spellId: CHAOS_BOLT_ID, spellName: "Chaos Bolt", timestamp: successMs, srcUnitFlags: 0, destUnitFlags: 0,
          srcUnitId: "e", srcUnitName: "Emage-Area52", destUnitId: "o", destUnitName: "Healer-Area52",
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: successMs, parameters: [], lineIndex: 1 },
        }],
        castStartEvents: [{
          spellId: CHAOS_BOLT_ID, spellName: "Chaos Bolt", timestamp: startMs, srcUnitFlags: 0, destUnitFlags: 0,
          srcUnitId: "e", srcUnitName: "Emage-Area52", destUnitId: "o", destUnitName: "Healer-Area52",
          logLine: { event: LogEvent.SPELL_CAST_START, timestamp: startMs, parameters: [], lineIndex: 0 },
        }],
      });
    expect(buildMatchTimeline(baseParams(owner, mk(MATCH_START_MS + 5_000, MATCH_START_MS + 5_020)))).not.toContain("[ENEMY HARD CAST]");
    expect(buildMatchTimeline(baseParams(owner, mk(MATCH_START_MS + 5_000)))).not.toContain("[ENEMY HARD CAST]");
  });

  it("an instant followed by a later SUCCESS-only instant, or an aborted bar followed by one 25 s later, is not a landed hard cast (codex)", () => {
    const owner = mkUnit("o", "Healer-Area52", CombatUnitReaction.Friendly, CombatUnitSpec.Priest_Discipline, { class: CombatUnitClass.Priest });
    const succ = (ms: number, i: number) => ({
      spellId: CHAOS_BOLT_ID, spellName: "Chaos Bolt", timestamp: ms, srcUnitFlags: 0, destUnitFlags: 0,
      srcUnitId: "e", srcUnitName: "Emage-Area52", destUnitId: "o", destUnitName: "Healer-Area52",
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms, parameters: [], lineIndex: i },
    });
    const start = (ms: number) => ({
      spellId: CHAOS_BOLT_ID, spellName: "Chaos Bolt", timestamp: ms, srcUnitFlags: 0, destUnitFlags: 0,
      srcUnitId: "e", srcUnitName: "Emage-Area52", destUnitId: "o", destUnitName: "Healer-Area52",
      logLine: { event: LogEvent.SPELL_CAST_START, timestamp: ms, parameters: [], lineIndex: 0 },
    });
    const mk = (starts: number[], succs: number[]) =>
      mkUnit("e", "Emage-Area52", CombatUnitReaction.Hostile, CombatUnitSpec.Warlock_Destruction, {
        class: CombatUnitClass.Warlock, spellCastEvents: succs.map(succ), castStartEvents: starts.map(start),
      });
    expect(buildMatchTimeline(baseParams(owner, mk([MATCH_START_MS + 5_000], [MATCH_START_MS + 5_020, MATCH_START_MS + 8_000])))).not.toContain("[ENEMY HARD CAST]");
    expect(buildMatchTimeline(baseParams(owner, mk([MATCH_START_MS + 5_000], [MATCH_START_MS + 30_000])))).not.toContain("[ENEMY HARD CAST]");
  });

  it("an abandoned bar followed by ANOTHER spell's bar and a later instant is not landed; back-to-back bars sharing a timestamp both render (codex)", () => {
    const owner = mkUnit("o", "Healer-Area52", CombatUnitReaction.Friendly, CombatUnitSpec.Priest_Discipline, { class: CombatUnitClass.Priest });
    const ev = (kind: "start" | "succ", spellId: string, ms: number, i: number) => ({
      spellId, spellName: spellId, timestamp: ms, srcUnitFlags: 0, destUnitFlags: 0,
      srcUnitId: "e", srcUnitName: "Emage-Area52", destUnitId: "o", destUnitName: "Healer-Area52",
      logLine: { event: kind === "start" ? LogEvent.SPELL_CAST_START : LogEvent.SPELL_CAST_SUCCESS, timestamp: ms, parameters: [], lineIndex: i },
    });
    const mk = (starts: ReturnType<typeof ev>[], succs: ReturnType<typeof ev>[]) =>
      mkUnit("e", "Emage-Area52", CombatUnitReaction.Hostile, CombatUnitSpec.Warlock_Destruction, {
        class: CombatUnitClass.Warlock, spellCastEvents: succs, castStartEvents: starts,
      });
    // abandoned Chaos Bolt at 5 s, a Fireball-like bar 6–7.5 s, Chaos Bolt instant at 8 s → no line
    const a = mk(
      [ev("start", CHAOS_BOLT_ID, MATCH_START_MS + 5_000, 1), ev("start", "133", MATCH_START_MS + 6_000, 2)],
      [ev("succ", "133", MATCH_START_MS + 7_500, 3), ev("succ", CHAOS_BOLT_ID, MATCH_START_MS + 8_000, 4)],
    );
    expect(buildMatchTimeline(baseParams(owner, a))).not.toContain("[ENEMY HARD CAST]");
    // START 5 / SUCCESS 7.5 / START 7.5 / SUCCESS 10 → two landed lines
    const b = mk(
      [ev("start", CHAOS_BOLT_ID, MATCH_START_MS + 5_000, 1), ev("start", CHAOS_BOLT_ID, MATCH_START_MS + 7_500, 3)],
      [ev("succ", CHAOS_BOLT_ID, MATCH_START_MS + 7_500, 2), ev("succ", CHAOS_BOLT_ID, MATCH_START_MS + 10_000, 4)],
    );
    const tl = buildMatchTimeline(baseParams(owner, b));
    expect(tl.split("\n").filter((l) => l.includes("[ENEMY HARD CAST]"))).toHaveLength(2);
  });

  it("an abandoned START followed by an instant START+SUCCESS at one ms does not steal that success (codex)", () => {
    const owner = mkUnit("o", "Healer-Area52", CombatUnitReaction.Friendly, CombatUnitSpec.Priest_Discipline, { class: CombatUnitClass.Priest });
    const ev = (kind: "start" | "succ", ms: number, i: number) => ({
      spellId: CHAOS_BOLT_ID, spellName: "Chaos Bolt", timestamp: ms, srcUnitFlags: 0, destUnitFlags: 0,
      srcUnitId: "e", srcUnitName: "Emage-Area52", destUnitId: "o", destUnitName: "Healer-Area52",
      logLine: { event: kind === "start" ? LogEvent.SPELL_CAST_START : LogEvent.SPELL_CAST_SUCCESS, timestamp: ms, parameters: [], lineIndex: i },
    });
    const enemy = mkUnit("e", "Emage-Area52", CombatUnitReaction.Hostile, CombatUnitSpec.Warlock_Destruction, {
      class: CombatUnitClass.Warlock,
      castStartEvents: [ev("start", MATCH_START_MS + 5_000, 1), ev("start", MATCH_START_MS + 8_000, 2)],
      spellCastEvents: [ev("succ", MATCH_START_MS + 8_000, 3)],
    });
    expect(buildMatchTimeline(baseParams(owner, enemy))).not.toContain("[ENEMY HARD CAST]");
  });

  it("同一法术只在 spellCastEvents(SUCCESS)里、没有 castStartEvents 时不产出", () => {
    const owner = mkUnit(
      "o",
      "Healer-Area52",
      CombatUnitReaction.Friendly,
      CombatUnitSpec.Priest_Discipline,
      { class: CombatUnitClass.Priest },
    );
    const enemy = mkUnit(
      "e",
      "Emage-Area52",
      CombatUnitReaction.Hostile,
      CombatUnitSpec.Warlock_Destruction,
      {
        class: CombatUnitClass.Warlock,
        castStartEvents: [],
        spellCastEvents: [
          {
            spellId: CHAOS_BOLT_ID,
            spellName: "Chaos Bolt",
            timestamp: MATCH_START_MS + 5_000,
            srcUnitFlags: 0,
            destUnitFlags: 0,
            srcUnitId: "e",
            srcUnitName: "Emage-Area52",
            destUnitId: "o",
            destUnitName: "Healer-Area52",
            logLine: {
              event: LogEvent.SPELL_CAST_SUCCESS,
              timestamp: MATCH_START_MS + 5_000,
              parameters: [],
              lineIndex: 0,
            },
          },
        ],
      },
    );

    const timeline = buildMatchTimeline(baseParams(owner, enemy));

    expect(timeline).not.toContain("[ENEMY HARD CAST]");
  });
});
