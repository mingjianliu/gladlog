/**
 * Triage 2026-09-29 G7-P7 (cc-dr F-CS1): a healer silence gets a [CONSEQ]
 * line — an open-ended one (no removal before the round end) is clamped to
 * the round end; unclamped, the HP sampler never returned (codex 35-CD-30).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { formatObservedConsequences } from "../src/context/observedConsequences";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cc-dr F-CS1 — an open-ended silence is clamped to the round end", () => {
  it("Garrote silence with no removal before the round end returns a bounded line", () => {
    const START = 1_000_000;
    const healer = makeUnit("h", {
      name: "Healer-R",
      spec: CombatUnitSpec.Priest_Discipline,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "1330",
            START + 10_000,
            "e1",
            "h",
          ),
          spellName: "Garrote - Silence",
        },
      ],
    });
    const mate = makeUnit("m", {
      name: "Mate-R",
      advancedActions: [9_000, 10_000, 11_000, 12_000].map((t, i) =>
        makeAdvancedAction(START + t, 0, 0, 500_000, 500_000 - i * 10_000),
      ),
    });
    const rogue = makeUnit("e1", {
      name: "Rogue-R",
      reaction: CombatUnitReaction.Hostile,
    });
    const lines = formatObservedConsequences({
      combat: {
        startTime: START,
        endTime: START + 12_000,
        units: { h: healer, m: mate, e1: rogue },
      } as never,
      friends: [healer, mate],
      enemies: [rogue],
      friendlyCC: [],
      enemyCC: [],
      labels: { friendly: (n) => n, enemy: (n) => n },
    });
    expect(lines.find((l) => l.includes("(silence)"))).toContain(
      "in Garrote - Silence (silence) for 2s",
    );
  });
});

// User ruling 2026-10-21 (F16 retest idx 15, 0c8b1932 0:43): the start is the
// HP when the control landed, not its second's [STATE] tick
describe("[CONSEQ] start = the reading at the event's own instant", () => {
  it("tick 47 %, healed to 64 % before the silence landed 0.8 s later, low 38 % → a 26-point drop", () => {
    const START = 1_000_000;
    const healer = makeUnit("h", {
      name: "Healer-R",
      spec: CombatUnitSpec.Priest_Discipline,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "1330",
            START + 43_810,
            "e1",
            "h",
          ),
          spellName: "Garrote - Silence",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "1330",
            START + 48_820,
            "e1",
            "h",
          ),
          spellName: "Garrote - Silence",
        },
      ],
    });
    const hp = (t: number, pct: number) =>
      makeAdvancedAction(START + t, 0, 0, 100_000, pct * 1000);
    const mate = makeUnit("m", {
      name: "Mate-R",
      advancedActions: [
        hp(42_861, 47),
        hp(43_378, 64),
        hp(46_000, 50),
        hp(48_120, 38),
        hp(49_000, 40),
      ],
    });
    const rogue = makeUnit("e1", {
      name: "Rogue-R",
      reaction: CombatUnitReaction.Hostile,
    });
    const lines = formatObservedConsequences({
      combat: {
        startTime: START,
        endTime: START + 60_000,
        units: { h: healer, m: mate, e1: rogue },
      } as never,
      friends: [healer, mate],
      enemies: [rogue],
      friendlyCC: [],
      enemyCC: [],
      labels: { friendly: (n) => n, enemy: (n) => n },
    });
    expect(lines.find((l) => l.includes("(silence)"))).toContain(
      "during it: Mate-R 64% → low 38% at 0:48",
    );
  });

  it("a quiet span prints the readings it rests on", () => {
    const START = 1_000_000;
    const healer = makeUnit("h", {
      name: "Healer-R",
      spec: CombatUnitSpec.Priest_Discipline,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "1330",
            START + 10_000,
            "e1",
            "h",
          ),
          spellName: "Garrote - Silence",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "1330",
            START + 13_000,
            "e1",
            "h",
          ),
          spellName: "Garrote - Silence",
        },
      ],
    });
    const mate = makeUnit("m", {
      name: "Mate-R",
      advancedActions: [9_000, 10_500, 12_000].map((t) =>
        makeAdvancedAction(START + t, 0, 0, 100_000, 90_000),
      ),
    });
    const rogue = makeUnit("e1", {
      name: "Rogue-R",
      reaction: CombatUnitReaction.Hostile,
    });
    const lines = formatObservedConsequences({
      combat: {
        startTime: START,
        endTime: START + 60_000,
        units: { h: healer, m: mate, e1: rogue },
      } as never,
      friends: [healer, mate],
      enemies: [rogue],
      friendlyCC: [],
      enemyCC: [],
      labels: { friendly: (n) => n, enemy: (n) => n },
    });
    expect(lines.find((l) => l.includes("(silence)"))).toContain(
      "no teammate dropped 10% or more (Mate-R 90% → low 90% at 0:10)",
    );
  });
});

// fact10 D21 (46eb2199 1:18): an enemy healer's own Hex reflected back onto
// it is DR history only on its summary (ruling A52), and [CONSEQ] reads it
describe("[CONSEQ] — an enemy healer's own control reflected onto it", () => {
  const run = (reflectedOntoSelf: boolean) => {
    const START = 1_000_000;
    const shaman = makeUnit("e1", {
      name: "Shaman-R",
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
    });
    const hp = (t: number, pct: number) =>
      makeAdvancedAction(START + t, 0, 0, 100_000, pct * 1000);
    const druid = makeUnit("e2", {
      name: "Druid-R",
      reaction: CombatUnitReaction.Hostile,
      advancedActions: [hp(78_000, 33), hp(80_000, 20), hp(82_000, 5)],
    });
    const lines = formatObservedConsequences({
      combat: {
        startTime: START,
        endTime: START + 90_000,
        units: { e1: shaman, e2: druid },
      } as never,
      friends: [],
      enemies: [shaman, druid],
      friendlyCC: [],
      enemyCC: [
        {
          playerName: "Shaman-R",
          ccInstances: [],
          drHistoryOnly: [
            {
              atSeconds: 78.155,
              durationSeconds: 5.404,
              spellId: "51514",
              drInfo: { category: "Incapacitate", level: "Full", sequenceIndex: 0 },
              ...(reflectedOntoSelf ? { reflectedOntoSelf: true as const } : {}),
            },
          ],
        } as never,
      ],
      labels: { friendly: (n) => n, enemy: (n) => n },
    });
    return lines.filter((l) => l.includes("[CONSEQ]"));
  };
  it("reads it as a control on the healer", () => {
    const [l] = run(true);
    expect(l).toContain("enemy healer Shaman-R in Hex for 5s");
    expect(l).toContain("Druid-R 33% → low 5%");
  });
  it("a DR-history entry from another source is no control line", () => {
    expect(run(false)).toEqual([]);
  });
});
