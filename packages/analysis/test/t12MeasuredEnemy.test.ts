/**
 * FT-T12 D2 (user ruling 2026-10-10, "option C"): a STAYED IN / KITED span
 * measures its start, end and peak distance to ONE enemy — the one that dealt
 * the most landed damage to the owner over the span (`spanMeasuredEnemy`) —
 * and falls back, for the whole span, to the nearest enemy at each instant
 * when no enemy damage landed, on a tie, or when that enemy has no distance
 * at an endpoint. The 12 yd entry gate reads the measured enemy.
 *
 * The shape under test is s0/1-6-16: a druid went 3 → 21.9 yd while a paladin
 * closed to 1.2 yd, and the line read "stayed in 3→1.2".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildFindingsPrompt } from "../src/analysis/buildFindingsPrompt";
import { positionMistakeEvents } from "../src/analysis/candidateFindings";
import {
  CLOSE_RANGE_YARDS,
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
  type IPositionEvent,
  KITED_SECTION_HEADER,
  spanMeasuredEnemy,
  STAYED_IN_SECTION_HEADER,
} from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
const END = T0 + 60_000;

/** A unit sampled every half second; `untilS` cuts its position stream. */
function unit(
  id: string,
  name: string,
  spec: CombatUnitSpec,
  xAt: (s: number) => number,
  untilS = 60,
): any {
  const advancedActions = [];
  for (let ms = 0; ms <= untilS * 1000; ms += 500)
    advancedActions.push({
      timestamp: T0 + ms,
      logLine: { timestamp: T0 + ms },
      advanced: true,
      advancedActorCurrentHp: 30,
      advancedActorMaxHp: 100,
      advancedActorPositionX: xAt(ms / 1000),
      advancedActorPositionY: 0,
      advancedActorPowers: [],
    });
  return {
    id,
    name,
    spec,
    advancedActions,
    deathRecords: [],
    damageOut: [],
    damageIn: [],
  };
}

const hit = (s: number, srcUnitId: string, amount: number): any => ({
  logLine: { timestamp: T0 + s * 1000 },
  timestamp: T0 + s * 1000,
  srcUnitId,
  effectiveAmount: -amount,
});

const burst = (from: number, to: number): any => ({
  fromSeconds: from,
  toSeconds: to,
  activeCDs: [],
  threatScore: 1,
  threatLabel: "High",
  dangerScore: 1,
  dangerLabel: "High",
  dampeningPct: 0,
  damageInWindow: 0,
  damageRatio: 0,
  healerCCed: false,
  mostPressuredTarget: {
    unitName: "Owner-R-US",
    startHpPct: 100,
    midHpPct: 50,
    endHpPct: 30,
  },
});

const run = (owner: any, enemies: any[], extraUnits: any[] = []) =>
  computeOwnerPositionEvents({
    owner,
    enemies,
    combat: {
      startTime: T0,
      endTime: END,
      units: Object.fromEntries(
        [owner, ...enemies, ...extraUnits].map((u) => [u.id, u]),
      ),
    } as any,
    burstWindows: [burst(10, 20)],
    ownerCooldowns: [],
    isHealer: true,
    ownerIsMelee: false,
  }).filter((e) => e.type === "STAYED_IN" || e.type === "KITED");

const burstLine = (events: IPositionEvent[]) =>
  formatPositionEventsForContext(events).find((l) => l.includes(" burst] "))!;

// ── the s0/1-6-16 shape ────────────────────────────────────────────────────
// The owner walks 0 → −19 over the span. The druid stands at x = 3 (3 → 22 yd).
// The paladin starts 30 yd away, reaches the owner in four seconds and then
// follows 1.2 yd behind.
const ownerX = (t: number) => (t < 10 ? 0 : -Math.min(19, (t - 10) * 1.9));
const paladinX = (t: number) =>
  t < 10 ? 30 : t < 14 ? 30 - (t - 10) * 9.1 : ownerX(t) + 1.2;
const OWNER = (damageIn: any[] = []) => ({
  ...unit("o", "Owner-R-US", CombatUnitSpec.Priest_Holy, ownerX),
  damageIn,
});
const DRUID = (untilS?: number) =>
  unit("druid", "Druid-R-US", CombatUnitSpec.Druid_Feral, () => 3, untilS);
