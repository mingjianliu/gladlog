import { describe, expect, it } from "vitest";

import { isButtonPress } from "../src/utils/castCommitSpans";
import { isPassiveProcCast } from "../src/utils/cooldowns";
import { isNoPlayerPressRow } from "../src/utils/pressRow";
import { makeSpellCastEvent } from "./ported/testHelpers";

/**
 * Pipeline T152 (fact14 D19, 95d4affb 1:32): the Shadowy Apparitions
 * talent writes a SPELL_CAST_SUCCESS of 341263 with no target; kick-eaten's
 * `postKick` named it as the player's action 2 ms before the Mind Flay:
 * Insanity channel they began.
 */
describe("T152: Shadowy Apparition 341263 is a talent's trigger row, not a press", () => {
  it("is a passive proc cast and has no button in DB2", () => {
    expect(isPassiveProcCast({ spellId: "341263" })).toBe(true);
    expect(isButtonPress("341263")).toBe(false);
  });

  it("isNoPlayerPressRow drops it and keeps the press 2 ms later", () => {
    const proc = makeSpellCastEvent("341263", 92_037, "0000000000000000");
    const press = makeSpellCastEvent("391403", 92_039, "enemy-1");
    const rows = [proc, press] as never[];
    expect(isNoPlayerPressRow(proc as never, rows)).toBe(true);
    expect(isNoPlayerPressRow(press as never, rows)).toBe(false);
  });
});
