/**
 * Triage 2026-09-29, group G9 — one round end (`utils/roundEnd.ts`
 * `roundEndMs`: a Solo Shuffle round's first player death, else the combat
 * end) for:
 *  - cc-dr F-CI1: `[CC ON TEAM]` / `[CC ON ENEMY]` windows — a CC applied at
 *    or after the end is dropped, a removal after it is clipped to it;
 *  - missed-cleanse F-C3: uncleansed windows clip the same way (ba8c0510:
 *    a Polymorph 0.6 s in the round was a 6 s missed cleanse).
 * cc-dr F-HG1 (healing gaps) is in `ported/healingGaps.test.ts`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { reconstructDispelSummary } from "../src/utils/dispelAnalysis";
import { roundEndMs } from "../src/utils/roundEnd";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const aura = (event: LogEvent, spellId: string, s: number, dest: string) => ({
  ...makeAuraEvent(event, spellId, START + s * 1000, "e1", dest),
  spellName: spellId,
});
const polyOn = (dest: string, fromS: number, toS: number) => [
  aura(LogEvent.SPELL_AURA_APPLIED, "118", fromS, dest),
  aura(LogEvent.SPELL_AURA_REMOVED, "118", toS, dest),
];

/** A Solo Shuffle round whose first player death is at `deathS`. */
function shuffle(deathS: number) {
  const dead = makeUnit("x", {
    info: {},
    deathRecords: [{ timestamp: START + deathS * 1000 }],
  });
  return {
    startTime: START,
    endTime: START + 60_000,
    startInfo: { zoneId: "1672", bracket: "Rated Solo Shuffle" },
    units: { x: dead },
  };
}

describe("roundEndMs", () => {
  it("is the first player death in Solo Shuffle, else the combat end", () => {
    expect(roundEndMs(shuffle(48.327))).toBe(START + 48_327);
    expect(
      roundEndMs({ ...shuffle(48.327), startInfo: { bracket: "3v3" } }),
    ).toBe(START + 60_000);
    expect(roundEndMs({ endTime: START + 60_000 })).toBe(START + 60_000);
  });
});

describe("cc-dr F-CI1 — CC windows end at the round end", () => {
  const enemy = () => makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

  it("a removal after the end is clipped; a CC applied at or after it is dropped", () => {
    const victim = makeUnit("v", {
      auraEvents: [
        // ba8c0510 shape: applied 47.718, removed 53.726, round over at 48.327
        ...polyOn("v", 47.718, 53.726),
        // fd45b5d0 shape: applied after the round-ending death
        ...polyOn("v", 48.964, 54.0),
      ],
    });
    const cc = analyzePlayerCCAndTrinket(
      victim,
      [enemy()],
      shuffle(48.327),
    ).ccInstances;
    expect(cc).toHaveLength(1);
    expect(cc[0].durationSeconds).toBeCloseTo(0.609, 3);
    // no negative window survives
    expect(cc.every((c) => c.durationSeconds >= 0)).toBe(true);

    // control: no Solo Shuffle death → the combat end, both CCs whole
    const plain = analyzePlayerCCAndTrinket(victim, [enemy()], {
      startTime: START,
      endTime: START + 60_000,
      startInfo: { zoneId: "1672" },
    }).ccInstances;
    expect(plain.map((c) => Math.round(c.durationSeconds))).toEqual([6, 5]);
  });
});

describe("missed-cleanse F-C3 — uncleansed windows end at the round end", () => {
  const healer = () =>
    makeUnit("h", { name: "Healer", spec: CombatUnitSpec.Paladin_Holy });
  const enemy = () => makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

  function windows(combat: object) {
    const melee = makeUnit("m", {
      name: "Melee",
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: polyOn("m", 47.718, 53.726),
    });
    return reconstructDispelSummary(
      [healer(), melee] as never,
      [enemy()] as never,
      combat as never,
    ).missedCleanseWindows;
  }

  it("a 6 s Polymorph that ran 0.6 s in the round is no window", () => {
    expect(windows(shuffle(48.327))).toEqual([]);
  });

  it("control: the same Polymorph in a round that ran on is a 6 s window", () => {
    const w = windows({ startTime: START, endTime: START + 60_000 });
    expect(w.map((x) => x.spellId)).toEqual(["118"]);
    expect(w[0].durationSeconds).toBeCloseTo(6.008, 3);
  });
});
