import { describe, expect, test } from "vitest";

import spellIdLists from "../src/data/spellIdLists";
import { EXTERNAL_DEFENSIVE_SPELLS } from "../src/utils/deathOutcomeAnalysis";

describe("deathOutcome 外置表与主白名单收敛(串联腐烂修复)", () => {
  test("键集恒等于 externalDefensiveSpellIds(14 条)", () => {
    expect(Object.keys(EXTERNAL_DEFENSIVE_SPELLS).sort()).toEqual(
      [...spellIdLists.externalDefensiveSpellIds].sort(),
    );
  });
});
