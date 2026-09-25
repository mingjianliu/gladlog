/**
 * Response-only save cooldowns (user ruling 2026-09-25 「嗯 不指控」 on C2):
 * Barkskin / Frenzied Regeneration are in the Restoration Druid save roster
 * — a press answers the druid's own crisis — but no accusation may name them.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { cdWasteEvents } from "../src/analysis/candidateFindings";
import { cdHoardedEvents } from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";
import { healerSaveCdRoster } from "../src/data/healerSaveCd";

const OWNER = { id: "d", name: "Druid-R" };
const point = {
  tSec: 60,
  hpPct: 35,
  dmg2s: 0.3,
  attackers2s: 1,
  enemyBurst: false,
  inCC: false,
  dangerous: true,
};
const fr = (casts: number[]) => ({
  spellId: "22842",
  spellName: "Frenzied Regeneration",
  tag: "Defensive",
  cooldownSeconds: 36,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  neverUsed: casts.length === 0,
  responseOnly: true,
});
const tranq = {
  spellId: "740",
  spellName: "Tranquility",
  tag: "Defensive",
  cooldownSeconds: 180,
  casts: [] as { timeSeconds: number }[],
  neverUsed: true,
};

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("response-only saves", () => {
  it("the generated roster carries the flag for Barkskin and Frenzied Regeneration only", () => {
    const roster = healerSaveCdRoster("Restoration Druid")!;
    expect(roster.get("22812")?.responseOnly).toBe(true);
    expect(roster.get("22842")?.responseOnly).toBe(true);
    expect(roster.get("102342")?.responseOnly).toBeUndefined(); // Ironbark
  });

  it("cd-hoarded never names one as ready", () => {
    expect(
      cdHoardedEvents(
        [{ crisisUnit: OWNER, own: true, points: [point] }],
        [fr([])],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("pressing one still answers the crisis (Tranquility is not accused)", () => {
    expect(
      cdHoardedEvents(
        [{ crisisUnit: OWNER, own: true, points: [point] }],
        [tranq, fr([60.5])],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("cd-waste never reports one as never used", () => {
    expect(cdWasteEvents([fr([])], OWNER, 30)).toEqual([]);
  });
});
