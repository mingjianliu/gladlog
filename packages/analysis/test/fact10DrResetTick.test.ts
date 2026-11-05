/**
 * fact10 D9 (11890839 0:52): the 12.1 DR reset is checked on a server tick.
 * A Storm Bolt 20.012 s after the stun family's last control ended ran
 * 1.52 s of its 3 s — the log says 50 %, the walk said Full. Inside
 * DR_RESET_TICK_MS after the reset window the control's own logged length
 * decides; without one (or with a length that says neither) the reset stands.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ccFullDurationForCaster } from "../src/utils/ccDuration";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  computeIncomingDR,
  DR_RESET_CUTOVER_EPOCH_MS,
  DR_RESET_MS_121,
  DR_RESET_TICK_MS,
  drLevelAtLanding,
  getDRLevel,
  getDRLevelAtTime,
  isDiminishedLength,
} from "../src/utils/drAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

// a 12.1 epoch: the reset window is 20 s
const T0 = DR_RESET_CUTOVER_EPOCH_MS + 86_400_000;
const VOID_NOVA = "1234195";
const STORM_BOLT = "132169";
const nova = { applyMs: T0, removeMs: T0 + 4_010, spellId: VOID_NOVA };
const boltAt = T0 + 4_010 + 20_012;

describe("DR reset tick band (fact10 D9)", () => {
  it("the band is 400 ms after the 20 s window", () => {
    expect(DR_RESET_MS_121).toBe(20_000);
    expect(DR_RESET_TICK_MS).toBe(400);
  });

  it("a length at half the full one reads diminished, at the full one not, else neither", () => {
    expect(isDiminishedLength(1_520, 3_000)).toBe(true);
    expect(isDiminishedLength(3_000, 3_000)).toBe(false);
    expect(isDiminishedLength(2_200, 3_000)).toBeUndefined();
    expect(isDiminishedLength(1_520, undefined)).toBeUndefined();
  });

  it("20.012 s after the chain's end a 1.52 s Storm Bolt of 3 s is 50 %", () => {
    const r = getDRLevel([nova], boltAt, {
      applyMs: boltAt,
      removeMs: boltAt + 1_520,
      fullMs: 3_000,
    });
    expect(r).toEqual({ level: "50%", sequenceIndex: 1 });
  });

  it("the same landing that ran its full length, or with no full length known, reset", () => {
    expect(
      getDRLevel([nova], boltAt, {
        applyMs: boltAt,
        removeMs: boltAt + 3_000,
        fullMs: 3_000,
      }).level,
    ).toBe("Full");
    expect(
      getDRLevel([nova], boltAt, { applyMs: boltAt, removeMs: boltAt + 1_520 })
        .level,
    ).toBe("Full");
    // a point query (no landing) resets as before
    expect(getDRLevel([nova], boltAt).level).toBe("Full");
  });

  it("past the band the reset stands whatever the length", () => {
    const late = nova.removeMs + DR_RESET_MS_121 + DR_RESET_TICK_MS;
    expect(
      getDRLevel([nova], late, {
        applyMs: late,
        removeMs: late + 1_500,
        fullMs: 3_000,
      }).level,
    ).toBe("Full");
  });

  it("the chain walk reads its members' lengths too: the 50 % bolt keeps the next stun on the chain", () => {
    const bolt = {
      applyMs: boltAt,
      removeMs: boltAt + 1_520,
      spellId: STORM_BOLT,
      fullMs: 3_000,
    };
    // 19.755 s after the bolt: on the chain — two members → Immune
    expect(getDRLevel([nova, bolt], bolt.removeMs + 19_755).level).toBe(
      "Immune",
    );
    // the bolt read as Full (no full length) would have started a new chain
    const { fullMs: _drop, ...boltNoFull } = bolt;
    void _drop;
    expect(getDRLevel([nova, boltNoFull], bolt.removeMs + 19_755).level).toBe(
      "50%",
    );
  });

  it("a control that landed was never Immune: on a chain of two the band reads its own length (GH #191, #190)", () => {
    // Intimidation Full, Binding Shot 50 %, then an Intimidation 20.178 s
    // after the chain's end
    const first = { applyMs: T0, removeMs: T0 + 3_000, spellId: "24394" };
    const second = {
      applyMs: T0 + 21_000,
      removeMs: T0 + 22_500,
      spellId: "117526",
    };
    const at = second.removeMs + 20_178;
    // the game ended it at half its length: the game's chain was one shorter
    // than the walk's — the second of it, 50 % (605: Psychic Scream 3.00 s of
    // 6, Cheap Shot 2.04 s of 4, both printed Full)
    expect(
      getDRLevel([first, second], at, {
        applyMs: at,
        removeMs: at + 1_490,
        fullMs: 3_000,
      }).level,
    ).toBe("50%");
    // its full length: it started over
    expect(
      getDRLevel([first, second], at, {
        applyMs: at,
        removeMs: at + 3_000,
        fullMs: 3_000,
      }).level,
    ).toBe("Full");
    // a forced end carries no full length (`ccLengthIsDrEvidence` — cover set
    // 31-2 r2 1:39: Blessing of Sanctuary cut it at 1.49 s of 3 s): the
    // band resets, never Immune
    expect(
      getDRLevel([first, second], at, {
        applyMs: at,
        removeMs: at + 1_490,
      }).level,
    ).toBe("Full");
  });

  it("a chain member the game ended at half its length in the band is the second of a chain, not a new one (GH #191)", () => {
    const first = { applyMs: T0, removeMs: T0 + 3_000, spellId: "24394" };
    const second = {
      applyMs: T0 + 21_000,
      removeMs: T0 + 22_500,
      spellId: "117526",
    };
    // a third member 20.1 s after the chain of two, run at half its length
    const third = {
      applyMs: second.removeMs + 20_100,
      removeMs: second.removeMs + 20_100 + 1_500,
      spellId: "24394",
      fullMs: 3_000,
    };
    // a fourth control right after it: the chain is two long → Immune
    expect(
      getDRLevel([first, second, third], third.removeMs + 1_000).level,
    ).toBe("Immune");
    // the third with no length evidence started a new chain → 50 %
    const { fullMs: _f, ...thirdForced } = third;
    void _f;
    expect(
      getDRLevel([first, second, thirdForced], third.removeMs + 1_000).level,
    ).toBe("50%");
  });

  it("drLevelAtLanding and computeIncomingDR carry the landing's full length", () => {
    const bolt = {
      applyMs: boltAt,
      removeMs: boltAt + 1_520,
      spellId: STORM_BOLT,
      srcUnitId: "warrior",
      fullMs: 3_000,
    };
    expect(
      drLevelAtLanding([nova, bolt], {
        applyMs: boltAt,
        spellId: STORM_BOLT,
        srcUnitId: "warrior",
      }),
    ).toBe("50%");
    const s = (ms: number) => (ms - T0) / 1000;
    const incoming = computeIncomingDR(
      [
        { atSeconds: 0, durationSeconds: 4.01, spellId: VOID_NOVA },
        {
          atSeconds: s(boltAt),
          durationSeconds: 1.52,
          spellId: STORM_BOLT,
          fullSeconds: 3,
        },
      ],
      T0,
    );
    expect(incoming.map((d) => d?.level)).toEqual(["Full", "50%"]);
    const noFull = computeIncomingDR(
      [
        { atSeconds: 0, durationSeconds: 4.01, spellId: VOID_NOVA },
        { atSeconds: s(boltAt), durationSeconds: 1.52, spellId: STORM_BOLT },
      ],
      T0,
    );
    expect(noFull.map((d) => d?.level)).toEqual(["Full", "Full"]);
  });

  it("the Q2 point query reads the instances' own length evidence (codex 20-F25-04 #1, 11890839 r0 54.818)", () => {
    const s = (ms: number) => (ms - T0) / 1000;
    const stun = { category: "Stun", level: "Full" as const, sequenceIndex: 0 };
    const instances = [
      { atSeconds: 0, durationSeconds: 4.01, drInfo: stun },
      {
        atSeconds: s(boltAt),
        durationSeconds: 1.52,
        drInfo: { ...stun, level: "50%" as const, sequenceIndex: 1 },
        drFullSeconds: 3,
      },
    ];
    const at = s(boltAt) + 1.52 + 0.5;
    expect(getDRLevelAtTime(instances, "Stun", at, T0)).toBe("Immune");
    const { drFullSeconds: _d, ...noEvidence } = instances[1]!;
    void _d;
    expect(getDRLevelAtTime([instances[0]!, noEvidence], "Stun", at, T0)).toBe(
      "50%",
    );
  });

  it("a control a damage break ended at half its length is no DR evidence (codex 20-F25-04 #2)", () => {
    const POLY = "118";
    const fullS = ccFullDurationForCaster(POLY, undefined)!;
    const at = (sec: number) => T0 + Math.round(sec * 1000);
    const bAt = fullS + 20.1;
    const bEnd = bAt + fullS / 2;
    const run = (broken: boolean) => {
      const mage = makeUnit("mage-1", {
        name: "Mage",
        spec: CombatUnitSpec.Mage_Frost,
        reaction: CombatUnitReaction.Hostile,
      });
      const rogue = makeUnit("rogue-1", {
        name: "Rogue",
        spec: CombatUnitSpec.Rogue_Assassination,
        reaction: CombatUnitReaction.Hostile,
      });
      const priest = makeUnit("player-1", {
        name: "Priest",
        spec: CombatUnitSpec.Priest_Discipline,
        reaction: CombatUnitReaction.Friendly,
        auraEvents: [
          makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, at(0), "mage-1"),
          makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, at(fullS), "mage-1"),
          makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, at(bAt), "mage-1"),
          ...(broken
            ? [
                makeAuraEvent(
                  LogEvent.SPELL_AURA_BROKEN,
                  POLY,
                  at(bEnd),
                  "rogue-1",
                ),
              ]
            : []),
          makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, at(bEnd), "mage-1"),
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            POLY,
            at(bEnd + 1),
            "mage-1",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            POLY,
            at(bEnd + 1 + fullS / 4),
            "mage-1",
          ),
        ],
      });
      const combat = {
        startTime: T0,
        endTime: T0 + 300_000,
        startInfo: { zoneId: "1672" },
        units: { [priest.id]: priest, [mage.id]: mage, [rogue.id]: rogue },
      };
      return analyzePlayerCCAndTrinket(
        priest,
        [mage, rogue],
        combat as never,
        [],
      )
        .ccInstances.filter((c) => c.spellId === POLY)
        .map((c) => [c.drInfo?.level, c.drFullSeconds]);
    };
    // broken at half: no evidence, the second reset the chain
    expect(run(true)).toEqual([
      ["Full", fullS],
      ["Full", undefined],
      ["50%", fullS],
    ]);
    // ran out at half by itself: its length says 50 %
    expect(run(false).map((r) => r[0])).toEqual(["Full", "50%", "Immune"]);
  });
});
