/**
 * Reliability audit B4a (2026-09-25): an enemy's own save with no percentage
 * mitigation (self Guardian Spirit, Desperate Prayer, …) is a defensive for
 * both the [ENEMY DEF] line and the KILL ATTEMPTS attribution —
 * a9bc48b5 @2:14 said "not enough damage" while the priest had Guardian
 * Spirit'd himself at 2:16 and Desperate Prayer'd at 2:20.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  enemyDefensiveEvents,
  SELF_SAVE_IDS,
  selfSaveCasts,
} from "../src/utils/enemyDefensives";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("F10: an enemy's Ultimate Penitence is its own absorb save", () => {
  const ENEMY_OF_PRIEST = "x";
  const up = (ts: number, event?: string) => {
    const e = makeSpellCastEvent(
      "421453",
      ts,
      "p",
      "Priest-R",
      ENEMY_OF_PRIEST,
      "Knight-R",
      0,
      "Ultimate Penitence",
    );
    if (event) (e.logLine as { event: string }).event = event;
    return e;
  };

  it("is a self-save whatever the channel's target — and only on SUCCESS", () => {
    expect(SELF_SAVE_IDS.has("421453")).toBe(true);
    const priest = makeUnit("p", {
      name: "Priest-R",
      // 3df6ccf8 round 4: started at 0:44 (kicked 0:45) and 1:00 (kicked
      // 1:01), the third bar completed at 1:10.065
      spellCastEvents: [
        up(T0 + 44_399, "SPELL_CAST_START"),
        up(T0 + 60_862, "SPELL_CAST_START"),
        up(T0 + 70_065),
      ],
    });
    expect(
      selfSaveCasts(priest as any, T0).map((c) => [c.spellName, c.atSeconds]),
    ).toEqual([["Ultimate Penitence", 70.065]]);
    const events = enemyDefensiveEvents(priest as any, [priest as any], {
      startTime: T0,
      endTime: T0 + 110_000,
    });
    expect(events.map((d) => [d.spellName, d.kind, d.atSeconds])).toEqual([
      ["Ultimate Penitence", "self-save", 70.065],
    ]);
  });
});

describe("enemy self-saves (B4a)", () => {
  it("the set holds the major lists ∩ NO_MITIGATION_IDS: Guardian Spirit and Desperate Prayer are in, a %-wall is not", () => {
    expect(SELF_SAVE_IDS.has("47788")).toBe(true); // Guardian Spirit
    expect(SELF_SAVE_IDS.has("19236")).toBe(true); // Desperate Prayer
    expect(SELF_SAVE_IDS.has("33206")).toBe(false); // Pain Suppression (a % wall)
  });

  it("Guardian Spirit on itself and Desperate Prayer count; Guardian Spirit on an ally does not (that is an external)", () => {
    const priest = makeUnit("p", {
      name: "Priest-R",
      spellCastEvents: [
        makeSpellCastEvent(
          "47788",
          T0 + 136_550,
          "p",
          "Priest-R",
          "p",
          "Priest-R",
          0,
          "Guardian Spirit",
        ),
        makeSpellCastEvent(
          "19236",
          T0 + 140_230,
          "p",
          "Priest-R",
          "p",
          "Priest-R",
          0,
          "Desperate Prayer",
        ),
        makeSpellCastEvent(
          "47788",
          T0 + 200_000,
          "f",
          "Feral-R",
          "p",
          "Priest-R",
          0,
          "Guardian Spirit",
        ),
      ],
    });
    expect(
      selfSaveCasts(priest as any, T0).map((c) => [c.spellId, c.atSeconds]),
    ).toEqual([
      ["47788", 136.55],
      ["19236", 140.23],
    ]);
    const kinds = enemyDefensiveEvents(priest as any, [priest as any], {
      startTime: T0,
      endTime: T0 + 300_000,
    }).map((d) => d.kind);
    expect(kinds.filter((k) => k === "self-save")).toHaveLength(2);
  });
});
