/**
 * User rulings 2026-10-21 on the F16 same-round retest's open questions —
 * (2) a mage in Ice Block is no ready kicker (0b72c44e 2:01).
 * ((1) and (3), the `defenseless` cuts, are pinned in t12WindowBoundaries.)
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { castBlockingAuraAt } from "../src/utils/cannotCastIntervals";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ruling (2): Ice Block holds a kicker", () => {
  const mage = () =>
    makeUnit("m", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "45438",
          at(118.842),
          "m",
          "m",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "45438",
          at(124.713),
          "m",
          "m",
          "BUFF",
        ),
      ],
    });
  it("Counterspell is not usable inside the block, and is again after it", () => {
    const u = mage();
    expect(castBlockingAuraAt(u, new Set(), at(121), "2139")?.spellId).toBe(
      "45438",
    );
    expect(castBlockingAuraAt(u, new Set(), at(125), "2139")).toBeUndefined();
    expect(castBlockingAuraAt(u, new Set(), at(118), "2139")).toBeUndefined();
  });
});
