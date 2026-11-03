import { describe, expect, it } from "vitest";

import { parseLine } from "../src/l1/parseLine";
import type { ParsedLine } from "../src/l1/types";
import { collectEvents } from "../src/l3/collect";
import {
  NIL_ATTACKER_TWIN_WINDOW_MS,
  nilAttackerAbsorbSources,
} from "../src/l3/nilAttackerAbsorbs";
import { buildRoster } from "../src/l3/roster";

const TZ = { timezone: "UTC" } as const;
/** A line at 12:00:00 + `ms`. */
const at = (ms: number, s: string): ParsedLine => {
  const sec = String(Math.floor(ms / 1000)).padStart(2, "0");
  const frac = String(ms % 1000).padStart(3, "0");
  return parseLine(`6/30/2026 12:00:${sec}.${frac}  ${s}`, TZ)!;
};

const NIL = "0000000000000000,nil,0x80000000,0x80000000";
const SOUL_ID = "Creature-0-1-1-1-254505-000067D039";
const SOUL = `${SOUL_ID},"Desperate Soul",0x2148,0x80000000`;
const B = 'Player-2-B,"Bob-Y",0x512,0x80000000';
const C = 'Player-3-C,"Cara-Z",0x512,0x80000000';
const WRATH = '1278047,"Wrath of Nathreza",0x20';
const ADV_B =
  "Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70";

/** a nil-attacker absorb on B by C's Power Word: Shield */
const nilAbsorb = (ms: number, amount: number, spell = WRATH) =>
  at(
    ms,
    `SPELL_ABSORBED,${NIL},${B},${spell},${C},17,"Power Word: Shield",0x2,${amount},101104,1`,
  );
/** amount, baseAmount, overkill, school, resisted, blocked, absorbed, crit… */
const damage = (ms: number, src: string, absorbed: number, amount = 30321) =>
  at(
    ms,
    `SPELL_DAMAGE,${src},${B},${WRATH},${ADV_B},${amount},${amount + absorbed},-1,32,0,0,${absorbed},1,nil,nil,AOE`,
  );
const missAbsorb = (ms: number, src: string, amount: number) =>
  at(ms, `SPELL_MISSED,${src},${B},${WRATH},ABSORB,nil,${amount},63043,1,AOE`);
const summon = (ms: number) =>
  at(
    ms,
    `SPELL_SUMMON,Player-1-A,"Ann-X",0x548,0x80000000,${SOUL},1278046,"Summon Desperate Soul",0x20`,
  );

const sourcesOf = (records: ParsedLine[]) => {
  const named = nilAttackerAbsorbSources(records);
  return records.map((r) => named.get(r)?.guid);
};
const collect = (records: ParsedLine[]) => {
  records.forEach((r, i) => (r.lineIndex = i));
  return collectEvents(records, buildRoster(records));
};

describe("nilAttackerAbsorbSources — a nil-attacker absorb's source is its hit's own row (fact9 D29 / D31)", () => {
  it("the hit's SPELL_DAMAGE right after, its absorbed field holding the shield's part", () => {
    const rows = [
      summon(0),
      nilAbsorb(3366, 146997),
      damage(3366, SOUL, 146997),
    ];
    expect(sourcesOf(rows)).toEqual([undefined, SOUL_ID, undefined]);
  });

  it("a hit the shield ate whole: its SPELL_MISSED … ABSORB row, a moment later", () => {
    const rows = [nilAbsorb(1000, 106650), missAbsorb(1001, SOUL, 106650)];
    expect(sourcesOf(rows)[0]).toBe(SOUL_ID);
  });

  it("the first such row decides: one that absorbed nothing is another hit", () => {
    const rows = [
      nilAbsorb(1000, 500),
      damage(1000, SOUL, 0),
      damage(1001, SOUL, 500),
    ];
    expect(sourcesOf(rows)[0]).toBeUndefined();
  });

  it("…a row with a nil source names nobody, and a row past the window is not the twin", () => {
    expect(
      sourcesOf([nilAbsorb(1000, 500), damage(1000, NIL, 500)])[0],
    ).toBeUndefined();
    expect(
      sourcesOf([
        nilAbsorb(1000, 500),
        damage(1000 + NIL_ATTACKER_TWIN_WINDOW_MS + 1, SOUL, 500),
      ])[0],
    ).toBeUndefined();
  });

  it("collectEvents: the absorb carries the source as its attacker, and the source's attacker-keyed list has it", () => {
    const units = collect([
      summon(0),
      nilAbsorb(3366, 146997),
      damage(3366, SOUL, 146997),
    ]);
    const ev = units
      .get(SOUL_ID)
      ?.absorbsIn.find((a) => a.absorbedAmount === 146997);
    expect(ev).toBeDefined();
    expect(ev!.attackerId).toBe(SOUL_ID);
    expect(ev!.destName).toBe("Desperate Soul");
    expect(ev!.victimId).toBe("Player-2-B");
    expect(ev!.srcId).toBe("Player-3-C");
  });
});
