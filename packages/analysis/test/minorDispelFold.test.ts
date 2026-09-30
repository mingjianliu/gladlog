/**
 * Triage 2026-09-29 missed-cleanse F-P2 / F-P3 (ruling A18 = A) and F-P1:
 * the [MINOR DISPELS] fold lists casts with what they removed; the owner's
 * purge skip uses the gap filler's own match predicate.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { purgeMatchesCast } from "../src/context/timelineSections/healerCastGapFiller";
import { formatMinorDispelPart } from "../src/context/timelineSections/minorDispels";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const ev = (t: number, id: string, name: string) => ({
  timeSeconds: t,
  removedSpellId: id,
  removedSpellName: name,
});

describe("formatMinorDispelPart", () => {
  it("f4647408: two Greater Purges, three removals → ×2 casts with names", () => {
    expect(
      formatMinorDispelPart({
        spellName: "Greater Purge",
        passive: false,
        events: [
          ev(60.066, "21562", "Power Word: Fortitude"),
          ev(112.649, "21562", "Power Word: Fortitude"),
          ev(112.649, "65081", "Body and Soul"),
        ],
      }),
    ).toBe(
      "Greater Purge ×2 (1:00 Power Word: Fortitude; 1:52 Power Word: Fortitude、Body and Soul)",
    );
  });
  it("more than four casts end in +N; removals ≤ 50 ms apart are one cast", () => {
    const out = formatMinorDispelPart({
      spellName: "Dispel Magic",
      passive: false,
      events: [
        ev(74.164, "48438", "Wild Growth"),
        ev(181.164, "33763", "Lifebloom"),
        ev(182.431, "774", "Rejuvenation"),
        ev(183.669, "774", "Rejuvenation"),
        ev(183.7, "1126", "Mark of the Wild"),
        ev(184.951, "1126", "Mark of the Wild"),
      ],
    });
    expect(out).toBe(
      "Dispel Magic ×5 (1:14 Wild Growth; 3:01 Lifebloom; 3:02 Rejuvenation; 3:03 Rejuvenation、Mark of the Wild, +1)",
    );
  });
  it("a passive part keeps the bare count", () => {
    expect(
      formatMinorDispelPart({
        spellName: "Phantasm (passive)",
        passive: true,
        events: [ev(1, "1", "a"), ev(2, "1", "a")],
      }),
    ).toBe("Phantasm (passive) x2");
  });
});

describe("purgeMatchesCast (F-P1)", () => {
  it("same target within 50 ms", () => {
    const p = { targetName: "X", timeSeconds: 10 };
    expect(purgeMatchesCast(p, { destUnitName: "X", timeSeconds: 10.04 })).toBe(
      true,
    );
    expect(purgeMatchesCast(p, { destUnitName: "X", timeSeconds: 10.06 })).toBe(
      false,
    );
    expect(purgeMatchesCast(p, { destUnitName: "Y", timeSeconds: 10 })).toBe(
      false,
    );
  });
});

describe("purgeMatchesCast — the cast must be the dispel (5677ba13 Holy Fire)", () => {
  it("a different spell on the same target in the same 50 ms does not match", () => {
    const p = { targetName: "X", timeSeconds: 10, dispelSpellId: "528" };
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "14914",
      }),
    ).toBe(false);
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "528",
      }),
    ).toBe(true);
    expect(purgeMatchesCast(p, { destUnitName: "X", timeSeconds: 10 })).toBe(
      true,
    );
  });
  it("codex review: two different ids that are both missing from the name table are not the same spell", () => {
    const p = { targetName: "X", timeSeconds: 10, dispelSpellId: "999999901" };
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "999999902",
      }),
    ).toBe(false);
    // the same unknown id still matches itself
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "999999901",
      }),
    ).toBe(true);
  });
});
