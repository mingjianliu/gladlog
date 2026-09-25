/**
 * Infernal Awakening 22703 (the Summon Infernal landing stun) is a CC: it cuts
 * cast time and renders as CC. It was observed in the corpus but missing from
 * SPELL_CATEGORIES (reliability audit side item, 2026-09-25). It shares no DR
 * family (drShareScan, 1,814 files: full 79 % after a stun, 88 % after
 * disorient / incapacitate), so it keeps the self-DR key and the timeline
 * prints no DR tag for it.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { ccSpellIds } from "../src/data/spellTags";
import { buildCannotCastIntervals } from "../src/utils/cannotCastIntervals";
import { DR_CATEGORY_MAP, getDRCategory } from "../src/utils/drAnalysis";

describe("Infernal Awakening 22703", () => {
  it("is a CC and has no shared DR family", () => {
    expect(ccSpellIds.has("22703")).toBe(true);
    expect(DR_CATEGORY_MAP["22703"]).toBeUndefined();
    expect(getDRCategory("22703")).toBe("spell:22703");
  });

  it("cuts cast time", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        {
          spellId: "22703",
          srcUnitId: "Infernal-1",
          timestamp: 11_830,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "22703",
          srcUnitId: "Infernal-1",
          timestamp: 13_830,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, new Set(["Infernal-1"]))).toEqual([
      { from: 11_830, to: 13_830 },
    ]);
  });
});
