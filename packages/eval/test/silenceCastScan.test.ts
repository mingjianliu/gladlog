import { isSilenceOnlyAura } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import {
  isSilenceableCast,
  isUnsilenceableCast,
} from "@gladlog/analysis/src/utils/spellMechanics";
import { describe, expect, it } from "vitest";

import {
  addCounts,
  FLAG_PER_10K,
  isFlagged,
  klassOf,
  LAG_MS,
  LEAD_MS,
  perTenK,
  scanLogText,
} from "../scripts/silenceCastScan";

// The silence-cast scan on synthetic raw lines: which SUCCESSes count as
// "inside a silence", how each is classed, and when the FLAG trips.

const SILENCE = "15487"; // Priest Silence — a silence-only aura
const FLASH_HEAL = "2061"; // a SpellCategories row with the silence bit
const JUDGMENT = "20271"; // a row without it
const NO_ROW = "999001"; // no row at all
const A = "Player-57-AAAAAAA1";
const B = "Player-57-BBBBBBB2";
const N = "Creature-0-1-1-1-1-0000000001";

const ADV_TAIL =
  "0000000000000000,566540,566540,2916,2804,2513,2533,0,0,0,273000,273000,0,1281.30,1709.34,0,4.8313,291";
const applied = (ts: string, src: string, dst: string, id = SILENCE) =>
  `6/15/2026 ${ts}-4  SPELL_AURA_APPLIED,${src},"Src-Realm-US",0x548,0x0,${dst},"Dest-Realm-US",0x10512,0x0,${id},"Silence",0x20,DEBUFF`;
const removed = (ts: string, src: string, dst: string, id = SILENCE) =>
  `6/15/2026 ${ts}-4  SPELL_AURA_REMOVED,${src},"Src-Realm-US",0x548,0x0,${dst},"Dest-Realm-US",0x10512,0x0,${id},"Silence",0x20,DEBUFF,0`;
const cast = (ts: string, caster: string, id: string, name: string) =>
  `6/15/2026 ${ts}-4  SPELL_CAST_SUCCESS,${caster},"Src-Realm-US",0x10512,0x0,${caster},"Src-Realm-US",0x10512,0x0,${id},"${name}",0x2,${caster},${ADV_TAIL}`;

describe("premises — the ids the fixture stands on, read off the product predicates", () => {
  it("15487 is a silence-only aura; 2061 silenceable, 20271 unsilenceable, 999001 has no row", () => {
    expect(isSilenceOnlyAura(SILENCE)).toBe(true);
    expect(isSilenceableCast(FLASH_HEAL)).toBe(true);
    expect(isUnsilenceableCast(JUDGMENT)).toBe(true);
    expect([isSilenceableCast(NO_ROW), isUnsilenceableCast(NO_ROW)]).toEqual([
      false,
      false,
    ]);
    expect([klassOf(FLASH_HEAL), klassOf(JUDGMENT), klassOf(NO_ROW)]).toEqual([
      "silenceable",
      "unsilenceable",
      "no row",
    ]);
    expect([LEAD_MS, LAG_MS, FLAG_PER_10K]).toEqual([100, 50, 1]);
  });
});

describe("scanLogText", () => {
  // A silenced by B from 35.000 to 36.000
  const text = [
    "6/15/2026 01:08:34.614-4  ARENA_MATCH_START,572,41,3v3,1",
    applied("01:08:35.000", B, A),
    cast("01:08:35.050", A, FLASH_HEAL, "Flash Heal"), // inside the 100 ms lead: not counted
    cast("01:08:35.200", A, FLASH_HEAL, "Flash Heal"), // inside → silenceable
    cast("01:08:35.250", B, FLASH_HEAL, "Flash Heal"), // B is not silenced
    cast("01:08:35.300", A, JUDGMENT, "Judgment"), // inside → unsilenceable
    cast("01:08:35.400", A, NO_ROW, "Pet Command"), // inside → no row
    cast("01:08:35.970", A, FLASH_HEAL, "Flash Heal"), // inside the 50 ms lag: not counted
    removed("01:08:36.000", B, A),
    // a silence a player put on themselves is not one; a silence on a
    // non-player is not read
    applied("01:08:40.000", B, B),
    cast("01:08:40.500", B, JUDGMENT, "Judgment"),
    removed("01:08:41.000", B, B),
    applied("01:08:42.000", B, N),
    removed("01:08:43.000", B, N),
    // a REMOVED with no APPLIED is ignored; a non-silence aura is ignored
    removed("01:08:44.000", B, A),
    applied("01:08:45.000", B, A, "118"),
    cast("01:08:45.500", A, FLASH_HEAL, "Flash Heal"),
    removed("01:08:46.000", B, A, "118"),
    "6/15/2026 01:09:00.000-4  ARENA_MATCH_END,1,30,1500,1501",
  ].join("\n");

  it("counts a player's SUCCESSes strictly inside a silence another unit put on them, per class", () => {
    const c = scanLogText(text);
    expect([...c.inside.entries()].sort()).toEqual([
      ["no row", 1],
      ["silenceable", 1],
      ["unsilenceable", 1],
    ]);
    expect([...c.total.entries()].sort()).toEqual([
      ["no row", 1],
      ["silenceable", 5],
      ["unsilenceable", 2],
    ]);
    expect([...c.bySpell.get("silenceable")!]).toEqual([["Flash Heal 2061", 1]]);
    expect(perTenK(c, "silenceable")).toBe(2000);
    expect(isFlagged(c)).toBe(true);
  });

  it("no silence in the log: nothing inside, no flag; counts add across files", () => {
    const clean = scanLogText(
      [
        cast("01:08:35.200", A, FLASH_HEAL, "Flash Heal"),
        cast("01:08:35.300", A, JUDGMENT, "Judgment"),
      ].join("\n"),
    );
    expect(clean.inside.size).toBe(0);
    expect(perTenK(clean, "silenceable")).toBe(0);
    expect(isFlagged(clean)).toBe(false);
    const total = scanLogText(text);
    addCounts(total, clean);
    expect(total.total.get("silenceable")).toBe(6);
    expect(total.inside.get("silenceable")).toBe(1);
    expect(perTenK(total, "silenceable")).toBeCloseTo(1666.67, 1);
  });
});
