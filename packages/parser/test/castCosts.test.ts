import { describe, expect, it } from "vitest";

import { decodeAdvanced, decodeCastCosts } from "../src/l1/decoders";
import { parseLine } from "../src/l1/parseLine";
import { splitLine } from "../src/l1/splitTopLevel";
import type { ParsedLine } from "../src/l1/types";
import { collectEvents } from "../src/l3/collect";
import { buildRoster } from "../src/l3/roster";

/**
 * What a SPELL_CAST_SUCCESS row says the cast cost (`decodeCastCosts`). The
 * rows below are verbatim out of raw logs (7f67e778, 141470d0): the layout was
 * measured on raw rows, so the tests are anchored on real ones.
 */

// Mistweaver Monk, Renewing Mist: one power (mana), 4,500.
const CAST_MANA =
  '6/19/2026 02:41:19.024-4  SPELL_CAST_SUCCESS,Player-57-0DE6D271,"Nevertrinket-Illidan-US",0x511,0x80000000,Player-3723-0C5E0A98,"Pvegodx-Barthilas-US",0x10512,0x80000000,115151,"复苏之雾",0x8,Player-57-0DE6D271,0000000000000000,559220,559220,2895,2784,924,2809,0,0,0,262500,262500,4500,-581.70,4215.30,0,5.6452,298';

// Outlaw Rogue, Dispatch: 35 energy and 5 combo points.
const CAST_TWO_POWERS =
  '6/19/2026 02:41:37.119-4  SPELL_CAST_SUCCESS,Player-3723-0C5E0A98,"Pvegodx-Barthilas-US",0x10512,0x80000000,Player-84-0AD80B99,"Retrô-Uldum-US",0x548,0x80000000,2098,"斩击",0x1,Player-3723-0C5E0A98,0000000000000000,585354,631200,2988,471,924,3580,0,0,3|4,53|5,200|7,35|5,-522.27,4153.88,0,6.1431,298';

// Holy Paladin, Word of Glory: 3 Holy Power and 1,500 mana.
const CAST_HOLY_POWER_AND_MANA =
  '6/19/2026 02:41:36.707-4  SPELL_CAST_SUCCESS,Player-11-0E4444F4,"Dilfspice-Tichondrius-US",0x548,0x80000000,Player-84-0AD80B99,"Retrô-Uldum-US",0x548,0x80000000,85673,"荣耀圣令",0x2,Player-11-0E4444F4,0000000000000000,606121,606440,3073,2955,2736,2333,0,52173,9|0,5|267798,5|273000,3|1500,-510.88,4164.49,0,4.7074,298';

// Outlaw Rogue, Stealth: the row states a cost of 0.
const CAST_FREE =
  '6/19/2026 02:41:19.395-4  SPELL_CAST_SUCCESS,Player-3723-0C5E0A98,"Pvegodx-Barthilas-US",0x10512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,1784,"潜行",0x1,Player-3723-0C5E0A98,0000000000000000,631200,631200,2827,471,924,3580,0,0,3,200,200,0,-572.64,4216.08,0,5.8328,298';

// Advanced logging off: the row ends at the spell triple.
const CAST_NO_ADVANCED =
  '6/19/2026 02:41:19.395-4  SPELL_CAST_SUCCESS,Player-3723-0C5E0A98,"Pvegodx-Barthilas-US",0x10512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,1784,"潜行",0x1';

const costsOf = (line: string) => decodeCastCosts(splitLine(line)!.params, 11);

