/**
 * codex 21-R12-a (the round-3 fact batch a7e640cee..03a355dcd) — the
 * findings that held when checked against the code, each pinned here.
 */
import { CombatUnitPowerType } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { deathWindowFreedom } from "../src/utils/deathOutcomeAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("codex 21-R12-a #2: the death window's affordability reads the round's free-cast auras", () => {
  const sample = (t: number, mana: number) => ({
    advancedActorId: "Player-1234",
    logLine: { timestamp: t },
    advancedActorPowers: [
      { type: CombatUnitPowerType.Mana, current: mana, max: 262_500 },
    ],
  });
  const innervate = (event: string, t: number) => ({
    spellId: "29166",
    spellName: "Innervate",
    srcUnitId: "Druid-1",
    srcUnitName: "Druid",
    destUnitId: "Player-1234",
    timestamp: t,
    logLine: { event, timestamp: t },
  });
  const u = {
    id: "Player-1234",
    name: "Healer",
    spec: "270",
    advancedActions: [sample(5_000, 1_398)],
    auraEvents: [
      innervate("SPELL_AURA_APPLIED", 5_000),
      innervate("SPELL_AURA_REMOVED", 12_500),
    ],
  } as never;
  it("a healer at 1.4k mana under Innervate could press Restoral through the window", () => {
    const withBounds = deathWindowFreedom(
      u,
      new Set(),
      0,
      12,
      6,
      "388615",
      undefined,
      { startTime: 0, endTime: 60_000 },
    )!;
    expect(withBounds.longestFreeS).toBeGreaterThanOrEqual(5.9);
    // without the round's bounds the free-cast aura is not read (the bug)
    const without = deathWindowFreedom(u, new Set(), 0, 12, 6, "388615")!;
    expect(without.longestFreeS).toBeLessThan(1);
  });
});

describe("codex 21-R12-a #3: an aura whose REMOVED the log lost is not up forever", () => {
  it("Evasion APPLIED at 10 s, no REMOVED; a fresh one in a re-listing batch at 140 s is a hidden press", async () => {
    const { hiddenPressMs, RESYNC_BATCH_MIN_APPLIED } = await import(
      "../src/utils/hiddenPress"
    );
    const ap = (spellId: string, t: number) => ({
      spellId,
      srcUnitId: "R",
      destUnitId: "R",
      timestamp: t,
      logLine: { event: "SPELL_AURA_APPLIED", timestamp: t },
    });
    const batch = Array.from({ length: RESYNC_BATCH_MIN_APPLIED }, (_, k) =>
      ap(String(900_000 + k), 140_000),
    );
    const unit = {
      id: "R",
      auraEvents: [ap("5277", 10_000), ap("5277", 140_000), ...batch],
      spellCastEvents: [
        {
          spellId: "5277",
          logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 10_000 },
        },
      ],
    } as never;
    expect(hiddenPressMs(unit, "5277", 0)).toEqual([140_000]);
  });
});
