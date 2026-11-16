/**
 * Pipeline T112 (fact13 D8): a `[CC AVOIDED?]` line resting on the log's own
 * failed-control row is stamped at that row, whatever kind of control it is.
 * A Song of Chi-Ji (a travelling control, no landing window) cast at 1:38.03
 * logged IMMUNE on its target at 1:39.59 and was stamped 1:38 — the cast —
 * because `controlHitInstant` returned the cast for a control with no
 * `AOE_CC_LANDING_WINDOW_S` entry before it read the miss row.
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
const AT = MATCH_START + 98_029;
const SONG = "198898";

function songRun(missMs: number[]) {
  const monk = makeUnit("enemy-1", {
    name: "Monk",
    spec: CombatUnitSpec.Monk_Mistweaver,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [makeSpellCastEvent(SONG, AT, "", "", "enemy-1", "Monk")],
  });
  const player = makeUnit("player-1", {
    name: "Paladin",
    spec: CombatUnitSpec.Paladin_Holy,
    reaction: CombatUnitReaction.Friendly,
  });
  (player as unknown as { missesIn: unknown[] }).missesIn = missMs.map(
    (ms) => ({
      spellId: "198909",
      spellName: "Song of Chi-Ji",
      srcUnitId: "enemy-1",
      destUnitId: "player-1",
      missType: "IMMUNE",
      timestamp: ms,
      logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms },
    }),
  );
  const combat = {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    startInfo: { zoneId: "1672" },
    units: { "enemy-1": monk, "player-1": player },
  };
  const r = analyzePlayerCCAndTrinket(player, [monk], combat as never);
  return [...(r.ccImmuneUncredited ?? []), ...r.ccAvoidedInstances].map(
    (x) => ({
      spellName: x.spellName,
      atSeconds: x.atSeconds,
      castAtSeconds: x.castAtSeconds,
    }),
  );
}

describe("a travelling control's [CC AVOIDED?] instant", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("a cast-less row of the same control within 1 s of the CAST is still that press — no second line, though the line moved to its row", () => {
    // a Command Demon's own IMMUNE rows sit 0.7 s before the pet's Axe Toss
    // cast, whose own IMMUNE lands 1.0 s after it (605 s2 62-3: three lines
    // where there had been one)
    expect(songRun([AT - 600, AT + 1_565])).toEqual([
      { spellName: "Song of Chi-Ji", atSeconds: 99.594, castAtSeconds: 98.029 },
    ]);
  });
  it("is its IMMUNE row's, 1.56 s after the cast; the cast stays stamped", () => {
    const monk = makeUnit("enemy-1", {
      name: "Monk",
      spec: CombatUnitSpec.Monk_Mistweaver,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(SONG, AT, "", "", "enemy-1", "Monk"),
      ],
    });
    const player = makeUnit("player-1", {
      name: "Paladin",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [
      {
        spellId: "198909",
        spellName: "Song of Chi-Ji",
        srcUnitId: "enemy-1",
        destUnitId: "player-1",
        missType: "IMMUNE",
        timestamp: AT + 1_565,
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT + 1_565 },
      },
    ];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": monk, "player-1": player },
    };
    const r = analyzePlayerCCAndTrinket(player, [monk], combat as never);
    const lines = [
      ...(r.ccImmuneUncredited ?? []),
      ...r.ccAvoidedInstances,
    ].map((x) => ({
      spellName: x.spellName,
      atSeconds: x.atSeconds,
      castAtSeconds: x.castAtSeconds,
    }));
    expect(lines).toEqual([
      { spellName: "Song of Chi-Ji", atSeconds: 99.594, castAtSeconds: 98.029 },
    ]);
  });
});
