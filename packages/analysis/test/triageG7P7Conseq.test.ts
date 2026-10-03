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