const PALADIN = () =>
  unit("pal", "Pala-R-US", CombatUnitSpec.Paladin_Retribution, paladinX);

describe("the span's measured enemy (FT-T12 D2)", () => {
  it("the old rule on this shape pairs two enemies: no damage ⇒ STAYED IN 3→1.2 from the druid to the paladin", () => {
    const [e, ...rest] = run(OWNER(), [DRUID(), PALADIN()]);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      type: "STAYED_IN",
      startDistanceYards: 3,
      endDistanceYards: 1.2,
      nearestEnemyName: "Druid-R-US",
      endEnemyName: "Pala-R-US",
      startEnemyEndYards: 22,
    });
    expect(e!.topDamagerName).toBeUndefined();
    expect(burstLine([e!])).toContain(
      "3→1.2yd from Druid-R-US→Pala-R-US (Druid-R-US 22yd at the end)",
    );
  });

  it("the druid hit most ⇒ every distance is the druid's: KITED 3→22, peak on the druid", () => {
    const owner = OWNER([hit(12, "druid", 500_000), hit(15, "pal", 100_000)]);
    const [e, ...rest] = run(owner, [DRUID(), PALADIN()]);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      type: "KITED",
      startDistanceYards: 3,
      endDistanceYards: 22,
      nearestEnemyName: "Druid-R-US",
      peakEnemyName: "Druid-R-US",
      peakSeconds: 20,
    });
    const line = burstLine([e!]);
    expect(line).toContain("opened 3→22yd from Druid-R-US (peak at 0:20)");
    expect(line).not.toContain("Pala-R-US");
  });

  it("the paladin hit most and stood 30 yd away at the start ⇒ no line at all, with the druid 3 yd from the owner", () => {
    const owner = OWNER([hit(12, "druid", 100_000), hit(15, "pal", 500_000)]);
    expect(run(owner, [DRUID(), PALADIN()])).toEqual([]);
    // the entry gate is the same constant, read on the measured enemy
    expect(30).toBeGreaterThan(CLOSE_RANGE_YARDS);
  });

  it("a pet's damage counts for its owner when choosing whom to measure", () => {
    const owner = OWNER([
      hit(12, "druid", 300_000),
      hit(15, "pal-pet", 500_000),
    ]);
    const pet = { id: "pal-pet", ownerId: "pal" };
    // the paladin (through the pet) hit most ⇒ measured to the paladin ⇒ none
    expect(run(owner, [DRUID(), PALADIN()], [pet])).toEqual([]);
  });

  it("a tie has no 'the one who hit you most' ⇒ the old rule for the whole span", () => {
    const owner = OWNER([hit(12, "druid", 200_000), hit(15, "pal", 200_000)]);
    const [e] = run(owner, [DRUID(), PALADIN()]);
    expect(e).toMatchObject({
      type: "STAYED_IN",
      startDistanceYards: 3,
      endDistanceYards: 1.2,
      nearestEnemyName: "Druid-R-US",
      endEnemyName: "Pala-R-US",
      // the name-order pick is still printed as a fact; it is not measured
      topDamagerName: "Druid-R-US",
    });
  });

  it("the top damager has no position at the span end ⇒ the old rule for the whole span", () => {
    const owner = OWNER([hit(12, "druid", 500_000), hit(15, "pal", 100_000)]);
    // the druid's position stream stops at 0:12
    const [e] = run(owner, [DRUID(12), PALADIN()]);
    expect(e).toMatchObject({
      type: "STAYED_IN",
      startDistanceYards: 3,
      endDistanceYards: 1.2,
      nearestEnemyName: "Druid-R-US",
      endEnemyName: "Pala-R-US",
      topDamagerName: "Druid-R-US",
    });
  });

  it("the top damager dies inside the span ⇒ the old rule for the whole span", () => {
    const owner = OWNER([hit(12, "druid", 500_000), hit(15, "pal", 100_000)]);
    const druid = { ...DRUID(), deathRecords: [{ timestamp: T0 + 16_000 }] };
    const [e] = run(owner, [druid, PALADIN()]);
    expect(e).toMatchObject({
      type: "STAYED_IN",
      nearestEnemyName: "Druid-R-US",
      endEnemyName: "Pala-R-US",
    });
  });
});

