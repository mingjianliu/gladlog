import { parseLine } from "../src/l1/parseLine";

const CAST =
  '6/30/2026 19:10:32.0442  SPELL_CAST_SUCCESS,Player-3391-0D728907,"Envenum-Silvermoon-EU",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-3391-0D728907,0000000000000000,561620,561620,2830,486,924,2161,0,0,3,250,250,0,1046.62,-358.72,0,1.9542,298';
const DAMAGE =
  '6/30/2026 19:10:41.7632  SPELL_DAMAGE,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-3679-0D4BB9FB,"Vierforfear-Aegwynn-EU",0x511,0x80000000,50622,"Bladestorm",0x1,Player-3679-0D4BB9FB,0000000000000000,561041,584460,304,2954,761,2116,0,0,0,272876,273000,0,1004.81,-323.10,0,2.0923,298,23419,30536,-1,1,0,0,0,nil,nil,nil,AOE';
const AURA =
  '6/30/2026 19:10:31.8032  SPELL_AURA_APPLIED,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,386208,"Defensive Stance",0x1,BUFF,0';
const INTERRUPT =
  '6/30/2026 19:11:32.4812  SPELL_INTERRUPT,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-580-0AF1D487,"Omnimann-Blackmoore-EU",0x10512,0x80000000,6552,"Pummel",0x1,30451,"Arcane Blast",64';
const DIED =
  '6/30/2026 19:11:20.8792  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Creature-0-3770-1825-90559-166949-000043F8A0,"Chi-Ji",0x2148,0x80000000,0';
const START = "6/30/2026 19:10:31.7312  ARENA_MATCH_START,1825,41,3v3,1";
const END = "6/30/2026 19:16:08.2682  ARENA_MATCH_END,1,336,2255,2261";

describe("parseLine family assembly", () => {
  it("SPELL_DAMAGE: base + spell + advanced + damage, known", () => {
    const r = parseLine(DAMAGE, { timezone: "UTC" })!;
    expect(r.known).toBe(true);
    expect(r.eventName).toBe("SPELL_DAMAGE");
    expect(r.timestamp).toBe(Date.UTC(2026, 5, 30, 19, 10, 41, 763));
    expect(r.base?.srcName).toBe("Pakoartisti-Ravencrest-EU");
    expect(r.spell?.spellId).toBe(50622);
    expect(r.advanced?.hp).toBe(561041);
    expect(r.damage?.effectiveAmount).toBe(23419);
    expect(r.heal).toBeUndefined();
    expect(r.raw).toBe(DAMAGE);
  });

  it("SPELL_CAST_SUCCESS: base + spell + advanced, no damage/heal", () => {
    const r = parseLine(CAST, { timezone: "UTC" })!;
    expect(r.spell?.spellId).toBe(2983);
    expect(r.advanced?.x).toBeCloseTo(1046.62);
    expect(r.damage).toBeUndefined();
  });

  it("SPELL_AURA_APPLIED: base + spell + aura", () => {
    const r = parseLine(AURA, { timezone: "UTC" })!;
    expect(r.aura?.auraType).toBe("BUFF");
    expect(r.spell?.spellId).toBe(386208);
    expect(r.advanced).toBeUndefined();
  });

  it("SPELL_INTERRUPT: base + spell + extraSpell", () => {
    const r = parseLine(INTERRUPT, { timezone: "UTC" })!;
    expect(r.extraSpell?.extraSpellId).toBe(30451);
  });

  it("UNIT_DIED: base only, dest is the dead unit", () => {
    const r = parseLine(DIED, { timezone: "UTC" })!;
    expect(r.known).toBe(true);
    expect(r.base?.destGuid).toBe(
      "Creature-0-3770-1825-90559-166949-000043F8A0",
    );
    expect(r.spell).toBeUndefined();
  });

  it("ARENA_MATCH_START / END markers", () => {
    expect(parseLine(START, { timezone: "UTC" })!.arenaStart?.bracket).toBe(
      "3v3",
    );
    expect(parseLine(END, { timezone: "UTC" })!.arenaEnd?.winningTeamId).toBe(
      1,
    );
  });

  it("unknown event → generic record with known:false, params preserved", () => {
    const r = parseLine("6/30/2026 19:10:31.0000  SOME_FUTURE_EVENT,1,2", {
      timezone: "UTC",
    })!;
    expect(r.known).toBe(false);
    expect(r.eventName).toBe("SOME_FUTURE_EVENT");
    expect(r.params).toEqual(["1", "2"]);
  });

  it("garbage and empty lines → null, never throws", () => {
    expect(parseLine("total garbage")).toBeNull();
    expect(parseLine("")).toBeNull();
    expect(parseLine("6/30/2026 19:10:31.0000  ,,,")).toBeNull();
  });
});
