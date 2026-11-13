/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t91 `burstRatePastSliceEnd`: a burst window past the slice's end is
 * counted, and it is a violation only while the product's ratio sits under
 * the one the log's own seconds give.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { controlledMs, run, sideDamage } from "../scripts/scan5/t91";

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const END_S = 100;

beforeAll(async () => {
  await ensureAnalysisData();
});

function scan(
  pressS: number,
  opts: { afterEnd?: number[]; stunnedFromS?: number } = {},
) {
  const enemy: any = makeUnit("enemy-1", {
    name: "Warrior",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Fury,
    reaction: CombatUnitReaction.Hostile,
    info: {} as never,
    spellCastEvents: [
      makeSpellCastEvent("1719", at(pressS), "enemy-1", "x", "enemy-1"),
      makeSpellCastEvent("107574", at(pressS), "enemy-1", "x", "enemy-1"),
    ],
  });
  const friend: any = makeUnit("player-1", {
    name: "Friend",
    info: {} as never,
    ...(opts.stunnedFromS === undefined
      ? {}
      : {
          class: CombatUnitClass.Priest,
          spec: CombatUnitSpec.Priest_Holy,
          auraEvents: [
            makeAuraEvent(
              LogEvent.SPELL_AURA_APPLIED,
              "408",
              at(opts.stunnedFromS),
              "enemy-1",
              "player-1",
            ),
          ],
        }),
    damageIn: [
      ...Array.from({ length: END_S }, (_, s) =>
        makeDamageEvent(at(s + 0.5), s >= pressS ? 4000 : 1000, "player-1"),
      ),
      // rows the unit arrays keep after the slice's end
      ...(opts.afterEnd ?? []).map((s) =>
        makeDamageEvent(at(s), 50_000, "player-1"),
      ),
    ],
  });
  const seen: string[] = [];
  let checked = 0;
  let cc = 0;
  run({
    owner: friend,
    players: [enemy, friend],
    legacy: { units: { [enemy.id]: enemy, [friend.id]: friend } },
    start: START,
    end: at(END_S),
    violate: (c: string, kind: string) => seen.push(`${c}|${kind}`),
    bump: (c: string) => {
      if (c === "burstRatePastSliceEnd") checked++;
      else cc++;
    },
  } as any);
  return { checked, cc, seen };
}

describe("scan5/t91 burstRatePastSliceEnd", () => {
  it("reads the side's damage in a span and over the slice, no row after its end", () => {
    const u: any = {
      damageIn: [
        makeDamageEvent(at(1), 10),
        makeDamageEvent(at(9), 30),
        makeDamageEvent(at(11), 500),
      ],
    };
    expect(sideDamage([u], START, 5, 10, 10)).toEqual({
      inSpan: 30,
      total: 40,
    });
  });

  it("a window inside the slice is not counted", () => {
    expect(scan(40)).toEqual({ checked: 0, cc: 0, seen: [] });
  });

  it("a window past the slice's end is counted, and the product's ratio is the log's", () => {
    expect(scan(90)).toEqual({ checked: 1, cc: 0, seen: [] });
  });

  it("…also with rows after the slice's end in the arrays (codex 85-tk-G-T91-1 #1)", () => {
    expect(scan(90, { afterEnd: [100.4, 103, 108] })).toEqual({
      checked: 1,
      cc: 0,
      seen: [],
    });
  });
});

describe("scan5/t91 burstHealerCcPastSliceEnd", () => {
  it("the ms under a control aura, runs merged and an open one closed at the span's end", () => {
    const row = (event: LogEvent, id: string, s: number) =>
      makeAuraEvent(event, id, at(s), "enemy-1", "player-1");
    const u = {
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, "408", 2),
        row(LogEvent.SPELL_AURA_APPLIED, "853", 4),
        row(LogEvent.SPELL_AURA_REMOVED, "408", 6),
        row(LogEvent.SPELL_AURA_REMOVED, "853", 8),
        // not a control
        row(LogEvent.SPELL_AURA_APPLIED, "1719", 8),
        row(LogEvent.SPELL_AURA_APPLIED, "408", 18),
      ],
    };
    // 2–8 s cut to 5–8, then 18–20 still open
    expect(controlledMs(u, at(5), at(20))).toBe(5000);
    expect(controlledMs(u, at(9), at(17))).toBe(0);
  });

  it("a healer stunned through all the slice shows of the window: counted, the score's share is the log's", () => {
    expect(scan(98, { stunnedFromS: 98 })).toEqual({
      checked: 1,
      cc: 1,
      seen: [],
    });
    expect(scan(96, { stunnedFromS: 98 })).toEqual({
      checked: 1,
      cc: 1,
      seen: [],
    });
  });
});