// ── a top damager in close range, another enemy even closer ────────────────
describe("STAYED IN on the enemy that hit the owner most", () => {
  const still = (id: string, name: string, spec: CombatUnitSpec, x: number) =>
    unit(id, name, spec, () => x);
  const owner = {
    ...still("o", "Owner-R-US", CombatUnitSpec.Priest_Holy, 0),
    damageIn: [hit(12, "dk", 600_000), hit(13, "heal", 8_000)],
  };
  const dk = still("dk", "Dk-R-US", CombatUnitSpec.DeathKnight_Unholy, 8);
  const healer = still("heal", "Heal-R-US", CombatUnitSpec.Priest_Holy, 1);

  it("start and end are the top damager's distances, not the nearer healer's", () => {
    const [e, ...rest] = run(owner, [healer, dk]);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      type: "STAYED_IN",
      startDistanceYards: 8,
      endDistanceYards: 8,
      nearestEnemyName: "Dk-R-US",
      endEnemyName: "Dk-R-US",
      topDamagerName: "Dk-R-US",
      // the range stays the nearest of ANY enemy
      minDistanceYards: 1,
      maxDistanceYards: 1,
    });
    expect(e!.startEnemyEndYards).toBeUndefined();
  });

  it("the line names one enemy and prints the any-enemy range beside it; the gate's G4 pattern still reads it", () => {
    const line = burstLine(run(owner, [healer, dk]));
    expect(line).toContain(
      "0:10–0:20 [High burst] 8→8yd from Dk-R-US (nearest enemy 1–1yd over the window)",
    );
    expect(line).toContain(" — most damage to you in the span: Dk-R-US (600k)");
    expect(line).toMatch(
      /^ +(\d+:\d{2})(?:–(\d+:\d{2}))? \[[^\]]+ burst\] (opened )?([\d.]+)→([\d.]+)yd from ([^\s→]+)(?=\s|$)/,
    );
  });

  it("the menu facts follow: enemy = topDamager, no endEnemy, dist / endDist to that enemy", () => {
    const [c] = positionMistakeEvents(run(owner, [healer, dk]), {
      id: "o",
      name: "Owner-R-US",
    });
    expect(c!.facts).toMatchObject({
      kind: "stayed-in",
      enemy: "Dk-R-US",
      topDamager: "Dk-R-US",
      dist: "8",
      endDist: "8",
      minDist: "1",
      maxDist: "1",
    });
    expect("endEnemy" in c!.facts).toBe(false);
  });

  it("without the damage the same geometry is a stay on the healer (the old rule)", () => {
    const [e] = run({ ...owner, damageIn: [] }, [healer, dk]);
    expect(e).toMatchObject({
      type: "STAYED_IN",
      startDistanceYards: 1,
      endDistanceYards: 1,
      nearestEnemyName: "Heal-R-US",
    });
  });
});

describe("spanMeasuredEnemy — one predicate for the producer and the gate (G4d)", () => {
  const still = (id: string, name: string, x: number, untilS?: number) =>
    unit(id, name, CombatUnitSpec.Mage_Frost, () => x, untilS);
  const a = still("a", "Aaa-R-US", 5);
  const b = still("b", "Bbb-R-US", 9);
  const owner = (damageIn: any[]) => ({
    ...still("o", "Owner-R-US", 0),
    damageIn,
  });
  const read = (o: any, enemies: any[], units: any[] = []) =>
    spanMeasuredEnemy(o, enemies, [o, ...enemies, ...units], T0, 10, 20);

  it("returns the enemy with the most landed damage over the rendered seconds, both ends in full", () => {
    const o = owner([
      hit(9.9, "a", 900), // before the first rendered second
      hit(10, "a", 100),
      hit(20.9, "b", 150), // inside the last rendered second
      hit(21, "a", 900), // after it
    ]);
    expect(read(o, [a, b])).toBe(b);
  });

  it("null: no enemy damage, a tie, or no distance at either end", () => {
    expect(read(owner([]), [a, b])).toBeNull();
    expect(read(owner([hit(12, "a", 100), hit(13, "b", 100)]), [a, b])).toBe(
      null,
    );
    const top = [hit(12, "b", 500), hit(13, "a", 100)];
    // b's samples stop at 0:12: a distance at the start, none at the end
    expect(read(owner(top), [a, still("b", "Bbb-R-US", 9, 12)])).toBeNull();
    // the owner's own position unknown at the end
    expect(
      read({ ...still("o", "Owner-R-US", 0, 12), damageIn: top }, [a, b]),
    ).toBeNull();
  });

  it("a tie is read after pets are credited: owner + pet against another enemy", () => {
    const pet = { id: "a-pet", ownerId: "a" };
    const o = owner([
      hit(12, "a", 60),
      hit(12, "a-pet", 40),
      hit(13, "b", 100),
    ]);
    expect(read(o, [a, b], [pet])).toBeNull();
    expect(read(o, [a, b])).toBe(b); // without the pet's owner: 60 < 100
  });
});

