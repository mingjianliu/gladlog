/**
 * fact3 D43 (8888b780 r3 1:57): under Aspect of the Turtle its holder cannot
 * attack — a single-target damaging spell on an enemy (Scatter Shot) is
 * locked; a pet command (Intimidation) and a ground trap are not.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { castingLockIntervalsOf } from "../src/utils/castingLocks";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const TURTLE = "186265";
const combat = { startTime: T0, endTime: T0 + 180_000 };

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ATTACK_LOCK_AURA_IDS — Aspect of the Turtle", () => {
  const hunter = makeUnit("hunter-1", {
    name: "Hunter",
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        TURTLE,
        T0 + 116_578,
        "hunter-1",
        "hunter-1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        TURTLE,
        T0 + 122_062,
        "hunter-1",
        "hunter-1",
        "BUFF",
      ),
    ],
  });
  it("locks Scatter Shot for the Turtle's span", () => {
    expect(
      castingLockIntervalsOf(hunter as never, combat, "213691").map((l) => [
        l.from - T0,
        l.to - T0,
      ]),
    ).toEqual([[116_578, 122_062]]);
  });
  it("leaves Intimidation, Freezing Trap and an unnamed question alone", () => {
    for (const id of ["474421", "187650", undefined])
      expect(castingLockIntervalsOf(hunter as never, combat, id)).toEqual([]);
  });
});
