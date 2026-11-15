/**
 * T121 (ruling R46 = A, fcee94ea r0 0:27): only a healer spec's press of a
 * healing amplifier gets the `[HEALING]` block — a Shadow Priest's Power
 * Infusion keeps its `[YOU] [CD]` line and loses the block.
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { pressGetsHealingBlock } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { makeHealEvent, makeUnit } from "./ported/testHelpers";

const PI = "10060";

function timeline(spec: CombatUnitSpec): string {
  const owner = makeUnit("o", {
    name: "Priest-Realm",
    spec,
    class: CombatUnitClass.Priest,
    healOut: [31, 33, 36, 40].map((s) => makeHealEvent(s * 1000, "o", 20_000)),
  });
  return buildMatchTimeline({
    owner,
    ownerSpec: String(spec),
    ownerCDs: [
      {
        spellId: PI,
        spellName: "Power Infusion",
        tag: "Offensive",
        cooldownSeconds: 120,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 30 }],
        availableWindows: [],
        neverUsed: false,
      },
    ],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [],
    dispelSummary: {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      lateCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    },
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner],
    enemies: [],
    matchStartMs: 0,
    matchEndMs: 120_000,
    isHealer: spec !== CombatUnitSpec.Priest_Shadow,
    criticalWindowSeconds: new Set<number>(),
  } as never);
}

describe("T121 — the [HEALING] block is a healer's", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("the predicate gates on the presser's spec", () => {
    expect(
      pressGetsHealingBlock(PI, { spec: CombatUnitSpec.Priest_Holy }),
    ).toBe(true);
    expect(
      pressGetsHealingBlock(PI, { spec: CombatUnitSpec.Priest_Shadow }),
    ).toBe(false);
    expect(
      pressGetsHealingBlock("29166", { spec: CombatUnitSpec.Priest_Holy }),
    ).toBe(false);
  });
  it("a Holy Priest's Power Infusion has its block; a Shadow Priest's keeps the line, no block", () => {
    const holy = timeline(CombatUnitSpec.Priest_Holy);
    expect(holy).toMatch(/\[YOU\] \[CD\]\s+Power Infusion/);
    expect(holy).toContain("[HEALING]");
    const shadow = timeline(CombatUnitSpec.Priest_Shadow);
    expect(shadow).toMatch(/\[YOU\] \[CD\]\s+Power Infusion/);
    expect(shadow).not.toContain("[HEALING]");
  });
});
