/**
 * T101 (fact13 D16, 77310154 r0 0:48): a stun the death teardown stripped —
 * Terror of the Skies REMOVED at 48.707 among the dying mage's other auras,
 * UNIT_DIED at 48.772 — read as ended 65 ms before the death, and Alter Time
 * printed `free to press it for the last 0.1s before the death`. A REMOVED
 * inside the unit's death teardown is the strip; the control ran to the
 * death.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  castBlockingAuraIntervals,
  freeMsBefore,
  pressBlockedIntervalsForSpells,
} from "../src/utils/cannotCastIntervals";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const HOJ = "853";
const ALTER_TIME = "342245";
const DEATH = 48_772;

const lethal = (ms: number) => ({
  overkill: 12_000,
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms, parameters: [] },
  timestamp: ms,
  srcUnitId: "enemy-1",
  destUnitId: "owner",
  effectiveAmount: -50_000,
  amount: -50_000,
});

function holder(removedMs: number) {
  return makeUnit("owner", {
    reaction: CombatUnitReaction.Friendly,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        HOJ,
        48_012,
        "enemy-1",
        "owner",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        HOJ,
        removedMs,
        "enemy-1",
        "owner",
      ),
    ],
    damageIn: [lethal(48_707)] as never,
    deathRecords: [{ timestamp: DEATH }] as never,
  });
}

describe("castBlockingAuraIntervals — a control stripped by the death (T101)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const enemies = new Set(["enemy-1"]);

  it("a REMOVED in the teardown runs the control to the UNIT_DIED", () => {
    const [iv] = castBlockingAuraIntervals(holder(48_707), enemies);
    expect(iv!.to).toBe(DEATH);
    // the end's cause is still read off the logged REMOVED: the [SILENCE]
    // "ended at their death" note and the trinket binders match it there
    expect(iv!.removedMs).toBe(48_707);
    const blocked = pressBlockedIntervalsForSpells(
      holder(48_707),
      enemies,
      [ALTER_TIME],
      undefined,
      true,
    );
    expect(freeMsBefore(blocked, DEATH)).toBe(0);
  });

  it("a REMOVED before the teardown is the control's own end", () => {
    const [iv] = castBlockingAuraIntervals(holder(48_500), enemies);
    expect(iv!.to).toBe(48_500);
    expect(iv!.removedMs).toBe(48_500);
  });
});
