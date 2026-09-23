/**
 * GH #103 A2: the dispel-backlash CC is read from ONE table (data/backlashCc.ts).
 * The old hardcoded `"196364" || "34914"` treated the Vampiric Touch DoT (34914)
 * itself as a backlash CC — every VT application on a teammate became a
 * `[CC ON TEAM] ← Vampiric Touch | 0s [DISPEL BACKLASH CC]` line (2,769 in 3,520
 * archive owner contexts) — while the real VT backlash, 87204 Sin and
 * Punishment, was never tagged.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  BACKLASH_AURA_CC_TYPE,
  BACKLASH_CC_SPELL_IDS,
} from "../src/data/backlashCc";
import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const combat = {
  startTime: MATCH_START,
  endTime: MATCH_START + 300_000,
  startInfo: { zoneId: "1672" },
};

function ccIdsFor(auraId: string, durMs: number): string[] {
  const player = makeUnit("player-1", {
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        auraId,
        MATCH_START + 5_000,
        "enemy-1",
        "player-1",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        auraId,
        MATCH_START + 5_000 + durMs,
        "enemy-1",
        "player-1",
      ),
    ],
  });
  const enemy = makeUnit("enemy-1", {
    name: "EnemyPriest",
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Priest_Shadow,
  });
  return analyzePlayerCCAndTrinket(
    player,
    [enemy],
    combat as any,
  ).ccInstances.map((c) => c.spellId);
}

describe("dispel-backlash CC table (GH #103 A2)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("maps each backlash aura to its CC type", () => {
    expect(BACKLASH_AURA_CC_TYPE.get("196364")).toBe("silence");
    expect(BACKLASH_AURA_CC_TYPE.get("87204")).toBe("horror");
    // the dispelled DoTs themselves are keys, never backlash auras
    for (const dot of BACKLASH_CC_SPELL_IDS.keys())
      expect(BACKLASH_AURA_CC_TYPE.has(dot)).toBe(false);
  });

  it("a Vampiric Touch DoT refresh on a teammate is not a CC", () => {
    // the real-log shape: a ≤4 s apply→remove gap from the DoT's re-application
    expect(ccIdsFor("34914", 1_000)).not.toContain("34914");
    expect(ccIdsFor("34914", 21_000)).not.toContain("34914");
  });

  it("the Vampiric Touch backlash horror (Sin and Punishment) is a CC", () => {
    expect(ccIdsFor("87204", 3_000)).toContain("87204");
  });

  it("the Unstable Affliction backlash silence on the dispeller is a CC", () => {
    expect(ccIdsFor("196364", 4_000)).toContain("196364");
  });
});
