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
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

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
  it("an IMMUNE row of a control that landed on them in that second is one component's, not stated (Axe Toss's interrupt, its stun landed)", () => {
    const HOJ = "853";
    const pal = makeUnit("enemy-1", {
      name: "Paladin",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
    });
    const player = makeUnit("player-1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          HOJ,
          AT,
          "enemy-1",
          "player-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          HOJ,
          AT + 5_000,
          "enemy-1",
          "player-1",
        ),
      ],
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [
      {
        spellId: HOJ,
        spellName: "Hammer of Justice",
        srcUnitId: "enemy-1",
        destUnitId: "player-1",
        missType: "IMMUNE",
        timestamp: AT + 3,
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT + 3 },
      },
    ];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": pal, "player-1": player },
    };
    const r = analyzePlayerCCAndTrinket(player, [pal], combat as never);
    expect(r.ccInstances.map((c) => c.spellName)).toEqual([
      "Hammer of Justice",
    ]);
    expect(r.ccImmuneUncredited ?? []).toEqual([]);
  });
  it("T120 (f22d547e 1:35): a Hammer of Justice logged MISS, nothing credited → one uncredited row of type MISS, by the cast sweep and by the row sweep", () => {
    const HOJ = "853";
    const miss = {
      spellId: HOJ,
      spellName: "Hammer of Justice",
      srcUnitId: "enemy-1",
      destUnitId: "player-1",
      missType: "MISS",
      timestamp: AT,
      logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT },
    };
    for (const withCast of [true, false]) {
      const pal = makeUnit("enemy-1", {
        name: "Paladin",
        spec: CombatUnitSpec.Paladin_Retribution,
        reaction: CombatUnitReaction.Hostile,
        spellCastEvents: withCast
          ? [
              makeSpellCastEvent(
                HOJ,
                AT,
                "player-1",
                "Priest",
                "enemy-1",
                "Paladin",
              ),
            ]
          : [],
      });
      (pal as unknown as { missesOut: unknown[] }).missesOut = [miss];
      const player = makeUnit("player-1", {
        name: "Priest",
        spec: CombatUnitSpec.Priest_Holy,
        reaction: CombatUnitReaction.Friendly,
      });
      (player as unknown as { missesIn: unknown[] }).missesIn = [miss];
      const combat = {
        startTime: MATCH_START,
        endTime: MATCH_START + 300_000,
        startInfo: { zoneId: "1672" },
        units: { "enemy-1": pal, "player-1": player },
      };
      const r = analyzePlayerCCAndTrinket(player, [pal], combat as never);
      expect(
        r.ccImmuneUncredited?.map((x) => [x.spellName, x.missType]),
        `withCast=${withCast}`,
      ).toEqual([["Hammer of Justice", "MISS"]]);
    }
  });
  it("T120 605 re-capture: a reflected control taken by the row sweep is no uncredited row and no new credit — its [REFLECTED] line states it", () => {
    const row = {
      spellId: "118",
      spellName: "Polymorph",
      srcUnitId: "enemy-1",
      destUnitId: "player-1",
      missType: "REFLECT",
      timestamp: AT,
      logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT },
    };
    const mage = makeUnit("enemy-1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
      reaction: CombatUnitReaction.Hostile,
    });
    (mage as unknown as { missesOut: unknown[] }).missesOut = [row];
    const player = makeUnit("player-1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Fury,
      reaction: CombatUnitReaction.Friendly,
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [row];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": mage, "player-1": player },
    };
    const r = analyzePlayerCCAndTrinket(player, [mage], combat as never);
    expect(r.ccImmuneUncredited ?? []).toEqual([]);
    expect(
      r.ccAvoidedInstances.filter((x) => x.spellName === "Polymorph"),
    ).toEqual([]);
  });
  it("codex 85-tk-L-T120-2 #1: a reflected silence (no [REFLECTED] line prints for it) keeps its uncredited row", () => {
    const row = {
      spellId: "15487",
      spellName: "Silence",
      srcUnitId: "enemy-1",
      destUnitId: "player-1",
      missType: "REFLECT",
      timestamp: AT,
      logLine: { event: LogEvent.SPELL_MISSED, timestamp: AT },
    };
    const priest = makeUnit("enemy-1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Shadow,
      reaction: CombatUnitReaction.Hostile,
    });
    (priest as unknown as { missesOut: unknown[] }).missesOut = [row];
    const player = makeUnit("player-1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Fury,
      reaction: CombatUnitReaction.Friendly,
    });
    (player as unknown as { missesIn: unknown[] }).missesIn = [row];
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": priest, "player-1": player },
    };
    const r = analyzePlayerCCAndTrinket(player, [priest], combat as never);
    expect(
      (r.ccImmuneUncredited ?? []).map((x) => [x.spellName, x.missType]),
    ).toEqual([["Silence", "REFLECT"]]);
  });
  it("codex 85-tk-L-T120-1: a MISS of a silence that landed, or a periodic MISS, is no failed control", () => {
    const rogue = makeUnit("enemy-1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Assassination,
      reaction: CombatUnitReaction.Hostile,
    });
    const row = (spellId: string, name: string, event: LogEvent) => ({
      spellId,
      spellName: name,
      srcUnitId: "enemy-1",
      destUnitId: "player-1",
      missType: "MISS",
      timestamp: AT,
      logLine: { event, timestamp: AT },
    });
    const run = (auras: unknown[], miss: unknown) => {
      const player = makeUnit("player-1", {
        name: "Priest",
        spec: CombatUnitSpec.Priest_Holy,
        reaction: CombatUnitReaction.Friendly,
        auraEvents: auras as never,
      });
      (player as unknown as { missesIn: unknown[] }).missesIn = [miss];
      const combat = {
        startTime: MATCH_START,
        endTime: MATCH_START + 300_000,
        startInfo: { zoneId: "1672" },
        units: { "enemy-1": rogue, "player-1": player },
      };
      return (
        analyzePlayerCCAndTrinket(player, [rogue], combat as never)
          .ccImmuneUncredited ?? []
      );
    };
    // Garrote - Silence landed in that second
    expect(
      run(
        [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "1330",
            AT - 200,
            "enemy-1",
            "player-1",
          ),
        ],
        row("1330", "Garrote - Silence", LogEvent.SPELL_MISSED),
      ),
    ).toEqual([]);
    // control: no aura → the MISS is stated
    expect(
      run([], row("1330", "Garrote - Silence", LogEvent.SPELL_MISSED)).length,
    ).toBe(1);
    // a periodic MISS
    expect(
      run([], row("1330", "Garrote - Silence", LogEvent.SPELL_PERIODIC_MISSED)),
    ).toEqual([]);
  });
});
