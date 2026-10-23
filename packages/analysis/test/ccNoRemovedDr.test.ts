/**
 * fact3 D33 (5f4142ec r1 1:06): a control the log never closes (its REMOVED
 * swallowed by Mass Invisibility) ends at the length it was going to run, its
 * DR share included — a Leg Sweep at stun DR 50 % is 2 s, not its full 4 s.
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

const T0 = 1_000_000;
const KIDNEY_SHOT = "408";
const LEG_SWEEP = "119381";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("a CC with no REMOVED — fact3 D33", () => {
  it("Leg Sweep at stun DR 50 % with no REMOVED lasts 2 s", () => {
    const monk = makeUnit("monk-1", {
      name: "Monk",
      spec: CombatUnitSpec.Monk_Windwalker,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          LEG_SWEEP,
          T0 + 66_700,
          "0000000000000000",
          "nil",
          "monk-1",
          "Monk",
        ),
      ],
    });
    const rogue = makeUnit("rogue-1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Assassination,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          KIDNEY_SHOT,
          T0 + 59_000,
          "player-1",
          "Priest",
          "rogue-1",
          "Rogue",
        ),
      ],
    });
    const priest = makeUnit("player-1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          KIDNEY_SHOT,
          T0 + 59_000,
          "rogue-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          KIDNEY_SHOT,
          T0 + 63_000,
          "rogue-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          LEG_SWEEP,
          T0 + 66_707,
          "monk-1",
        ),
      ],
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 120_000,
      startInfo: { zoneId: "1672" },
      units: { [priest.id]: priest, [monk.id]: monk, [rogue.id]: rogue },
    };
    const { ccInstances } = analyzePlayerCCAndTrinket(
      priest,
      [monk, rogue],
      combat as never,
      [],
    );
    const sweep = ccInstances.find((c) => c.spellId === LEG_SWEEP)!;
    expect(sweep.drInfo?.level).toBe("50%");
    expect(sweep.durationSeconds).toBeCloseTo(2, 3);
  });

  it("codex 21-R12-a #1: a later unclosed Kidney Shot is settled on the Leg Sweep's settled end — Full, not a 0 s DR-immune window", () => {
    const monk = makeUnit("monk-1", {
      name: "Monk",
      spec: CombatUnitSpec.Monk_Windwalker,
      reaction: CombatUnitReaction.Hostile,
    });
    const rogue = makeUnit("rogue-1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Assassination,
      reaction: CombatUnitReaction.Hostile,
    });
    const ap = (id: string, t: number, src: string) =>
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, id, T0 + t, src);
    const priest = makeUnit("player-1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        ap(KIDNEY_SHOT, 1_000, "rogue-1"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          KIDNEY_SHOT,
          T0 + 5_000,
          "rogue-1",
        ),
        ap(LEG_SWEEP, 10_000, "monk-1"), // no REMOVED: DR 50 % → 2 s
        // no REMOVED. 29 s: within the 16 s (pre-12.1) DR window of the Leg Sweep's FULL end
        // (14 s) but past it from its settled 2 s end (12 s)
        ap(KIDNEY_SHOT, 29_000, "rogue-1"),
      ],
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 120_000,
      startInfo: { zoneId: "1672" },
      units: { [priest.id]: priest, [monk.id]: monk, [rogue.id]: rogue },
    };
    const { ccInstances } = analyzePlayerCCAndTrinket(
      priest,
      [monk, rogue],
      combat as never,
      [],
    );
    const sweep = ccInstances.find((c) => c.spellId === LEG_SWEEP)!;
    expect(sweep.durationSeconds).toBeCloseTo(2, 3);
    const lateKidney = ccInstances.find(
      (c) => c.spellId === KIDNEY_SHOT && c.atSeconds > 20,
    )!;
    expect(lateKidney.drInfo?.level).toBe("Full");
    // at its Full length, not the 25 % one the first-pass DR cut it to
    expect(lateKidney.durationSeconds).toBeGreaterThan(3);
  });
});