describe("the text says who is measured (FT-T12 D2)", () => {
  it("both section headers state the rule and its fallback; STAYED IN keeps the any-enemy range apart", () => {
    for (const h of [STAYED_IN_SECTION_HEADER, KITED_SECTION_HEADER]) {
      expect(h).toContain("the ONE enemy named after 'from'");
      expect(h).toContain(
        "the enemy who dealt you the most damage over the span",
      );
      expect(h).toContain(
        "When no enemy damage landed in the span, two enemies tied for the most, or that enemy had no position at either end",
      );
      // the anchor of a line's own top-damager clause (gate G4c)
      expect(h).not.toContain("most damage to you");
    }
    expect(STAYED_IN_SECTION_HEADER).toContain(
      "'(nearest enemy A–Byd over the window)' is always the nearest of ANY enemy at each second, not the named one",
    );
    expect(STAYED_IN_SECTION_HEADER).toContain(
      "says nothing about whether you moved; see 'you moved'",
    );
    const text = formatPositionEventsForContext([
      {
        type: "STAYED_IN",
        atSeconds: 10,
        toSeconds: 20,
        startDistanceYards: 8,
        endDistanceYards: 8,
        nearestEnemyName: "Dk-R-US",
        dangerLabel: "High",
      },
      {
        type: "KITED",
        atSeconds: 30,
        startDistanceYards: 3,
        endDistanceYards: 22,
        nearestEnemyName: "Dk-R-US",
        dangerLabel: "High",
      },
    ]);
    expect(text).toContain(STAYED_IN_SECTION_HEADER);
    expect(text).toContain(KITED_SECTION_HEADER);
  });

  it("the position-mistake legend describes every distance fact as it is computed, fallback included", () => {
    const p = buildFindingsPrompt(
      [
        {
          id: "position-mistake:o:10:stayed-in",
          type: "position-mistake",
          t: 10,
          unitNames: ["Owner-R-US", "Dk-R-US"],
          facts: { t: "10", kind: "stayed-in", enemy: "Dk-R-US" },
        },
      ],
      "",
      "Holy Priest",
    );
    const legend = p
      .split("\n")
      .find((l) => l.startsWith('- "position-mistake"'))!;
    expect(legend).toContain(
      "facts.enemy = the ONE enemy the span's distances are measured to — the enemy player who dealt the most damage to the owner over the span (facts.topDamager names the same player) — facts.dist yd away at the span start and facts.endDist yd at its end",
    );
    expect(legend).toContain(
      "when no enemy damage landed in the span (no facts.topDamager), two enemies tied for the most, or that enemy had no position at either end, the span reads the nearest enemy at each end instead",
    );
    expect(legend).toContain(
      "facts.endEnemy names that enemy when it is another one",
    );
    expect(legend).toContain(
      "the nearest of ANY enemy at each second, so it can sit below facts.dist when another enemy stood closer than facts.enemy",
    );
    // the old description of facts.enemy as "nearest" without a condition
    expect(legend).not.toContain(
      "facts.enemy = the enemy nearest at the span start",
    );
    expect(legend).not.toContain("an enemy stayed in close range");
  });
});
