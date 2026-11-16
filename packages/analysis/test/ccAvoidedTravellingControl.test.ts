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
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

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
  it("a recast's offset is read from the line's own stamp, the miss row (codex 85-tk-N-T112-1 #1)", () => {
    // Cheap Shot cast 53.559, IMMUNE 54.156, the recast cast 54.5 landed 54.564
    const C0 = MATCH_START + 53_559;
    const rogue = makeUnit("enemy-1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          "1833",
          C0,
          "player-1",
          "Paladin",
          "enemy-1",
          "Rogue",
        ),
        makeSpellCastEvent(
          "1833",
          C0 + 941,
          "player-1",
          "Paladin",
          "enemy-1",
          "Rogue",
        ),
      ],
    });
    const player = makeUnit("player-1", {
      name: "Paladin",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "1833", C0 + 1_005),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "1833", C0 + 4_005),
      ],
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [
      {
        spellId: "1833",
        spellName: "Cheap Shot",
        srcUnitId: "enemy-1",
        destUnitId: "player-1",
        missType: "IMMUNE",
        timestamp: C0 + 597,
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: C0 + 597 },
      },
    ];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": rogue, "player-1": player },
    };
    const r = analyzePlayerCCAndTrinket(player, [rogue], combat as never);
    const x = [...(r.ccImmuneUncredited ?? []), ...r.ccAvoidedInstances].find(
      (i) => i.spellName === "Cheap Shot",
    );
    expect(x?.atSeconds).toBe(54.156);
    expect(x?.recastLandedAfterS).toBe(0.4);
  });
});