describe("decodeCastCosts", () => {
  it("reads the cost field right before the position pair", () => {
    expect(costsOf(CAST_MANA)).toEqual([{ powerType: 0, cost: 4500 }]);
  });

  it("a spell charged in two powers lists both, index-aligned with the types", () => {
    expect(costsOf(CAST_TWO_POWERS)).toEqual([
      { powerType: 3, cost: 35 },
      { powerType: 4, cost: 5 },
    ]);
    expect(costsOf(CAST_HOLY_POWER_AND_MANA)).toEqual([
      { powerType: 9, cost: 3 },
      { powerType: 0, cost: 1500 },
    ]);
  });

  it("a stated 0 is kept — it is a statement, not an absence", () => {
    expect(costsOf(CAST_FREE)).toEqual([{ powerType: 3, cost: 0 }]);
  });

  it("no advanced block → undefined, never a guessed zero", () => {
    expect(costsOf(CAST_NO_ADVANCED)).toBeUndefined();
  });

  it("a cost list that does not line up with the type list → undefined", () => {
    expect(costsOf(CAST_TWO_POWERS.replace(",35|5,", ",35,"))).toBeUndefined();
    expect(costsOf(CAST_MANA.replace(",4500,", ",,"))).toBeUndefined();
    expect(costsOf(CAST_MANA.replace(",4500,", ",nil,"))).toBeUndefined();
  });

  it("leaves decodeAdvanced's own reads where they were", () => {
    const adv = decodeAdvanced(splitLine(CAST_HOLY_POWER_AND_MANA)!.params, 11);
    expect(adv.powers).toEqual([
      { powerType: 9, current: 5, max: 5 },
      { powerType: 0, current: 267798, max: 273000 },
    ]);
    expect(adv.x).toBeCloseTo(-510.88, 2);
    expect(adv.y).toBeCloseTo(4164.49, 2);
    expect(adv.facing).toBeCloseTo(4.7074, 4);
    // without an advanced block the old fixed-offset fallback still answers
    const none = decodeAdvanced(splitLine(CAST_NO_ADVANCED)!.params, 11);
    expect(none.powers).toEqual([]);
    expect(none.x).toBeNaN();
  });
});

describe("the stated cost on the parsed cast event", () => {
  it("parseLine carries it on SPELL_CAST_SUCCESS only", () => {
    expect(parseLine(CAST_MANA)!.castCosts).toEqual([
      { powerType: 0, cost: 4500 },
    ]);
    expect(parseLine(CAST_NO_ADVANCED)!.castCosts).toBeUndefined();
    const heal =
      '6/30/2026 12:00:04.000  SPELL_HEAL,Player-1-A,"Alice-X",0x511,0x80000000,Player-1-A,"Alice-X",0x511,0x80000000,2061,"Flash Heal",0x2,Player-1-A,0000000000000000,1000,1000,0,0,0,0,0,0,0,50,50,0,1.0,-1.0,0,1.0,70,200,200,50,0,nil';
    expect(parseLine(heal)!.castCosts).toBeUndefined();
  });

  it("collectEvents puts it on `casts` (and the owner's `petCasts` copy), not on `actionsOut`", () => {
    const TZ = { timezone: "UTC" } as const;
    const L = (s: string, i: number) =>
      parseLine(`6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`, TZ)!;
    const records: ParsedLine[] = [
      L(
        'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,115151,"Renewing Mist",0x8,Player-1-A,0000000000000000,1000,1000,0,0,0,0,0,0,0,262500,262500,4500,1.0,-1.0,0,1.0,70',
        1,
      ),
      L(
        'SPELL_CAST_SUCCESS,Pet-0-1-1-1-165189-01P,"Kitty",0x1112,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,16827,"Claw",0x1,Pet-0-1-1-1-165189-01P,Player-1-A,500,500,0,0,0,0,0,0,2,100,100,25,1.0,-1.0,0,1.0,70',
        2,
      ),
      L(
        'SPELL_CAST_SUCCESS,Player-2-B,"Bob-Y",0x548,0x80000000,0000000000000000,nil,0x80000000,0x80000000,1784,"Stealth",0x1',
        3,
      ),
    ];
    const units = collectEvents(records, buildRoster(records));
    const A = units.get("Player-1-A")!;
    const B = units.get("Player-2-B")!;
    const P = units.get("Pet-0-1-1-1-165189-01P")!;
    expect(A.casts[0]!.powerCosts).toEqual([{ powerType: 0, cost: 4500 }]);
    expect(P.casts[0]!.powerCosts).toEqual([{ powerType: 2, cost: 25 }]);
    expect(A.petCasts[0]!.powerCosts).toEqual([{ powerType: 2, cost: 25 }]);
    // a row that does not state it leaves no key at all
    expect(B.casts).toHaveLength(1);
    expect("powerCosts" in B.casts[0]!).toBe(false);
    for (const e of [...A.actionsOut, ...B.actionsOut, ...B.actionsIn])
      expect("powerCosts" in e).toBe(false);
  });
});
