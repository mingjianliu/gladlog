/**
 * corpusFactScan2 immuneCause notUp:inResolveWindow (2026-10-22): a ground
 * control that went off — its first landing from the caster on ANY unit —
 * is not dodged by a move pressed after it. 26-5-159 0:41: Capacitor Totem
 * pulsed 2.0 s after the cast, Shadowmeld 2.53 s; 12 of the 30 held-out
 * credits had this shape.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const CAST_AT = MATCH_START + 60_000;
const CAPACITOR_TOTEM = "192058";
const STATIC_CHARGE = "118905";
const ROLL = "109132";

function avoidedWithRollAt(rollAfterMs: number) {
  const enemy = makeUnit("enemy-1", {
    name: "Enemy",
    spec: CombatUnitSpec.Shaman_Restoration,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      makeSpellCastEvent(
        CAPACITOR_TOTEM,
        CAST_AT,
        "0000000000000000",
        "nil",
        "enemy-1",
        "Enemy",
        0,
        getEnglishSpellName(CAPACITOR_TOTEM),
      ),
    ],
  });
  // the pulse stuns a teammate 2.0 s after the cast
  const mate = makeUnit("player-2", {
    name: "Mate",
    reaction: CombatUnitReaction.Friendly,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        STATIC_CHARGE,
        CAST_AT + 2_000,
        "enemy-1",
        "player-2",
      ),
    ],
  });
  const player = makeUnit("player-1", {
    name: "Monk",
    spec: CombatUnitSpec.Monk_Windwalker,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [
      makeSpellCastEvent(
        ROLL,
        CAST_AT + rollAfterMs,
        "0000000000000000",
        "nil",
        "player-1",
        "Monk",
      ),
    ],
  });
  const combat = {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    startInfo: { zoneId: "1672" },
    units: { "enemy-1": enemy, "player-1": player, "player-2": mate },
  };
  return analyzePlayerCCAndTrinket(player, [enemy], combat as never)
    .ccAvoidedInstances.map((a) => `${a.spellName}/${a.avoidanceSpellName}`);
}

describe("a ground control's go-off bounds the move that dodged it", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("a Roll before the pulse is credited; one after it is not", () => {
    expect(avoidedWithRollAt(1_500)).toEqual(["Capacitor Totem/Roll"]);
    expect(avoidedWithRollAt(2_400)).toEqual([]);
  });
});
