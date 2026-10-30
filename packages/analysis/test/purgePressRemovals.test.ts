/**
 * F20 D31 (fact6, 2026-10-28) — how many buffs ONE purge press removed: the
 * press's own removal rows (`purgePressRemovals`, shared by the owner cast
 * line and `[PURGE]`), and the per-tool count the legend / menu state from
 * DB2 Effect 38 (Greater Purge 378773 and Fire Breath 357209 remove 2).
 */
import { describe, expect, it } from "vitest";

import {
  purgePressRemovalCount,
  purgePressRemovals,
} from "../src/context/timelineSections/healerCastGapFiller";
import { PURGE_REMOVALS_PER_TARGET } from "../src/data/purgeRemovalsGenerated";
import { PURGE_PRESS_REMOVALS_TEXT } from "../src/utils/dispelAnalysis";

const removal = (
  over: Partial<{
    sourceName: string;
    isPetDispel: boolean;
    targetName: string;
    timeSeconds: number;
    dispelSpellId: string;
  }>,
) => ({
  sourceName: "Shaman",
  isPetDispel: false,
  targetName: "Warlock",
  timeSeconds: 34.45,
  dispelSpellId: "378773",
  ...over,
});

describe("purge removals per press", () => {
  it("DB2: Greater Purge and Fire Breath remove 2, Purge / Dispel Magic 1", () => {
    expect(PURGE_REMOVALS_PER_TARGET["378773"]).toBe(2);
    expect(PURGE_REMOVALS_PER_TARGET["357209"]).toBe(2);
    expect(PURGE_REMOVALS_PER_TARGET["370"]).toBe(1);
    expect(PURGE_REMOVALS_PER_TARGET["528"]).toBe(1);
    expect(PURGE_PRESS_REMOVALS_TEXT).toBe(
      "1 for most purges, 2 for Fire Breath and Greater Purge",
    );
  });

  it("one press = same source, target, dispel spell and instant (c5ae2200 0:34: Power Infusion + Renew)", () => {
    const pi = removal({});
    const renew = removal({ timeSeconds: 34.451 });
    const otherTarget = removal({ targetName: "Priest" });
    const later = removal({ timeSeconds: 35.5 });
    const otherSource = removal({ sourceName: "Evoker" });
    const all = [pi, renew, otherTarget, later, otherSource];
    expect(
      purgePressRemovals(all, {
        sourceName: pi.sourceName,
        isPetDispel: false,
        destUnitName: pi.targetName,
        timeSeconds: pi.timeSeconds,
        spellId: pi.dispelSpellId,
      }),
    ).toEqual([pi, renew]);
  });

  // F20 wide residual (2026-10-29)
  const took = (removedSpellId: string, dispelSpellId: string) => ({
    removedSpellId,
    dispelSpellId,
  });

  it("k counts N's buffs only: a Tranquilizing Shot's Enrage is not one (8d34954d r1 0:22 printed 2 of 4)", () => {
    expect(
      purgePressRemovalCount([
        took("384100", "19801"), // Berserker Shout — Enrage
        took("41635", "19801"), // Prayer of Mending — Magic
      ]),
    ).toBe(1);
  });

  it("k is at most the tool's DB2 count: Improved Spellsteal's repeat 10 ms after the next press (d7fcb865 r4 1:09)", () => {
    expect(PURGE_REMOVALS_PER_TARGET["30449"]).toBe(1);
    expect(PURGE_REMOVALS_PER_TARGET["1231112"]).toBe(1);
    expect(
      purgePressRemovalCount([
        took("1126", "30449"), // Mark of the Wild
        took("1253593", "30449"), // Void Shield — the previous press's repeat
      ]),
    ).toBe(1);
  });

  it("two-removal tools keep 2; Mass Dispel's immunity id has no DB2 count, so no cap (653da914 r6 1:33)", () => {
    expect(
      purgePressRemovalCount([took("10060", "378773"), took("139", "378773")]),
    ).toBe(2);
    expect(
      purgePressRemovalCount([
        took("1022", "39897"), // Blessing of Protection
        took("21562", "32592"), // Power Word: Fortitude
      ]),
    ).toBe(2);
  });

  it("k counts distinct buffs, as N does: one buff's repeated removal row is one (codex F20-27)", () => {
    expect(
      purgePressRemovalCount([
        took("10060", "378773"),
        took("10060", "378773"),
      ]),
    ).toBe(1);
  });

  it("never below 1", () => {
    expect(purgePressRemovalCount([took("384100", "19801")])).toBe(1);
  });
});
