/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/t107 `darkSimulacrumPressUnlined` (T107, R41): a friendly copy cast
 * needs its press line at its second; the other side's copies are an
 * inventory (kind `enemy`, out of the total).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { OUT_OF_TOTAL, run } from "../scripts/scan5/t107";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const at = (s: number) => T + s * 1000;

function scan(lines: string[], reaction = CombatUnitReaction.Friendly) {
  const dk = makeUnit("p2", {
    name: "DK",
    reaction,
    spellCastEvents: [
      makeSpellCastEvent("33206", at(39.419), "p2", "DK", "p2", "DK"),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "77616",
        at(39.419),
        "e3",
        "p2",
        "BUFF",
      ),
    ],
  });
  const owner = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
  });
  let checked = 0;
  const kinds: string[] = [];
  run({
    lines,
    start: T,
    roundEndAt: at(120),
    firstOwnerOfRound: true,
    owner,
    players: [owner, dk],
    pidOf: (n: string) => (n === "DK" ? "2" : "1"),
    bump: () => checked++,
    violate: (_c: string, k: string) => kinds.push(k),
  } as any);
  return { checked, kinds };
}

describe("scan5 darkSimulacrumPressUnlined", () => {
  it("passes the press line, fails its absence", () => {
    expect(
      scan([
        "0:39  [TEAM] [CD]   2(FDKnight) (Frost Death Knight): Pain Suppression",
      ]),
    ).toEqual({ checked: 1, kinds: [] });
    expect(scan([])).toEqual({ checked: 1, kinds: ["Pain Suppression"] });
  });
  it("the other side's copy is an inventory row, out of the total", () => {
    expect(scan([], CombatUnitReaction.Hostile)).toEqual({
      checked: 0,
      kinds: ["enemy"],
    });
    expect(OUT_OF_TOTAL.has("darkSimulacrumPressUnlined|enemy")).toBe(true);
  });
});
