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
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run, sideDamage } from "../scripts/scan5/t91";

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const END_S = 100;

beforeAll(async () => {
  await ensureAnalysisData();
});

function scan(pressS: number) {
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
    damageIn: Array.from({ length: END_S }, (_, s) =>
      makeDamageEvent(at(s + 0.5), s >= pressS ? 4000 : 1000, "player-1"),
    ),
  });
  const seen: string[] = [];
  let checked = 0;
  run({
    owner: friend,
    players: [enemy, friend],
    legacy: { units: { [enemy.id]: enemy, [friend.id]: friend } },
    start: START,
    end: at(END_S),
    violate: (_c: string, kind: string) => seen.push(kind),
    bump: () => {
      checked++;
    },
  } as any);
  return { checked, seen };
}

describe("scan5/t91 burstRatePastSliceEnd", () => {
  it("reads the side's damage in a span and over the slice", () => {
    const u: any = {
      damageIn: [makeDamageEvent(at(1), 10), makeDamageEvent(at(9), 30)],
    };
    expect(sideDamage([u], START, 5, 10)).toEqual({ inSpan: 30, total: 40 });
  });

  it("a window inside the slice is not counted", () => {
    expect(scan(40)).toEqual({ checked: 0, seen: [] });
  });

  it("a window past the slice's end is counted, and the product's ratio is the log's", () => {
    expect(scan(90)).toEqual({ checked: 1, seen: [] });
  });
});
