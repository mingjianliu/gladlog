/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t91, the known-bad control (codex 85-tk-G-T91-1: the scan's tests
 * held no positive case): with the producer's window distorted, each check
 * reports — a ratio off the log's in either direction, and a healer-control
 * share off the log's.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t91";

const distort = vi.hoisted(() => ({ ratio: 1, score: 1 }));
vi.mock("../../analysis/src/utils/enemyCDs", async (orig) => {
  const real = await orig<typeof import("../../analysis/src/utils/enemyCDs")>();
  return {
    ...real,
    reconstructEnemyCDTimeline: (
      ...args: Parameters<typeof real.reconstructEnemyCDTimeline>
    ) => {
      const t = real.reconstructEnemyCDTimeline(...args);
      return {
        ...t,
        alignedBurstWindows: t.alignedBurstWindows.map((w) => ({
          ...w,
          damageRatio: w.damageRatio * distort.ratio,
          dangerScore: w.dangerScore * distort.ratio * distort.score,
        })),
      };
    },
  };
});

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const END_S = 100;

beforeAll(async () => {
  await ensureAnalysisData();
});

function scan(ratio: number, score = 1) {
  distort.ratio = ratio;
  distort.score = score;
  const enemy: any = makeUnit("enemy-1", {
    name: "Warrior",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Fury,
    reaction: CombatUnitReaction.Hostile,
    info: {} as never,
    spellCastEvents: [
      makeSpellCastEvent("1719", at(96), "enemy-1", "x", "enemy-1"),
      makeSpellCastEvent("107574", at(96), "enemy-1", "x", "enemy-1"),
    ],
  });
  const friend: any = makeUnit("player-1", {
    name: "Friend",
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Holy,
    info: {} as never,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "408",
        at(98),
        "enemy-1",
        "player-1",
      ),
    ],
    damageIn: Array.from({ length: END_S }, (_, s) =>
      makeDamageEvent(at(s + 0.5), s >= 96 ? 4000 : 1000, "player-1"),
    ),
  });
  const seen: string[] = [];
  run({
    owner: friend,
    players: [enemy, friend],
    legacy: { units: { [enemy.id]: enemy, [friend.id]: friend } },
    start: START,
    end: at(END_S),
    violate: (c: string, kind: string) => seen.push(`${c}|${kind}`),
    bump: () => undefined,
  } as any);
  return seen;
}

describe("scan5/t91 — known-bad control", () => {
  it("the producer as it is: nothing", () => {
    expect(scan(1)).toEqual([]);
  });

  it("a ratio under the log's, and one over it, are both reported", () => {
    expect(scan(0.6).join()).toMatch(
      /burstRatePastSliceEnd\|(label reads low|ratio off, same label)/,
    );
    expect(scan(1.4).join()).toMatch(
      /burstRatePastSliceEnd\|(label reads high|ratio off, same label)/,
    );
  });

  it("a healer-control share off the log's is reported", () => {
    // the score alone moved: the share read back off it is no longer 50 %
    expect(scan(1, 0.8)).toContain("burstHealerCcPastSliceEnd|coverage off");
  });
});
