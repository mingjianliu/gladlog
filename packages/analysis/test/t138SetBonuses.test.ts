/**
 * T138 — two 12.0 set bonuses still worn in 12.1: Preservation 2pc on
 * Verdant Embrace, Fury 4pc on Odyn's Fury (a row the gear owns).
 */
import { describe, expect, it } from "vitest";

import {
  CLASS_SET_ITEM_IDS,
  setBonusCooldownReductionSeconds,
  setPiecesWorn,
} from "../src/data/classSetBonuses";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReductionsFor,
} from "../src/data/talentScriptedCooldowns";

const wearing = (setId: string, n: number, spec: string) => ({
  spec,
  info: {
    equipment: CLASS_SET_ITEM_IDS[setId]!.slice(0, n).map((id) => ({ id })),
  },
});

describe("Preservation 12.0 2pc — Verdant Embrace −2 s", () => {
  it("2 pieces in the spec; not 1 piece, not another Evoker spec", () => {
    expect(
      setBonusCooldownReductionSeconds("360995", wearing("1981", 2, "1468")),
    ).toBe(2);
    expect(
      setBonusCooldownReductionSeconds("360995", wearing("1981", 1, "1468")),
    ).toBe(0);
    expect(
      setBonusCooldownReductionSeconds("360995", wearing("1981", 4, "1467")),
    ).toBe(0);
  });
});

describe("Fury 12.0 4pc — the gear owns the Odyn's Fury row", () => {
  const row = EVENT_COOLDOWN_REDUCTIONS["1264878"]!;
  const rows = (u: ReturnType<typeof wearing> | undefined, holdsAll = false) =>
    eventReductionsFor(
      "385059",
      () => holdsAll,
      u?.spec,
      u ? (id) => setPiecesWorn(u, id) : undefined,
    );
  it("1.25 s per Rampage", () => {
    expect(row.triggerCastIds).toEqual(["184367"]);
    expect(row.seconds).toBe(1.25);
  });
  it("4 pieces as Fury: the row", () => {
    expect(rows(wearing("1990", 4, "72"))).toEqual([row]);
  });
  it("3 pieces, Arms in 4 pieces, or no gear reading: no row", () => {
    expect(rows(wearing("1990", 3, "72"))).toEqual([]);
    expect(rows(wearing("1990", 4, "71"))).toEqual([]);
    expect(rows(undefined)).toEqual([]);
  });
  it("a talent of the bonus's id does not own it", () => {
    expect(rows(wearing("1990", 0, "72"), true)).toEqual([]);
  });
});
