/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  DEATH_WINDOW_S,
  DEATH_WINDOW_UNFOLD_CAP,
  TIMELINE_LINE_FLAGS,
} from "../src/data/timelineLineFlags";
import {
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "../src/utils/killAttempts";
import { makeUnit } from "./ported/testHelpers";

/**
 * GH #97 — the two timeline lines behind `TIMELINE_LINE_FLAGS`, pinned in
 * every flag position so a flag flip is a one-line change, never a rewrite:
 *  - `[ENEMY DEF]`: rendered only under "timeline"; "stamp" instead appends
 *    `@m:ss` to the KILL ATTEMPTS `popped X` names; "off" renders neither.
 *  - death-window unfold: under "perCast" a spam-folded spell's casts inside
 *    the DEATH_WINDOW_S before a friendly death print one line each with the
 *    target's `[STATE]`-grid HP, capped at DEATH_WINDOW_UNFOLD_CAP; "summary"
 *    prints one `[YOU] [HEALS]` count line per window; "off" keeps the fold.
 * Mutates the flag singleton → this file must stay OUT of vitest.shared.json.
 */

const START = 1_000_000;
const ms = (s: number) => START + s * 1000;
const RIPTIDE = "61295";
const BARKSKIN = "22812";
const DEATH_AT = 60;

const savedFlags = { ...TIMELINE_LINE_FLAGS };
afterEach(() => {
  Object.assign(TIMELINE_LINE_FLAGS, savedFlags);
});

function cast(atS: number, dest: string): any {
  return {
    spellId: RIPTIDE,
    spellName: "Riptide",
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: ms(atS),
      parameters: [],
    },
  };
}
function hpTick(unitId: string, atS: number, pct: number): any {
  return {
    advancedActorId: unitId,
    advancedActorMaxHp: 100_000,
    advancedActorCurrentHp: pct * 1000,
    logLine: {
      event: LogEvent.SPELL_DAMAGE,
      timestamp: ms(atS),
      parameters: [],
    },
  };
}
function aura(
  spellId: string,
  name: string,
  src: string,
  dest: string,
  atS: number,
  event: LogEvent,
): any {
  return {
    spellId,
    spellName: name,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    logLine: { event, timestamp: ms(atS), parameters: [] },
    auraType: "BUFF",
  };
}

function render(): string {
  // 14 Riptides ≥ SPAM_FOLD_THRESHOLD (12) so the fold engages; the last
  // three sit inside the death window (DEATH_AT − 10 … DEATH_AT).
  const castTimes = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 52, 55, 58];
  const owner = makeUnit("PlayerYou", {
    spec: CombatUnitSpec.Shaman_Restoration,
    spellCastEvents: castTimes.map((t) => cast(t, "Alice")),
  });
  const alice = makeUnit("Alice", {
    spec: CombatUnitSpec.Hunter_BeastMastery,
    advancedActions: [
      hpTick("Alice", 52, 70),
      hpTick("Alice", 55, 40),
      hpTick("Alice", 58, 15),
    ],
  });
  const enemy = makeUnit("Enemy1", {
    spec: CombatUnitSpec.Druid_Restoration,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      aura(
        BARKSKIN,
        "Barkskin",
        "Enemy1",
        "Enemy1",
        30,
        LogEvent.SPELL_AURA_APPLIED,
      ),
      aura(
        BARKSKIN,
        "Barkskin",
        "Enemy1",
        "Enemy1",
        42,
        LogEvent.SPELL_AURA_REMOVED,
      ),
    ],
  });
  const empty = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any;
  return buildMatchTimeline({
    owner,
    ownerSpec: "Restoration Shaman",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
    ccTrinketSummaries: [],
    dispelSummary: empty,
    enemyDispelSummary: empty,
    enemyCCSummaries: [],
    friendlyDeaths: [
      { spec: "Beast Mastery Hunter", name: "Alice", atSeconds: DEATH_AT },
    ],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, alice],
    enemies: [enemy],
    allUnits: [owner, alice, enemy],
    matchStartMs: START,
    matchEndMs: ms(120),
    isHealer: true,
    playerIdMap: new Map([
      ["PlayerYou", 1],
      ["Alice", 2],
    ]),
    enemyIdMap: new Map([["Enemy1", 4]]),
    outgoingCCChains: [],
    criticalWindowSeconds: new Set<number>(),
  });
}

