import { describe, expect, it } from "vitest";

import { isButtonPress } from "../src/utils/castCommitSpans";
import { isPassiveProcCast } from "../src/utils/cooldowns";
import { isNoPlayerPressRow } from "../src/utils/pressRow";
import { makeSpellCastEvent } from "./ported/testHelpers";

/**
 * Pipeline T245 (scan triage 2026-11-22 #42, b14ac981 r1 0:53): with the
 * Spectral Illusion talent 1250378 a Fade press logs a second
 * SPELL_CAST_SUCCESS, 1250385 "Spectral Illusion", 0–1 ms after it; the
 * timeline printed `[YOU] [CAST]   Spectral Illusion` beside the Fade.
 */
describe("T245: Spectral Illusion 1250385 is Fade's talent row, not a press", () => {
  it("is a passive proc cast and has no button in DB2", () => {
    expect(isPassiveProcCast({ spellId: "1250385" })).toBe(true);
    expect(isButtonPress("1250385")).toBe(false);
    // the press itself stays one
    expect(isPassiveProcCast({ spellId: "586" })).toBe(false);
    expect(isButtonPress("586")).toBe(true);
  });

  it("isNoPlayerPressRow drops it and keeps the Fade 1 ms before", () => {
    const fade = makeSpellCastEvent("586", 53_954, "0000000000000000");
    const proc = makeSpellCastEvent("1250385", 53_955, "0000000000000000");
    const rows = [fade, proc] as never[];
    expect(isNoPlayerPressRow(proc as never, rows)).toBe(true);
    expect(isNoPlayerPressRow(fade as never, rows)).toBe(false);
  });
});
