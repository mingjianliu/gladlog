/**
 * fact8 class 11 — one press, one kind; a run past a stray refusal. The class
 * checks live in `packages/eval/scripts/scan5/fact8.ts`; these pin the shapes
 * the audit found on rows built by hand.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import {
  ownerRejectRuns,
  pairNetherWardReturns,
  reflectOwnIdRowGap,
} from "../src/context/spellOutcomeLines";
import {
  ENEMY_HEAL_CD_ROSTER_ELSEWHERE,
  isEnemyHealCdFor,
} from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import { dropOnePressAuraTwins } from "../src/utils/burstLedger";
import {
  aimedControlsForKit,
  formatEnemyCCKitHeader,
  parseEnemyCcKitLine,
} from "../src/utils/healerExposureAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ownerRejectRuns — D39", () => {
  const row = (tSeconds: number, reason: string) =>
    ({
      unitGuid: "me",
      spellId: "163201",
      spellName: "Execute",
      tSeconds,
      reason,
    }) as never;
  it("one line-of-sight refusal inside an out-of-range run does not end it", () => {
    const runs = ownerRejectRuns(
      [
        row(10.0, "Out of range"),
        row(10.2, "Target not in line of sight"),
        row(10.35, "Out of range"),
        row(10.7, "Out of range"),
        row(10.9, "Out of range"),
        row(11.1, "Out of range"),
        row(11.3, "Out of range"),
      ],
      "me",
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      count: 6,
      fromSeconds: 10,
      toSeconds: 11.3,
    });
  });
  it("a change of kind that stays changed still splits", () => {
    const runs = ownerRejectRuns(
      [
        row(10, "Out of range"),
        row(10.2, "Out of range"),
        row(10.4, "Out of range"),
        row(10.6, "Target not in line of sight"),
        row(10.8, "Target not in line of sight"),
        row(11, "Target not in line of sight"),
      ],
      "me",
    );
    expect(runs.map((r) => r.count)).toEqual([3, 3]);
  });
});

describe("Frenzied Regeneration — D37", () => {
  it("is a self-save, not a throughput major", () => {
    expect(isEnemyHealCdFor("22842", CombatUnitSpec.Druid_Restoration)).toBe(
      false,
    );
    expect(ENEMY_HEAL_CD_ROSTER_ELSEWHERE["22842"]).toBeDefined();
  });
});

describe("ENEMY CC KIT — D42", () => {
  const hunter = { id: "h", name: "Hunter-A", spec: "253" } as never;
  const miss = (spellId: string, missType: string, timestamp: number) =>
    ({ spellId, missType, timestamp, srcUnitId: "h" }) as never;
  it("a control logged as failing on the unit is on the list, and parses back", () => {
    const aimed = aimedControlsForKit(
      { missesIn: [miss("3355", "IMMUNE", 2000), miss("3355", "MISS", 3000)] },
      [hunter],
      1000,
      9000,
    );
    expect(aimed).toHaveLength(1);
    expect(aimed[0]).toMatchObject({ enemyName: "Hunter-A", count: 2 });
    const [line] = formatEnemyCCKitHeader(
      [
        {
          threats: [
            {
              enemyName: "Mage-B",
              enemySpec: "Frost Mage",
              ccSpellName: "Polymorph",
              ccCategory: "Disorient",
            },
          ],
        } as never,
      ],
      undefined,
      [],
      aimed,
    );
    expect(line).toContain("(aimed at you 2×, never landed)");
    const parsed = parseEnemyCcKitLine(line!);
    expect(parsed?.enemies.map((e) => e.name)).toEqual(["Mage-B", "Hunter-A"]);
    expect(parsed?.enemies[1]?.entries[0]).toMatchObject({ landed: 0 });
  });
  it("a miss outside the round is not counted", () => {
    expect(
      aimedControlsForKit(
        { missesIn: [miss("3355", "IMMUNE", 500)] },
        [hunter],
        1000,
        9000,
      ),
    ).toEqual([]);
  });
});

describe("pairNetherWardReturns — D30", () => {
  it("a row takes the latest reflect behind it no row took", () => {
    // 50-1 2:17's timings
    const p = pairNetherWardReturns(
      [5_000, 5_751, 6_086, 6_855],
      [5_001, 6_086, 6_501],
    );
    expect([...p.entries()]).toEqual([
      [5_001, 5_000],
      [6_086, 6_086],
      [6_501, 5_751],
    ]);
  });
  it("one return to the reflect before it, two of one ms to the two after", () => {
    // 980d8143 1:20
    const p = pairNetherWardReturns([229, 501, 501], [430, 740, 740]);
    expect(p.get(430)).toBe(229);
    expect(p.get(740)).toBe(501);
    expect(reflectOwnIdRowGap("212295", 430, [501, 501], p)).toBeGreaterThan(
      1000,
    );
    expect(reflectOwnIdRowGap("212295", 430, [229], p)).toBe(0);
  });
});

describe("dropOnePressAuraTwins — D1", () => {
  const hit = (spellId: string, startOffsetMs: number, overlapSeconds: number) =>
    ({
      spellId,
      spellName: "Touch of Karma",
      casterName: "Monk",
      startOffsetMs,
      overlapSeconds,
    }) as never;
  it("one press's cast id and aura id are one hit, with the longer overlap", () => {
    const hits = [hit("122470", 1000, 2), hit("125174", 1020, 4)];
    dropOnePressAuraTwins(hits);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ spellId: "122470", overlapSeconds: 4 });
  });
  it("two presses stay two", () => {
    const hits = [hit("122470", 1000, 2), hit("125174", 91_000, 4)];
    dropOnePressAuraTwins(hits);
    expect(hits).toHaveLength(2);
  });
});

describe("[RES] charge change — D34", () => {
  const T0 = 1_700_000_000_000;
  const vanish = {
    spellId: "1856",
    spellName: "Vanish",
    tag: "Defensive",
    cooldownSeconds: 120,
    charges: 2,
    maxChargesDetected: 2,
    casts: [{ timeSeconds: 90 }],
    availableWindows: [],
    neverUsed: false,
  } as never;
  const row = (prev: ReadonlyMap<string, string> | undefined) =>
    buildResourceSnapshot({
      timeSeconds: 108,
      ownerCDs: [vanish],
      ownerName: "Rogue-Realm",
      ownerSpec: "Subtlety Rogue",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      matchStartMs: T0,
      prevReadyNames: ["Vanish"],
      prevChargeSuffixes: prev,
    });
  it("a cooldown that stays ready on fewer charges prints ~X[k/N]", () => {
    expect(row(new Map([["Vanish", "[2/2]"]]))).toContain(
      "rdy:Δ ~Vanish[1/2]",
    );
  });
  it("the same charges print nothing", () => {
    expect(row(new Map([["Vanish", "[1/2]"]]))).not.toContain("~Vanish");
  });
});
