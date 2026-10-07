/**
 * B-tier B24b (user ruling 2026-10-06): a stayed-in position-mistake names
 * who dealt the most damage to the owner over the span (`topDamager`), beside
 * who merely stood nearest (`enemy` / `endEnemy`, kept). 2abc9185 @81: the
 * nearest enemy was a Holy Priest (8k of the damage); the damage came from
 * two DPS. One predicate — `topEnemyDamagerInSpan` — for the rendered STAYED
 * IN line, the menu fact and the positioning gate (G4c).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { positionMistakeEvents } from "../src/analysis/candidateFindings";
import {
  formatPositionEventsForContext,
  topDamagerClause,
  topEnemyDamagerInSpan,
} from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
const hit = (s: number, srcUnitId: string, amount: number): any => ({
  logLine: { timestamp: T0 + s * 1000 },
  srcUnitId,
  effectiveAmount: -amount,
});
const enemies = [
  { id: "e-priest", name: "Hymnul-R" },
  { id: "e-mage", name: "Oldchill-R" },
  { id: "e-hunter", name: "Irridanz-R" },
];
const units = [
  ...enemies.map((e) => ({ id: e.id, ownerId: undefined })),
  { id: "pet-1", ownerId: "e-hunter" },
  { id: "f-pet", ownerId: "f-lock" },
] as any[];

describe("topEnemyDamagerInSpan", () => {
  it("sums landed damage per enemy player over the rendered seconds, both ends in full", () => {
    const owner = {
      damageIn: [
        hit(80.9, "e-mage", 900_000), // before the span's first second
        hit(81.0, "e-priest", 8_000),
        hit(83.2, "e-mage", 600_000),
        hit(91.99, "e-mage", 495_000), // inside the last rendered second
        hit(92.0, "e-mage", 700_000), // after it
        hit(85, "e-hunter", 776_000),
      ],
    };
    expect(topEnemyDamagerInSpan(owner, enemies, units, T0, 81, 91)).toEqual({
      name: "Oldchill-R",
      damage: 1_095_000,
    });
  });

  it("credits a pet's damage to its owner, and ignores sources that are not an enemy player's", () => {
    const owner = {
      damageIn: [
        hit(82, "e-mage", 300_000),
        hit(83, "pet-1", 250_000),
        hit(84, "e-hunter", 100_000),
        hit(85, "f-pet", 900_000), // a charmed teammate's pet
        hit(86, "owner-self", 900_000), // deferred own damage
      ],
    };
    expect(topEnemyDamagerInSpan(owner, enemies, units, T0, 81, 91)).toEqual({
      name: "Irridanz-R",
      damage: 350_000,
    });
  });

  it("is null when no enemy damage landed, and breaks a tie by name", () => {
    expect(
      topEnemyDamagerInSpan({ damageIn: [] }, enemies, units, T0, 81, 91),
    ).toBeNull();
    const owner = {
      damageIn: [hit(82, "e-mage", 5_000), hit(83, "e-hunter", 5_000)],
    };
    expect(topEnemyDamagerInSpan(owner, enemies, units, T0, 81, 91)!.name).toBe(
      "Irridanz-R",
    );
  });
});

const stayed = (over: Record<string, unknown> = {}): any => ({
  type: "STAYED_IN",
  atSeconds: 81.4,
  toSeconds: 91.4,
  startDistanceYards: 5,
  endDistanceYards: 6,
  minDistanceYards: 4,
  maxDistanceYards: 7,
  nearestEnemyName: "Hymnul-R",
  endEnemyName: "Irridanz-R",
  dangerLabel: "High",
  ownerHpStartPct: 91,
  ownerHpMinPct: 33,
  ...over,
});

describe("stayed-in: the rendered line and the menu fact read the event's topDamager", () => {
  it("menu: topDamager beside enemy / endEnemy, which stay", () => {
    const [e] = positionMistakeEvents(
      [stayed({ topDamagerName: "Oldchill-R", topDamagerDamage: 1_095_000 })],
      { id: "o", name: "Owner-R" },
    );
    expect(e!.facts).toMatchObject({
      kind: "stayed-in",
      enemy: "Hymnul-R",
      endEnemy: "Irridanz-R",
      topDamager: "Oldchill-R",
    });
  });

  it("menu: no fact without the event field, and the listed set does not depend on it", () => {
    const withIt = positionMistakeEvents(
      [stayed({ topDamagerName: "Oldchill-R", topDamagerDamage: 1 })],
      { id: "o", name: "Owner-R" },
    );
    const without = positionMistakeEvents([stayed()], {
      id: "o",
      name: "Owner-R",
    });
    expect("topDamager" in without[0]!.facts).toBe(false);
    expect(withIt.map((e) => e.id)).toEqual(without.map((e) => e.id));
  });

  it("context: the STAYED IN span line carries the clause the gate parses", () => {
    const lines = formatPositionEventsForContext([
      stayed({ topDamagerName: "Oldchill-R", topDamagerDamage: 1_095_400 }),
    ]);
    const line = lines.find((l) => l.includes("[High burst]"))!;
    expect(line).toContain("1:21–1:31 [High burst]");
    expect(line).toContain(topDamagerClause("Oldchill-R", 1_095_400));
    expect(line).toContain(
      " — most damage to you in the span: Oldchill-R (1095k)",
    );
    expect(formatPositionEventsForContext([stayed()]).join("\n")).not.toContain(
      "most damage to you",
    );
  });
});
