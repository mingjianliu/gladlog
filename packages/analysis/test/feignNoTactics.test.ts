import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  FEIGN_TACTICS_PAIR_MS,
  feignsWithoutTacticsMs,
} from "../src/utils/castStopEvidence";
import {
  ENEMY_SAVE_ALT_EFFECT_BY_NAME,
  enemyDefensiveEventsUncached,
  enemySaveEffectNote,
  enemySaveEffectOfNote,
  FEIGN_NO_TACTICS_NOTE,
} from "../src/utils/enemyDefensives";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

/**
 * Pipeline T324 (ruling R40, user 2026-11-14: Feign Death is a defensive;
 * wording (A), user 2026-11-28): a Feign Death that put up no Survival
 * Tactics shield leaves only its `UNIT_DIED … unconscious=1` row and printed
 * no `[ENEMY DEF]` line (605: 81 rows, 27 facts, scan5/t65 feignNoTactics).
 */
describe("Feign Death without Survival Tactics (T324)", () => {
  const unconscious = (ms: number) => ({
    logLine: { event: "UNIT_DIED", timestamp: ms, parameters: [] },
    timestamp: ms,
  });
  const tactics = (ms: number) =>
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "202748",
      ms,
      "hunter-1",
      "hunter-1",
      "BUFF",
    );
  const hunter = (
    over: Pick<
      NonNullable<Parameters<typeof makeUnit>[1]>,
      "auraEvents" | "unconsciousRecords"
    >,
  ) =>
    makeUnit("hunter-1", {
      name: "Hunter",
      class: CombatUnitClass.Hunter,
      spec: CombatUnitSpec.Hunter_BeastMastery,
      reaction: CombatUnitReaction.Hostile,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [],
      ...over,
    });

  it("an unconscious row with no shield beside it is a bare feign; one with its shield is not", () => {
    const u = hunter({
      auraEvents: [tactics(40_004)],
      unconsciousRecords: [unconscious(20_000), unconscious(40_000)],
    });
    expect(feignsWithoutTacticsMs(u)).toEqual([20_000]);
    // the pairing reach is the scan's 1 s
    const far = hunter({
      auraEvents: [tactics(40_000 + FEIGN_TACTICS_PAIR_MS + 1)],
      unconsciousRecords: [unconscious(40_000)],
    });
    expect(feignsWithoutTacticsMs(far)).toEqual([40_000]);
  });

  it("prints a self-save event that drops targets, in the round only; the shielded feign keeps its absorb event alone", () => {
    const u = hunter({
      auraEvents: [
        tactics(40_004),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "202748",
          42_004,
          "hunter-1",
          "hunter-1",
          "BUFF",
        ),
      ],
      unconsciousRecords: [
        unconscious(20_000),
        unconscious(40_000),
        unconscious(95_000),
      ],
    });
    const events = enemyDefensiveEventsUncached(
      u,
      [u],
      { startTime: 0, endTime: 120_000 },
      90_000,
    ).filter((e) => e.spellName === "Feign Death");
    expect(
      events.map((e) => [e.atSeconds, e.kind, e.effect, e.spellId]),
    ).toEqual([
      [20, "self-save", "drops targets", "5384"],
      [40.004, "self-save", "absorb", "202748"],
    ]);
    // no length to print, no amount
    expect(events[0]!.observedSeconds).toBeUndefined();
    expect(events[0]!.absorbedAmount).toBeUndefined();
  });

  it("the note is the approved wording, and the gate's reader reads it back as that effect", () => {
    expect(FEIGN_NO_TACTICS_NOTE).toBe(
      "drops targets; no absorb without Survival Tactics",
    );
    expect(enemySaveEffectNote("drops targets", undefined, "")).toBe(
      FEIGN_NO_TACTICS_NOTE,
    );
    expect(
      enemySaveEffectOfNote(`(${FEIGN_NO_TACTICS_NOTE}) (at 97% HP)`),
    ).toBe("drops targets");
    // a bare or altered form is not the note
    expect(
      enemySaveEffectOfNote("(drops targets) (at 97% HP)"),
    ).toBeUndefined();
    expect(enemySaveEffectOfNote("(absorb 25k, 2.0s)")).toBe("absorb");
    expect(ENEMY_SAVE_ALT_EFFECT_BY_NAME.get("Feign Death")).toBe(
      "drops targets",
    );
  });
});
