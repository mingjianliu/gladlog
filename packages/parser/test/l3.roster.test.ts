import { decodeFlags } from "../src/l3/flags";
import { buildRoster } from "../src/l3/roster";
import { parseLine } from "../src/l1/parseLine";
import type { ParsedLine } from "../src/l1/types";

const TZ = { timezone: "UTC" } as const;
const L = (s: string, i = 0) =>
  parseLine(`6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`, TZ)!;

describe("decodeFlags (Blizzard UnitFlag bits)", () => {
  it("0x511 = mine + friendly + player", () => {
    expect(decodeFlags(0x511)).toEqual({
      affiliation: "Mine",
      reaction: "Friendly",
      kind: "Player",
    });
  });
  it("0x548 = outsider + hostile + player", () => {
    expect(decodeFlags(0x548)).toEqual({
      affiliation: "Outsider",
      reaction: "Hostile",
      kind: "Player",
    });
  });
  it("0x512 = party + friendly + player", () => {
    expect(decodeFlags(0x512).affiliation).toBe("Party");
    expect(decodeFlags(0x512).reaction).toBe("Friendly");
  });
  it("0x2148 = guardian npc-ish (object type guardian)", () => {
    expect(decodeFlags(0x2148).kind).toBe("Guardian");
  });
  it("pet object type 0x1000", () => {
    expect(decodeFlags(0x1112).kind).toBe("Pet");
  });
  it("high extra bits are ignored (0x10512 same as 0x512)", () => {
    expect(decodeFlags(0x10512)).toEqual(decodeFlags(0x512));
  });
});

describe("buildRoster", () => {
  const records: ParsedLine[] = [
    L(
      'SPELL_DAMAGE,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-3679-0D4BB9FB,"Vierforfear-Aegwynn-EU",0x511,0x80000000,50622,"Bladestorm",0x1,Player-3679-0D4BB9FB,0000000000000000,561041,584460,304,2954,761,2116,0,0,0,272876,273000,0,1004.81,-323.10,0,2.0923,298,23419,30536,-1,1,0,0,0,nil,nil,nil,AOE',
      1,
    ),
    L(
      'SPELL_CAST_SUCCESS,Pet-0-3770-1825-90559-165189-0102A806E8,"Kitty",0x1112,0x80000000,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,16827,"Claw",0x1,Pet-0-3770-1825-90559-165189-0102A806E8,Player-3679-0D4BB9FB,50000,50000,0,0,0,0,0,0,3,100,100,0,1000.00,-300.00,0,1.0,70',
      2,
    ),
  ];

  it("registers units with kind/reaction, detects owner via MINE bit", () => {
    const r = buildRoster(records);
    expect(r.ownerId).toBe("Player-3679-0D4BB9FB"); // 0x511 → mine
    const owner = r.units.get("Player-3679-0D4BB9FB")!;
    expect(owner.kind).toBe("Player");
    expect(owner.reaction).toBe("Friendly");
    const enemy = r.units.get("Player-1329-0A8DFA0D")!;
    expect(enemy.reaction).toBe("Hostile");
    expect(enemy.name).toBe("Pakoartisti-Ravencrest-EU");
  });

  it("pet gets ownerId from advanced ownerGuid", () => {
    const r = buildRoster(records);
    const pet = r.units.get("Pet-0-3770-1825-90559-165189-0102A806E8")!;
    expect(pet.kind).toBe("Pet");
    expect(pet.ownerId).toBe("Player-3679-0D4BB9FB");
  });

  it("nil-named zero guid is not registered", () => {
    const r = buildRoster([
      L(
        'UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-1-A,"Alice-X",0x511,0x80000000,0',
        3,
      ),
    ]);
    expect(r.units.has("0000000000000000")).toBe(false);
    expect(r.units.has("Player-1-A")).toBe(true);
  });
});
