import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { reflectOwnIdRowGap } from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import { hasOffensiveSpellActive } from "../src/utils/cooldowns";

const START = 1_000_000;
const aura = (event: string, spellId: string, ms: number) =>
  ({
    logLine: { event, timestamp: ms },
    timestamp: ms,
    spellId,
    spellName: "Deathmark",
    srcUnitId: "rogue",
    srcUnitName: "Rogue",
    destUnitId: "mage",
    destUnitName: "Mage",
    auraType: "DEBUFF",
  }) as never;

describe("a run whose REMOVED the log lost (fact8 D18)", () => {
  beforeAll(() => ensureAnalysisData());

  const unit = {
    id: "mage",
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, "360194", START + 27_800),
      aura(LogEvent.SPELL_AURA_APPLIED, "360194", START + 191_860),
      aura(LogEvent.SPELL_AURA_REMOVED, "360194", START + 202_660),
    ],
    spellCastEvents: [],
  } as never;
  const up = (s: number) =>
    hasOffensiveSpellActive(unit, START + s * 1000, new Set(["rogue"]));

  it("is not closed by the later run's REMOVED", () => {
    expect(up(35)).toBe(true);
    expect(up(70)).toBe(false);
  });

  it("the later run stands", () => {
    expect(up(195)).toBe(true);
    expect(up(203)).toBe(false);
  });
});

describe("which reflect a row under the reflector's id came back from (fact8 D30)", () => {
  const surge = [1000];
  const star = [1272, 1272];

  it("Nether Ward: a REFLECT row behind the return beats one ahead of it", () => {
    expect(reflectOwnIdRowGap("212295", 1201, surge)).toBe(201);
    // the pairing, not the row's distance, sends the 1201 row to the first chain
    expect(
      reflectOwnIdRowGap("212295", 1201, star, new Map([[1201, 1000]])),
    ).toBeGreaterThan(201);
    expect(reflectOwnIdRowGap("212295", 1511, star)).toBe(239);
  });

  it("Spell Reflection: its row leads the REFLECT row, the nearest stands", () => {
    expect(reflectOwnIdRowGap("23920", 994, surge)).toBe(6);
    expect(reflectOwnIdRowGap("23920", 1201, star)).toBe(71);
  });
});
