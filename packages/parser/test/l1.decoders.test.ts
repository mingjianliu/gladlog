import { splitLine } from "../src/l1/splitTopLevel";
import {
  decodeBaseUnits,
  decodeSpell,
  decodeDamage,
  decodeHeal,
  decodeAdvanced,
  decodeAura,
  decodeExtraSpell,
  decodeAbsorbed,
  decodeArenaStart,
  decodeArenaEnd,
} from "../src/l1/decoders";

const CAST =
  '6/30/2026 19:10:32.0442  SPELL_CAST_SUCCESS,Player-3391-0D728907,"Envenum-Silvermoon-EU",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-3391-0D728907,0000000000000000,561620,561620,2830,486,924,2161,0,0,3,250,250,0,1046.62,-358.72,0,1.9542,298';
const DAMAGE =
  '6/30/2026 19:10:41.7632  SPELL_DAMAGE,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-3679-0D4BB9FB,"Vierforfear-Aegwynn-EU",0x511,0x80000000,50622,"Bladestorm",0x1,Player-3679-0D4BB9FB,0000000000000000,561041,584460,304,2954,761,2116,0,0,0,272876,273000,0,1004.81,-323.10,0,2.0923,298,23419,30536,-1,1,0,0,0,nil,nil,nil,AOE';
const HEAL =
  '6/30/2026 19:10:32.1312  SPELL_HEAL,Player-3679-0D4BB9FB,"Vierforfear-Aegwynn-EU",0x511,0x80000000,Player-580-0AF1D487,"Omnimann-Blackmoore-EU",0x10512,0x80000000,1246798,"Prompt Prognosis",0x2,Player-580-0AF1D487,0000000000000000,556260,556260,304,2982,761,2738,0,22333,0,366720,366720,0,1049.56,-355.02,0,1.9896,298,44431,44431,44431,0,nil';
const AURA =
  '6/30/2026 19:10:31.8032  SPELL_AURA_APPLIED,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,386208,"Defensive Stance",0x1,BUFF,0';
const INTERRUPT =
  '6/30/2026 19:11:32.4812  SPELL_INTERRUPT,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-580-0AF1D487,"Omnimann-Blackmoore-EU",0x10512,0x80000000,6552,"Pummel",0x1,30451,"Arcane Blast",64';
const ABSORBED =
  '6/30/2026 19:10:43.4292  SPELL_ABSORBED,Player-1329-0A8DFA0D,"Pakoartisti-Ravencrest-EU",0x548,0x80000000,Player-3391-0D728907,"Envenum-Silvermoon-EU",0x10512,0x80000000,50622,"Bladestorm",0x1,Player-3679-0D4BB9FB,"Vierforfear-Aegwynn-EU",0x511,0x80000000,1246768,"Power Word: Shield",0x2,21986,30763,nil';
const START = "6/30/2026 19:10:31.7312  ARENA_MATCH_START,1825,41,3v3,1";
const END = "6/30/2026 19:16:08.2682  ARENA_MATCH_END,1,336,2255,2261";

const p = (line: string) => splitLine(line)!.params;

describe("decodeBaseUnits", () => {
  it("decodes src/dest triplets, nil name → null", () => {
    const b = decodeBaseUnits(p(CAST));
    expect(b.srcGuid).toBe("Player-3391-0D728907");
    expect(b.srcName).toBe("Envenum-Silvermoon-EU");
    expect(b.srcFlags).toBe(0x512);
    expect(b.destGuid).toBe("0000000000000000");
    expect(b.destName).toBeNull();
    expect(b.destFlags).toBe(0x80000000);
  });
});

describe("decodeSpell", () => {
  it("reads spellId/name/school at params[8..10]", () => {
    expect(decodeSpell(p(DAMAGE), 8)).toEqual({
      spellId: 50622,
      spellName: "Bladestorm",
      spellSchool: 0x1,
    });
  });
});

describe("decodeDamage", () => {
  it("decodes tail: amount 23419, base 30536, overkill -1 → effective 23419", () => {
    const d = decodeDamage(p(DAMAGE).slice(-11));
    expect(d.amount).toBe(23419);
    expect(d.baseAmount).toBe(30536);
    expect(d.overkill).toBe(-1);
    expect(d.critical).toBe(false);
    expect(d.effectiveAmount).toBe(23419);
  });
});

describe("decodeHeal", () => {
  it("full-overheal heal → effective 0", () => {
    const h = decodeHeal(p(HEAL).slice(-5));
    expect(h.amount).toBe(44431);
    expect(h.overheal).toBe(44431);
    expect(h.critical).toBe(false);
    expect(h.effectiveAmount).toBe(0);
  });
});

describe("decodeAdvanced", () => {
  it("reads hp/maxHp/x/y from the advanced payload of SPELL_DAMAGE", () => {
    const a = decodeAdvanced(p(DAMAGE), 11);
    expect(a.actorGuid).toBe("Player-3679-0D4BB9FB");
    expect(a.hp).toBe(561041);
    expect(a.maxHp).toBe(584460);
    expect(a.x).toBeCloseTo(1004.81);
    expect(a.y).toBeCloseTo(-323.1);
  });
  it("CAST_SUCCESS advanced payload: full-hp actor at 1046.62,-358.72", () => {
    const a = decodeAdvanced(p(CAST), 11);
    expect(a.hp).toBe(561620);
    expect(a.x).toBeCloseTo(1046.62);
  });
});

describe("decodeAura", () => {
  it("BUFF applied", () => {
    expect(decodeAura(p(AURA).slice(11))).toEqual({
      auraType: "BUFF",
      amount: 0,
    });
  });
});

describe("decodeExtraSpell", () => {
  it("interrupt: Pummel kicks Arcane Blast (30451)", () => {
    const e = decodeExtraSpell(p(INTERRUPT).slice(11));
    expect(e.extraSpellId).toBe(30451);
    expect(e.extraSpellName).toBe("Arcane Blast");
  });
});

describe("decodeAbsorbed", () => {
  it("PW:Shield absorbs 21986 of Bladestorm", () => {
    const a = decodeAbsorbed(p(ABSORBED));
    expect(a.shieldSpellId).toBe(1246768);
    expect(a.shieldSpellName).toBe("Power Word: Shield");
    expect(a.shieldOwnerGuid).toBe("Player-3679-0D4BB9FB");
    expect(a.absorbedAmount).toBe(21986);
  });
});

describe("arena markers", () => {
  it("START: zone 1825, bracket 3v3, rated", () => {
    const s = decodeArenaStart(p(START));
    expect(s.zoneId).toBe("1825");
    expect(s.bracket).toBe("3v3");
    expect(s.isRated).toBe(true);
  });
  it("END: team 1 wins, 336s, mmr 2255/2261", () => {
    const e = decodeArenaEnd(p(END));
    expect(e.winningTeamId).toBe(1);
    expect(e.matchDurationSeconds).toBe(336);
    expect(e.team0Mmr).toBe(2255);
    expect(e.team1Mmr).toBe(2261);
  });
});
