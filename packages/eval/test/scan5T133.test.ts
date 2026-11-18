/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/t133 `pressedInsideSplit` (T133): a `pressed inside` entry on no
 * ready / back list, split by whether the model had the press possible.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t133";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const SMASH = "167105"; // Colossus Smash, 45 s

function scan(castSeconds: number[], line: string) {
  const warrior = makeUnit("P1", {
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: castSeconds.map((s) =>
      makeSpellCastEvent(
        SMASH,
        T + s * 1000,
        "E1",
        "Enemy",
        "P1",
        "P1",
        0,
        "Colossus Smash",
      ),
    ),
  });
  const target = makeUnit("E1", { reaction: CombatUnitReaction.Hostile });
  const kinds: string[] = [];
  let checked = 0;
  run({
    text: line,
    lines: [line],
    start: T,
    owner: warrior,
    players: [warrior, target],
    units: [warrior, target],
    legacy: {
      startTime: T,
      endTime: T + 300_000,
      units: { P1: warrior, E1: target },
    },
    bump: (c: string) => {
      if (c === "pressedInsideSplit") checked++;
    },
    violate: (c: string, k: string) => {
      if (c === "pressedInsideSplit") kinds.push(k);
    },
  } as any);
  return { checked, kinds };
}

describe("scan5 pressedInsideSplit", () => {
  it("back and pressed inside one second, on no list: a line gap", () => {
    expect(
      scan(
        [10.68, 55.88],
        "  [KILL WINDOW] 0:48–1:00 on X (Y): team burst 100k (defenseless 0:48–1:00); team offensive CDs ready at 0:48: none (pressed inside: Colossus Smash 0:55).",
      ),
    ).toEqual({
      checked: 1,
      kinds: ["line: back in the press's own second | Colossus Smash"],
    });
  });

  it("a press the model has no charge for: a model gap", () => {
    expect(
      scan(
        [10, 40.2],
        "  [KILL WINDOW] 0:30–0:45 on X (Y): team burst 100k (defenseless 0:30–0:45); team offensive CDs ready at 0:30: none (pressed inside: Colossus Smash 0:40).",
      ),
    ).toEqual({
      checked: 1,
      kinds: ["model: not back at the press | Colossus Smash"],
    });
  });

  it("an entry the sentence lists as back is not judged", () => {
    expect(
      scan(
        [10.68, 55.88],
        "  [KILL WINDOW] 0:48–1:00 on X (Y): team burst 100k (defenseless 0:48–1:00); team offensive CDs ready at 0:48: none (back inside: Colossus Smash 0:55; pressed inside: Colossus Smash 0:55).",
      ),
    ).toEqual({ checked: 0, kinds: [] });
  });
});