describe("GH #97 timeline flags", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("[ENEMY DEF] renders under 'timeline' with official pct + observed duration, never otherwise", () => {
    TIMELINE_LINE_FLAGS.enemyDef = "timeline";
    const on = render();
    expect(on).toContain(
      "0:30  [ENEMY DEF]   4(RDruid) (Restoration Druid): Barkskin (20%, 12.0s)",
    );
    expect(on).toContain("[ENEMY DEF] = ");
    for (const mode of ["off", "stamp"] as const) {
      TIMELINE_LINE_FLAGS.enemyDef = mode;
      const text = render();
      expect(text).not.toContain("[ENEMY DEF]");
    }
  });

  it("death-window unfold: perCast lines carry the target's grid HP and stop at the cap; off keeps the fold", () => {
    TIMELINE_LINE_FLAGS.deathWindowUnfold = "perCast";
    const on = render();
    expect(on).toContain("0:52  [YOU] [CAST]   Riptide → 2 (70% HP)");
    expect(on).toContain("0:55  [YOU] [CAST]   Riptide → 2 (40% HP)");
    expect(on).toContain("0:58  [YOU] [CAST]   Riptide → 2 (15% HP)");
    // the fold still covers the pre-window spam
    expect(on).toContain("0:02  [YOU] [CAST]   Riptide (x11 over 30s) → 2");
    expect(on).not.toContain("0:29  [YOU] [CAST]   Riptide");
    expect(DEATH_WINDOW_UNFOLD_CAP).toBeGreaterThanOrEqual(3);
    expect(DEATH_WINDOW_S).toBe(10);

    TIMELINE_LINE_FLAGS.deathWindowUnfold = "off";
    const off = render();
    expect(off).not.toContain("0:55  [YOU] [CAST]   Riptide");
    expect(off).not.toContain("% HP)");
    expect(off).not.toContain("[YOU] [HEALS]");
  });

  it("death-window unfold: summary prints one counted [YOU] [HEALS] line per window", () => {
    TIMELINE_LINE_FLAGS.deathWindowUnfold = "summary";
    const text = render();
    expect(text).toContain("0:50–1:00  [YOU] [HEALS]   Riptide ×3 → 2");
    expect(text).not.toContain("0:55  [YOU] [CAST]   Riptide");
  });

  it("'stamp' appends @m:ss to the KILL ATTEMPTS popped names; other modes do not", () => {
    // minimal popped-defensive attempt: e1 stunned 10–15 s by f1, hit for 50k
    // at 12 s, Barkskin (20 %) applied by e1 at 12 s → attribution "defensive"
    const KIDNEY = "408";
    const stun = (event: LogEvent, atS: number): any => ({
      spellId: KIDNEY,
      spellName: "Kidney Shot",
      srcUnitId: "f1",
      srcUnitName: "f1",
      destUnitId: "e1",
      destUnitName: "e1",
      timestamp: ms(atS),
      logLine: { event, timestamp: ms(atS), parameters: [] },
      auraType: "DEBUFF",
    });
    const e1: any = {
      ...makeUnit("e1", {
        reaction: CombatUnitReaction.Hostile,
        spec: CombatUnitSpec.Druid_Restoration,
      }),
      type: 1,
      info: {},
      auraEvents: [
        stun(LogEvent.SPELL_AURA_APPLIED, 10),
        stun(LogEvent.SPELL_AURA_REMOVED, 15),
        aura(
          BARKSKIN,
          "Barkskin",
          "e1",
          "e1",
          12.4,
          LogEvent.SPELL_AURA_APPLIED,
        ),
        aura(
          BARKSKIN,
          "Barkskin",
          "e1",
          "e1",
          24.4,
          LogEvent.SPELL_AURA_REMOVED,
        ),
      ],
    };
    const f1: any = {
      ...makeUnit("f1"),
      type: 1,
      info: {},
      damageOut: [
        {
          destUnitId: "e1",
          effectiveAmount: 50_000,
          logLine: {
            event: LogEvent.SPELL_DAMAGE,
            timestamp: ms(12),
            parameters: [],
          },
        },
      ],
    };
    const combat: any = {
      startTime: START,
      endTime: ms(300),
      units: { f1, e1 },
    };
    const attempts = () => extractKillAttempts([f1], [e1], combat);
    TIMELINE_LINE_FLAGS.enemyDef = "stamp";
    const stamped = attempts()[0];
    expect(stamped.attribution?.defensivePopped).toEqual(["Barkskin"]);
    expect(stamped.attribution?.defensivePoppedAtS).toEqual([12.4]);
    expect(formatKillAttemptsForContext([stamped]).join("\n")).toContain(
      "popped Barkskin@0:12",
    );
    for (const mode of ["off", "timeline"] as const) {
      TIMELINE_LINE_FLAGS.enemyDef = mode;
      const text = formatKillAttemptsForContext([attempts()[0]]).join("\n");
      expect(text).toContain("popped Barkskin");
      expect(text).not.toContain("Barkskin@");
    }
  });
});
