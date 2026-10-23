/**
 * codex 20-F17-02 #1 (fb198a1a r1): a landing a LATER cast of the control by
 * the same caster precedes is that cast's. A Freezing Trap at 53.8 s missed
 * the owner under Phase Shift (54.1); the hunter's next trap landed at 92.1 —
 * inside the first trap's 60.5 s landing window — and the avoidance of the
 * first was lost.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const CAST_AT = MATCH_START + 60_000;
const combat = {
  startTime: MATCH_START,
  endTime: MATCH_START + 300_000,
  startInfo: { zoneId: "1672" },
};
const FREEZING_TRAP = "187650";
const FREEZING_TRAP_AURA = "3355";
const BLADESTORM = "227847";

beforeAll(async () => {
  await ensureAnalysisData();
});

function avoided(secondTrapAfterMs: number | undefined) {
  const trapCast = (at: number) =>
    makeSpellCastEvent(
      FREEZING_TRAP,
      at,
      "0000000000000000",
      "nil",
      "enemy-1",
      "Hunter",
      0,
      "Freezing Trap",
    );
  const hunter = makeUnit("enemy-1", {
    name: "Hunter",
    spec: CombatUnitSpec.Hunter_Survival,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      trapCast(CAST_AT),
      ...(secondTrapAfterMs === undefined
        ? []
        : [trapCast(CAST_AT + secondTrapAfterMs)]),
    ],
  });
  const secondLanding =
    secondTrapAfterMs === undefined
      ? []
      : [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            FREEZING_TRAP_AURA,
            CAST_AT + secondTrapAfterMs + 500,
            "enemy-1",
            "player-1",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            FREEZING_TRAP_AURA,
            CAST_AT + secondTrapAfterMs + 3_500,
            "enemy-1",
            "player-1",
          ),
        ];
  const player = makeUnit("player-1", {
    name: "PlayerWarrior",
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BLADESTORM,
        CAST_AT - 1_000,
        "player-1",
        "player-1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BLADESTORM,
        CAST_AT + 5_000,
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...secondLanding,
    ].sort((a, b) => a.timestamp - b.timestamp),
  });
  player.missesIn = [
    {
      timestamp: CAST_AT + 250,
      spellId: FREEZING_TRAP_AURA,
      srcUnitId: "enemy-1",
      destUnitId: "player-1",
      missType: "MISS",
      amount: 0,
    },
  ] as never;
  return analyzePlayerCCAndTrinket(player, [hunter], combat as never)
    .ccAvoidedInstances.map((a) => a.atSeconds);
}

describe("a later trap's landing is not the earlier trap's", () => {
  it("the first trap's logged miss stays an avoidance", () => {
    const alone = avoided(undefined);
    expect(alone).toHaveLength(1);
    expect(avoided(30_000)).toEqual(alone);
  });
});
