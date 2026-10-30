import type { GladMatchBase } from "@gladlog/parser";
import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import { describe, expect, it } from "vitest";

import {
  isClean,
  itemsOfRawText,
  newTally,
  scanItem,
} from "../scripts/swingLandedScan";

// The FT-T01 / T02 swing scan: its classes against hand-built parsed arrays
// (each must-be-0 class fires on exactly the input its doc comment names),
// and the real parser on a synthetic log (clean, as the corpus run is).

const START_MS = Date.UTC(2026, 6, 19, 12, 0, 0);
const ts = (offsetMs: number): string => {
  const d = new Date(START_MS + offsetMs);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const p3 = (n: number) => String(n).padStart(3, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(d.getUTCMilliseconds())}`;
};

const ALPHA = { guid: "Player-1-0001", name: "Alpha-Realm", flags: "0x511" };
const DELTA = { guid: "Player-1-0004", name: "Delta-Realm", flags: "0x548" };
const GHOUL = {
  guid: "Creature-0-1-1-1-237409-0000050D66",
  name: "Lesser Ghoul",
  flags: "0xa28",
};
type Unit = typeof ALPHA;
const quad = (u: Unit) => `${u.guid},"${u.name}",${u.flags},0x0`;
const adv = (u: Unit) =>
  `${u.guid},0000000000000000,100000,100000,0,0,0,0,0,0,0,0,0,0,1000.00,-2000.00,0,1.0,0`;
/** amount, baseAmount, overkill, school, resisted, blocked, absorbed, crit… */
const tail = (amount: number, base: number, absorbed = 0) =>
  `${amount},${base},-1,1,0,0,${absorbed},nil,nil,nil`;
const swing = (offsetMs: number, src: Unit, dst: Unit, t: string) =>
  `${ts(offsetMs)}  SWING_DAMAGE,${quad(src)},${quad(dst)},${adv(src)},${t}`;
const landed = (offsetMs: number, src: Unit, dst: Unit, t: string) =>
  `${ts(offsetMs)}  SWING_DAMAGE_LANDED,${quad(src)},${quad(dst)},${adv(dst)},${t}`;

/** The synthetic 3v3 log with `extra` lines inserted before ARENA_MATCH_END. */
function logWith(extra: string[]): string {
  const lines = synthArenaLog({ startMs: START_MS }).split("\n");
  const end = lines.findIndex((l) => l.includes("ARENA_MATCH_END"));
  return [...lines.slice(0, end), ...extra, ...lines.slice(end)].join("\n");
}

/** A match whose rawLines are the given lines and whose parsed damage arrays
 * hold exactly `stored` (rawLines index → amount, on the victim's damageIn). */
function matchOf(
  rawLines: string[],
  stored: Array<[lineIndex: number, amount: number]>,
  units: string[] = [ALPHA.guid, DELTA.guid],
): GladMatchBase {
  const u = Object.fromEntries(
    units.map((id) => [id, { damageIn: [] as unknown[], damageOut: [] }]),
  );
  for (const [lineIndex, amount] of stored)
    (u[DELTA.guid]?.damageIn as unknown[])?.push({ lineIndex, amount });
  return { id: "m", rawLines, units: u } as unknown as GladMatchBase;
}

describe("scanItem — the classes, on hand-built parsed arrays", () => {
  const pair = [
    swing(15000, ALPHA, DELTA, tail(77, 90)),
    landed(15012, ALPHA, DELTA, tail(77, 90)),
  ];

  it("a pair stored once, at the LANDED line, with its amount: clean", () => {
    const t = scanItem(matchOf(pair, [[1, 77]]));
    expect([t.swing, t.landed, t.pairs, t.landedFirst]).toEqual([1, 1, 1, 0]);
    expect([t.missing, t.double, t.mismatch, t.zeroNoAbsorb]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(isClean(t)).toBe(true);
    // stored at the SWING line instead is the same swing once — clean too
    expect(isClean(scanItem(matchOf(pair, [[0, 77]])))).toBe(true);
  });

  it("DOUBLE: both lines of a pair in a damage array", () => {
    const seen: string[] = [];
    const t = scanItem(
      matchOf(pair, [
        [0, 77],
        [1, 77],
      ]),
      (cls) => seen.push(cls),
    );
    expect([t.double, t.doubleDamage, t.missing, t.mismatch]).toEqual([
      1, 77, 0, 0,
    ]);
    expect(seen).toEqual(["DOUBLE"]);
    expect(isClean(t)).toBe(false);
  });

  it("MISSING: neither line of a pair in a damage array (on a player)", () => {
    const t = scanItem(matchOf(pair, []));
    expect([t.missing, t.missingDamage, t.missingOnPlayer]).toEqual([
      1, 77, 1,
    ]);
    expect(isClean(t)).toBe(false);
  });

  it("MISMATCH: the stored amount is the attacker side's; PHANTOM when the victim side says nothing landed", () => {
    const differ = [
      swing(15000, ALPHA, DELTA, tail(100, 90)),
      landed(15012, ALPHA, DELTA, tail(77, 90)),
    ];
    const t = scanItem(matchOf(differ, [[1, 100]]));
    expect([t.amountDiffers, t.mismatch, t.mismatchAbs, t.mismatchNet]).toEqual(
      [1, 1, 23, 23],
    );
    expect(t.phantom).toBe(0);
    // the victim-side amount stored: clean
    expect(isClean(scanItem(matchOf(differ, [[1, 77]])))).toBe(true);

    const nothingLanded = [
      swing(15000, ALPHA, DELTA, tail(100, 90)),
      landed(15012, ALPHA, DELTA, tail(0, 90)),
    ];
    const p = scanItem(matchOf(nothingLanded, [[1, 100]]));
    expect([p.zero, p.zeroNoAbsorb, p.mismatch, p.phantom, p.phantomDamage]).toEqual(
      [1, 0, 1, 1, 100],
    );
  });

  it("ZERO-NOABS: a LANDED line with amount 0 and an absorb no melee SPELL_ABSORBED record meets", () => {
    const absorbedWhole = [landed(15012, ALPHA, DELTA, tail(0, 90, 90))];
    const t = scanItem(matchOf(absorbedWhole, []));
    expect([t.zero, t.zeroNoAbsorb, t.missing]).toEqual([1, 1, 0]);
    expect(isClean(t)).toBe(false);
  });

  it("a SWING_DAMAGE with no LANDED twin is the swing's only line: MISSING when not stored, MISMATCH on another amount", () => {
    const lone = [swing(15000, ALPHA, DELTA, tail(77, 90))];
    expect(scanItem(matchOf(lone, [])).missing).toBe(1);
    expect(scanItem(matchOf(lone, [[0, 60]])).mismatch).toBe(1);
    const ok = scanItem(matchOf(lone, [[0, 77]]));
    expect([ok.swingOnly, ok.missing, ok.mismatch]).toEqual([1, 0, 0]);
  });

  it("a LANDED-only line (a guardian's swing) with amount > 0 is a hit the parser must keep", () => {
    const only = [landed(16000, GHOUL, DELTA, tail(804, 1061))];
    const kept = scanItem(matchOf(only, [[0, 804]]));
    expect([kept.landedOnly, kept.landedOnlyHit, kept.missing]).toEqual([
      1, 1, 0,
    ]);
    expect(scanItem(matchOf(only, [])).missing).toBe(1);
  });

  it("a target that is not a parsed unit is counted apart, never MISSING", () => {
    const t = scanItem(matchOf(pair, [], [ALPHA.guid]));
    expect([t.targetNotAUnit, t.missing]).toEqual([1, 0]);
  });

  it("two stored amounts for one line is itself a mismatch", () => {
    const m = matchOf(pair, [[1, 77]]);
    (m.units[ALPHA.guid]!.damageOut as unknown[]).push({ lineIndex: 1, amount: 60 });
    expect(scanItem(m).mismatch).toBe(1);
  });
});

describe("the real parser on a synthetic log", () => {
  it("a pair, a pair whose amounts differ (victim side kept) and a guardian's LANDED-only hit: clean", () => {
    const items = itemsOfRawText(
      logWith([
        swing(15000, ALPHA, DELTA, tail(77, 90)),
        landed(15012, ALPHA, DELTA, tail(77, 90)),
        landed(16000, GHOUL, DELTA, tail(804, 1061)),
        swing(17000, ALPHA, DELTA, tail(100, 90)),
        landed(17005, ALPHA, DELTA, tail(77, 90)),
      ]),
    );
    expect(items).toHaveLength(1);
    const t = newTally();
    Object.assign(t, scanItem(items[0]!));
    expect([t.swing, t.landed, t.pairs, t.landedOnlyHit, t.amountDiffers]).toEqual(
      [2, 3, 2, 1, 1],
    );
    expect([t.missing, t.double, t.mismatch, t.zeroNoAbsorb]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(isClean(t)).toBe(true);
  });
});
