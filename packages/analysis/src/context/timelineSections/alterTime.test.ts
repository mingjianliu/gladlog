import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { alterTimeReturnSeconds } from "./alterTime";

// triage 2026-09-29 H17: f4da82c5 pressed Alter Time at 131.507 and returned
// at 131.682 — the return (342247) had no line anywhere
const T0 = 1_000_000;
const cast = (
  spellId: string,
  s: number,
  event = LogEvent.SPELL_CAST_SUCCESS,
) => ({
  spellId,
  logLine: { event, timestamp: T0 + s * 1000 },
});

describe("alterTimeReturnSeconds", () => {
  it("finds the return cast after the press", () => {
    const u = {
      spellCastEvents: [cast("342245", 131.507), cast("342247", 131.682)],
    };
    expect(alterTimeReturnSeconds(u as never, 131.507, T0)).toBeCloseTo(
      131.682,
      3,
    );
  });

  it("no return logged, or a return belonging to a later press → null", () => {
    const u = {
      spellCastEvents: [
        cast("342245", 20),
        cast("342245", 80),
        cast("342247", 81),
      ],
    };
    expect(alterTimeReturnSeconds(u as never, 20, T0)).toBeNull();
    expect(alterTimeReturnSeconds(u as never, 80, T0)).toBeCloseTo(81, 3);
  });

  it("a rejected return is not a return", () => {
    const u = {
      spellCastEvents: [cast("342247", 22, LogEvent.SPELL_CAST_FAILED)],
    };
    expect(alterTimeReturnSeconds(u as never, 20, T0)).toBeNull();
  });
});
