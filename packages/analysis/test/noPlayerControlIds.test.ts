/**
 * fact6 D19 / D20 (F20 ccLanded): Havoc Metamorphosis' landing 200166 stuns
 * NPCs only — players are Dazed (247121) instead (DB2 tooltip of 191427).
 * It stays a control for the aura readers (`ccSpellIds`, DR), but no press
 * or miss row of it is a control on a player (`NO_PLAYER_CONTROL_IDS`), so
 * its IMMUNE row on a player is no `[CC AVOIDED?]`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  controlReachesPlayers,
  isControlCast,
  missReportsControl,
  NO_PLAYER_CONTROL_IDS,
} from "../src/utils/castMissRows";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { makeUnit } from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const AT = MATCH_START + 60_000;
const META_LANDING = "200166";
const HOJ = "853";

describe("NO_PLAYER_CONTROL_IDS — a control the game never puts on a player", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("200166 is listed; the cast / miss readers no longer call it a control", () => {
    expect([...NO_PLAYER_CONTROL_IDS]).toEqual([META_LANDING]);
    expect(controlReachesPlayers(META_LANDING)).toBe(false);
    expect(isControlCast(META_LANDING)).toBe(false);
    expect(missReportsControl(META_LANDING)).toBe(false);
    // an ordinary stun still is
    expect(controlReachesPlayers(HOJ)).toBe(true);
    expect(isControlCast(HOJ)).toBe(true);
    expect(missReportsControl(HOJ)).toBe(true);
  });

  const immuneRow = (spellId: string, spellName: string) => {
    const dh = makeUnit("enemy-1", {
      name: "DemonHunter",
      spec: CombatUnitSpec.DemonHunter_Havoc,
      reaction: CombatUnitReaction.Hostile,
    });
    const player = makeUnit("player-1", {
      name: "Paladin",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [
      {
        spellId,
        spellName,
        srcUnitId: "enemy-1",
        destUnitId: "player-1",
        missType: "IMMUNE",
        timestamp: AT,
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT },
      },
    ];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": dh, "player-1": player },
    };
    return analyzePlayerCCAndTrinket(player, [dh], combat as never);
  };

  it("D20 shape: a 200166 IMMUNE row on a player is no avoided control", () => {
    const r = immuneRow(META_LANDING, "Metamorphosis");
    expect(r.ccImmuneUncredited ?? []).toEqual([]);
    expect(r.ccAvoidedInstances ?? []).toEqual([]);
  });

  it("control: a Hammer of Justice IMMUNE row still is one", () => {
    const r = immuneRow(HOJ, "Hammer of Justice");
    expect(r.ccImmuneUncredited?.map((x) => x.spellName)).toEqual([
      "Hammer of Justice",
    ]);
  });
});
