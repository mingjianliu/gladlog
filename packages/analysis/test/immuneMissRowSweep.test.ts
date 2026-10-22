/**
 * corpusFactScan2 immunityTableForward (b42, 2026-10-22): an IMMUNE control
 * row on the player whose cast is no control (Garrote 703's silence 1330)
 * still reaches `ccImmuneUncredited` — the [CC AVOIDED?] line's source.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const AT = MATCH_START + 60_000;

describe("IMMUNE control rows the cast sweep never walks", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("Garrote – Silence logged IMMUNE off a Garrote cast → one uncredited row", () => {
    const rogue = makeUnit("enemy-1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Assassination,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent("703", AT, "player-1", "Priest", "enemy-1", "Rogue"),
      ],
    });
    const player = makeUnit("player-1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [
      {
        spellId: "1330",
        spellName: "Garrote - Silence",
        srcUnitId: "enemy-1",
        destUnitId: "player-1",
        missType: "IMMUNE",
        timestamp: AT + 2,
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT + 2 },
      },
    ];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": rogue, "player-1": player },
    };
    const r = analyzePlayerCCAndTrinket(player, [rogue], combat as never);
    expect(r.ccImmuneUncredited?.map((x) => x.spellName)).toEqual([
      "Garrote - Silence",
    ]);
  });
});
