/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T03 (user ruling 2026-10-10, decision D7): the `[STATE]` tick has a
 * legend. No line of the prompt defined it before — when the number was
 * read, what a missing unit means, what a missing `enemies` half means. The
 * readings themselves do not move: a tick is still `gridHpPct` at the whole
 * second.
 */
import { CombatUnitSpec, type ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { STATE_LEGEND } from "../src/context/timelineSections/formatTimeline";
import { gridHpPct, HP_SAMPLE_RADIUS_MS } from "../src/utils/cooldowns";
import { makeAdvancedAction, makeUnit } from "./ported/testHelpers";

const emptyDispels = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
} as any;
const baseParams = {
  enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
  ccTrinketSummaries: [] as any[],
  dispelSummary: emptyDispels,
  enemyDispelSummary: emptyDispels,
  enemyCCSummaries: [] as any[],
  friendlyDeaths: [] as any[],
  enemyDeaths: [] as any[],
  pressureWindows: [] as any[],
  healingGaps: [] as any[],
  enemies: [] as ICombatUnit[],
  matchStartMs: 0,
  matchEndMs: 60000,
  isHealer: true,
  outgoingCCChains: [] as any[],
};

/** An owner whose HP reads `at(second)` on every whole second 0..10, plus the
 * samples in between. */
const ownerWith = (
  at: (s: number) => number,
  between: Array<[number, number]> = [],
) =>
  makeUnit("PlayerYou", {
    name: "PlayerYou",
    spec: CombatUnitSpec.Warrior_Fury,
    advancedActions: [
      ...Array.from({ length: 11 }, (_, s) =>
        makeAdvancedAction(s * 1000, 0, 0, 100, at(s)),
      ),
      ...between.map(([s, v]) => makeAdvancedAction(s * 1000, 0, 0, 100, v)),
    ].sort((a, b) => a.timestamp - b.timestamp),
  });
const timeline = (owner: ICombatUnit, seconds: number[]) =>
  buildMatchTimeline({
    ...baseParams,
    owner,
    ownerSpec: "Fury Warrior",
    ownerCDs: [],
    teammateCDs: [],
    friends: [owner],
    allUnits: [owner],
    criticalWindowSeconds: new Set<number>(seconds),
  });
const ticks = (text: string) =>
  text.split("\n").filter((l) => /^\s*\d+:\d\d\s+\[STATE\]/.test(l));

describe("[STATE] legend (FT-T03, ruling D7)", () => {
  it("is printed with the first tick, and says the three things a tick does not", () => {
    const text = timeline(
      ownerWith((s) => (s >= 3 ? 60 : 90)),
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
    );
    expect(ticks(text).length).toBeGreaterThan(0);
    for (const l of STATE_LEGEND) expect(text).toContain(l);
    const legend = STATE_LEGEND.join("\n");
    // when the number was read, and that the second's events come after it
    expect(legend).toContain("at the START of second m:ss");
    expect(legend).toContain("AFTER the tick");
    // a missing unit: full health, or no reading inside the shared radius
    expect(HP_SAMPLE_RADIUS_MS).toBe(3000);
    expect(legend).toContain(
      "at full health or has no HP reading within 3 s of that second",
    );
    // a missing enemies half
    expect(legend).toContain(
      "no `enemies` half says nothing about the enemies",
    );
    // the legend comes before the timeline's own lines
    expect(text.indexOf(STATE_LEGEND[0]!)).toBeLessThan(
      text.indexOf(ticks(text)[0]!),
    );
  });

  it("no tick printed → no legend", () => {
    // full health throughout: a unit at 100 % is not listed, so no tick line
    const text = timeline(
      ownerWith(() => 100),
      [0, 1, 2, 3],
    );
    expect(ticks(text)).toEqual([]);
    expect(text).not.toContain(STATE_LEGEND[0]);
  });

  it("the readings did not move: a tick is still `gridHpPct` at the whole second, whatever happened inside it", () => {
    // 60 on every whole second from 0:03; 8 % at 3.4 s only
    const owner = ownerWith((s) => (s >= 3 ? 60 : 90), [[3.4, 8]]);
    const text = timeline(owner, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const at3 = ticks(text).find((l) => l.trimStart().startsWith("0:03"));
    expect(at3).toBeDefined();
    expect(gridHpPct(owner, 3000)).toBe(60);
    expect(at3).toMatch(/:60\b/);
    expect(ticks(text).join("\n")).not.toMatch(/:8\b/);
  });
});
