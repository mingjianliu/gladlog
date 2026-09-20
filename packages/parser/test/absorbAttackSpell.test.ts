import { describe, expect, it } from "vitest";

import { GladLogParser, parseLine } from "../src";
import type { GladMatch } from "../src/l3/model";

const CI = (guid: string, team: number, spec: number) =>
  `COMBATANT_INFO,${guid},${team},1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,${spec},[(1,2,1)],(0,1,2,3),[(100,200,())],[],248,41,2400,13`;
// a Grounding Totem eating Living Flame: victim AND shield owner are the totem
const TOTEM = "Creature-0-1465-1911-23692-5925-000005F97F";
const GROUNDED = `SPELL_ABSORBED,Player-1-A,"Alice-X",0x548,0x80000000,${TOTEM},"Grounding Totem",0x2148,0x80000000,361500,"Living Flame",0x4,${TOTEM},"Grounding Totem",0x2148,0x80000000,242900,"Grounding Totem",0x1,64083,42722,1`;
const SWING = `SPELL_ABSORBED,Player-1-A,"Alice-X",0x548,0x80000000,Player-2-B,"Bob-Y",0x511,0x80000000,Player-2-B,"Bob-Y",0x511,0x80000000,17,"Power Word: Shield",0x2,25,90,nil`;
const ts = (i: number) => `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  `;

describe("SPELL_ABSORBED keeps the attacker's spell (GH #100)", () => {
  it("L1: spell form decodes it, swing form has none", () => {
    const a = parseLine(ts(1) + GROUNDED)!.absorbed!;
    expect(a.shieldSpellId).toBe(242900);
    expect(a.attackSpellId).toBe(361500);
    expect(a.attackSpellName).toBe("Living Flame");
    const s = parseLine(ts(2) + SWING)!.absorbed!;
    expect(s.attackSpellId).toBeNull();
    expect(s.attackSpellName).toBeNull();
  });

  it("L3: materialised on the event, so it survives the params slimming that clears its source", () => {
    const parser = new GladLogParser({ timezone: "UTC" });
    let match: GladMatch | null = null;
    parser.on("match", (m: GladMatch) => (match = m));
    const lines = [
      "ARENA_MATCH_START,1825,41,3v3,1",
      CI("Player-1-A", 0, 1467),
      CI("Player-2-B", 1, 264),
      `SPELL_SUMMON,Player-2-B,"Bob-Y",0x511,0x80000000,${TOTEM},"Grounding Totem",0x2148,0x80000000,204336,"Grounding Totem",0x8`,
      GROUNDED,
      SWING,
      "ARENA_MATCH_END,0,30,1500,1501",
    ];
    lines.forEach((l, i) => parser.push(ts(i) + l));
    parser.end();
    const attacker = match!.units["Player-1-A"]!;
    const eaten = attacker.absorbsIn.find((e) => e.victimId === TOTEM)!;
    expect(eaten.spellId).toBe(242900); // the shield
    expect(eaten.attackSpellId).toBe(361500); // what it ate
    expect(eaten.attackSpellName).toBe("Living Flame");
    expect(eaten.params[8] ?? "").toBe(""); // the raw source is gone after slimming
    const swing = attacker.absorbsIn.find((e) => e.victimId === "Player-2-B")!;
    expect("attackSpellId" in swing).toBe(false);
  });
});
