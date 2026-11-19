import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ccSpellIds } from "../src/data/spellTags";
import { AOE_CC_SPELL_IDS } from "../src/utils/drAnalysis";

/**
 * T211 (GH #221 g5): `AOE_CC_SPELL_IDS` (which casts are an un-aimed area
 * control) and `ccSpellIds` (what counts as a control) are two hand lists of
 * one fact. They must agree, or the difference must be named here with the
 * ruling that made it.
 */
const AREA_CONTROL_NOT_A_CONTROL: Record<string, string> = {
  // user ruling R48, 2026-11-15 (T125): Earthquake's knockdown is not counted
  // as a control — no [CC ON TEAM] line, no DR chain.
  "77505": "R48: Earthquake's knockdown ruled out of ccSpellIds",
};

describe("AOE_CC_SPELL_IDS against ccSpellIds", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("every area-control id is a control, except the ruled ones", () => {
    const missing = [...AOE_CC_SPELL_IDS].filter((id) => !ccSpellIds.has(id));
    expect(missing.sort()).toEqual(
      Object.keys(AREA_CONTROL_NOT_A_CONTROL).sort(),
    );
  });
  it("an exception that became a control is taken off the list", () => {
    for (const id of Object.keys(AREA_CONTROL_NOT_A_CONTROL)) {
      expect(AOE_CC_SPELL_IDS.has(id), id).toBe(true);
      expect(ccSpellIds.has(id), id).toBe(false);
    }
  });
});
