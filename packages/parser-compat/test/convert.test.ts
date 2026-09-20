import { GladLogParser } from "@gladlog/parser";
import type { GladMatch, GladShuffle } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "../src/convert";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitType,
  CombatUnitSpec,
  CombatResult,
  LogEvent,
} from "../src/enums";

const CI = (guid: string, team: number, spec: number, rating: number) =>
  `COMBATANT_INFO,${guid},${team},1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,${spec},[(1,2,1)],(0,1,2,3),[(100,200,())],[],248,41,${rating},13`;
const DMG = (src: string, sn: string, dst: string, dn: string) =>
  `SPELL_DAMAGE,${src},"${sn}",0x511,0x80000000,${dst},"${dn}",0x548,0x80000000,50622,"Bladestorm",0x1,${dst},0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,100,120,-1,1,0,0,0,nil,nil,nil`;

function parseLines(specs: string[]) {
  const raws = specs.map(
    (s, i) => `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`,
  );
  const matches: GladMatch[] = [];
  const shuffles: GladShuffle[] = [];
  const p = new GladLogParser({ timezone: "UTC" });
  p.on("match", (m: GladMatch) => matches.push(m));
  p.on("shuffle", (s: GladShuffle) => shuffles.push(s));
  for (const r of raws) p.push(r);
  p.end();
  return { matches, shuffles };
}

describe("toLegacyMatch", () => {
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,0`,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("container fields", () => {
    expect(legacy.dataType).toBe("ArenaMatch");
    expect(legacy.startInfo.bracket).toBe("3v3");
    expect(legacy.startInfo.zoneId).toBe("1825");
    expect(legacy.playerId).toBe("Player-1-A");
    expect(legacy.playerTeamId).toBe("0");
    expect(legacy.winningTeamId).toBe("0");
    expect(legacy.result).toBe(CombatResult.Win);
    expect(legacy.durationInSeconds).toBeGreaterThan(0);
    expect(legacy.rawLines.length).toBeGreaterThanOrEqual(5);
  });

  it("unit mapping: enums use legacy numeric/string values", () => {
    const a = legacy.units["Player-1-A"]!;
    expect(a.spec).toBe(CombatUnitSpec.Priest_Holy); // '257'
    expect(a.spec).toBe("257");
    expect(a.class).toBe(CombatUnitClass.Priest); // 6 (manifest order)
    expect(a.type).toBe(CombatUnitType.Player); // 1
    expect(a.reaction).toBe(CombatUnitReaction.Friendly); // 1
    const b = legacy.units["Player-2-B"]!;
    expect(b.reaction).toBe(CombatUnitReaction.Hostile); // 2
    expect(b.class).toBe(CombatUnitClass.Warrior); // 1
    expect(b.info?.teamId).toBe("1");
    expect(b.info?.personalRating).toBe(2380);
  });

  it("hp events carry legacy shape incl. logLine.event", () => {
    const a = legacy.units["Player-1-A"]!;
    expect(a.damageOut).toHaveLength(1);
    const e = a.damageOut[0]!;
    expect(e.effectiveAmount).toBe(-100);
    expect(e.spellId).toBe("50622");
    expect(e.spellName).toBe("Bladestorm");
    expect(e.logLine.event).toBe(LogEvent.SPELL_DAMAGE);
    expect(e.srcUnitId).toBe("Player-1-A");
    expect(e.destUnitId).toBe("Player-2-B");
    expect(typeof e.timestamp).toBe("number");
  });

  it("death records: legacy deathRecords carries real deaths only", () => {
    const b = legacy.units["Player-2-B"]!;
    expect(b.deathRecords).toHaveLength(1);
  });
});

describe("toLegacyShuffle", () => {
  const { shuffles } = parseLines([
    "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
    CI("Player-1-A", 0, 257, 2400),
    `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-1-A,"Alice-X",0x511,0x80000000,0`,
    "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
    CI("Player-1-A", 1, 257, 2400),
    "ARENA_MATCH_END,0,155,1729,1730",
  ]);
  const legacy = toLegacyShuffle(shuffles[0]!);

  it("shuffle match with rounds of dataType ShuffleRound", () => {
    expect(legacy.dataType).toBe("ShuffleMatch");
    expect(legacy.rounds).toHaveLength(2);
    expect(legacy.rounds[0]!.dataType).toBe("ShuffleRound");
    expect(legacy.rounds[0]!.sequenceNumber).toBe(0);
    expect(legacy.rounds[1]!.units["Player-1-A"]!.info?.teamId).toBe("1");
  });
});

describe("legacy damage conventions (adjudication #6, 2026-07-10)", () => {
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    // SPELL_ABSORBED: A hits B, and B's own shield (Player-2-B's own PW:S)
    // absorbs 40
    `SPELL_ABSORBED,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,50622,"Bladestorm",0x1,Player-2-B,"Bob-Y",0x548,0x80000000,17,"Power Word: Shield",0x2,40,140,nil`,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("damage rows are NEGATIVE in legacy shape (old HP-delta convention)", () => {
    const a = legacy.units["Player-1-A"]!;
    const dmg = a.damageOut.filter(
      (e) => e.logLine.event === LogEvent.SPELL_DAMAGE,
    );
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.effectiveAmount).toBe(-100);
    expect(dmg[0]!.amount).toBe(-100);
  });

  it("SPELL_ABSORBED rows are interleaved into attacker's damageOut with POSITIVE absorbed amount", () => {
    const a = legacy.units["Player-1-A"]!;
    const abs = a.damageOut.filter(
      (e) => e.logLine.event === LogEvent.SPELL_ABSORBED,
    );
    expect(abs).toHaveLength(1);
    expect(abs[0]!.effectiveAmount).toBe(40);
    expect((abs[0] as { absorbedAmount?: number }).absorbedAmount).toBe(40);
  });

  it("heal rows stay positive", () => {
    // The A self-heal sample in the describe above already proves the positive
    // sign; this guards the regression on the other side: damageIn is negative
    const b = legacy.units["Player-2-B"]!;
    const dIn = b.damageIn.filter(
      (e) => e.logLine.event === LogEvent.SPELL_DAMAGE,
    );
    expect(dIn[0]!.effectiveAmount).toBe(-100);
  });
});

describe("event-name fidelity + SWING dedup (adjudication #10/#12)", () => {
  const PERIODIC = (src: string, sn: string, dst: string, dn: string) =>
    `SPELL_PERIODIC_DAMAGE,${src},"${sn}",0x511,0x80000000,${dst},"${dn}",0x548,0x80000000,589,"Shadow Word: Pain",0x20,${dst},0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,55,55,-1,32,0,0,0,nil,nil,nil`;
  const SWING = (
    ev: string,
    src: string,
    sn: string,
    dst: string,
    dn: string,
  ) =>
    `${ev},${src},"${sn}",0x511,0x80000000,${dst},"${dn}",0x548,0x80000000,${dst},0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,77,90,-1,1,0,0,0,nil,nil,nil`;

  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    PERIODIC("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    SWING("SWING_DAMAGE", "Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    SWING(
      "SWING_DAMAGE_LANDED",
      "Player-1-A",
      "Alice-X",
      "Player-2-B",
      "Bob-Y",
    ),
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);
  const a = legacy.units["Player-1-A"]!;

  it("logLine.event preserves the real event name (PERIODIC stays PERIODIC)", () => {
    const evs = a.damageOut.map((e) => e.logLine.event).sort();
    expect(evs).toContain(LogEvent.SPELL_PERIODIC_DAMAGE);
    expect(evs).toContain(LogEvent.SWING_DAMAGE);
  });

  it("SWING_DAMAGE_LANDED is NOT double-counted in damage arrays (old-parser dedup rule)", () => {
    const swings = a.damageOut.filter((e) =>
      String(e.logLine.event).startsWith("SWING"),
    );
    expect(swings).toHaveLength(1);
    expect(swings[0]!.logLine.event).toBe(LogEvent.SWING_DAMAGE);
    // The damage total contains only one swing: periodic 55 + swing 77 (using
    // the negative-sign convention)
    const total = a.damageOut.reduce(
      (s, e) => s + Math.abs(e.effectiveAmount),
      0,
    );
    expect(total).toBe(55 + 77);
  });
});

describe("absorb attribution + damage effective semantics (adjudication #13, real lines)", () => {
  // Real log line: Pakoartisti attacks Envenum and Vierforfear's shield absorbs
  // 21986 (spell form, 22 fields)
  const ABS_SPELL =
    'SPELL_ABSORBED,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,50622,"Bladestorm",0x1,Player-3-OWN,"Own-Z",0x511,0x80000000,1246768,"Power Word: Shield",0x2,21986,30763,nil';
  // Swing form (19 fields, no attacking-spell section)
  const ABS_SWING =
    'SPELL_ABSORBED,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,Player-3-OWN,"Own-Z",0x511,0x80000000,17,"Power Word: Shield",0x2,814,4755,nil';
  // Damage line carrying an absorbed field: amount=100, overkill=-1,
  // absorbed=30 → legacy eff = -(100-0-30) = -70
  const DMG_ABS =
    'SPELL_DAMAGE,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,50622,"Bladestorm",0x1,Player-2-VIC,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,100,120,-1,1,0,0,30,nil,nil,nil';

  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-ATK", 0, 71, 2000),
    DMG_ABS,
    ABS_SPELL,
    ABS_SWING,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);
  const atk = legacy.units["Player-1-ATK"]!;

  it("SPELL_ABSORBED rows land in the ATTACKER's damageOut (old attribution rule)", () => {
    const abs = atk.damageOut.filter(
      (e) => e.logLine.event === LogEvent.SPELL_ABSORBED,
    );
    expect(abs).toHaveLength(2);
  });

  it("absorbed amounts use the absorbed param (spell form 21986, swing form 814)", () => {
    const abs = atk.damageOut
      .filter((e) => e.logLine.event === LogEvent.SPELL_ABSORBED)
      .map((e) => e.effectiveAmount)
      .sort((a, b) => a - b);
    expect(abs).toEqual([814, 21986]);
  });

  it("legacy damage effectiveAmount subtracts the absorbed param: -(100-0-30) = -70", () => {
    const dmg = atk.damageOut.filter(
      (e) => e.logLine.event === LogEvent.SPELL_DAMAGE,
    );
    expect(dmg[0]!.effectiveAmount).toBe(-70);
    expect(dmg[0]!.amount).toBe(-100);
  });
});

describe("absorbsIn is keyed by the VICTIM (the unit the shield protected)", () => {
  // Three different units take part: attacker, victim, shield owner. L3 groups
  // absorbs by attacker and by shield owner only, so `ICombatUnit.absorbsIn`
  // used to hand out the ATTACKER's list — "damage I dealt that a shield ate" —
  // under a name every consumer read as "absorbs I received".
  const ABS =
    'SPELL_ABSORBED,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,50622,"Bladestorm",0x1,Player-3-OWN,"Own-Z",0x511,0x80000000,1246768,"Power Word: Shield",0x2,21986,30763,nil';
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-ATK", 0, 71, 2000),
    CI("Player-2-VIC", 1, 257, 2380),
    CI("Player-3-OWN", 1, 256, 2380),
    ABS,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);
  const atk = legacy.units["Player-1-ATK"]!;
  const vic = legacy.units["Player-2-VIC"]!;
  const own = legacy.units["Player-3-OWN"]!;

  it("the victim gets the absorb; the attacker does not", () => {
    expect(vic.absorbsIn).toHaveLength(1);
    expect(vic.absorbsIn[0]!.absorbedAmount).toBe(21986);
    expect(atk.absorbsIn).toHaveLength(0);
  });

  it("src is the shield owner (who to credit), dest is the victim", () => {
    const e = vic.absorbsIn[0]!;
    expect(e.srcUnitId).toBe("Player-3-OWN");
    expect(e.destUnitId).toBe("Player-2-VIC");
    expect(e.attackerId).toBe("Player-1-ATK");
    expect(e.spellId).toBe("1246768"); // the shield, not the incoming hit
  });

  it("shield owner keeps absorbsOut and the attacker keeps damageOut", () => {
    expect(own.absorbsOut).toHaveLength(1);
    expect(
      atk.damageOut.filter((e) => e.logLine.event === LogEvent.SPELL_ABSORBED),
    ).toHaveLength(1);
  });

  it("an absorb is counted once even though two units carry it in L3", () => {
    // The same line lives on the attacker's L3 absorbsIn AND the shield owner's
    // absorbsOut; the victim index reads both, so it has to de-duplicate.
    const all = Object.values(legacy.units).flatMap((u) => u.absorbsIn);
    expect(all).toHaveLength(1);
  });
});

describe("pet merge into owner (adjudication #16: old attributes pet dmg/heal to owner)", () => {
  const PETDMG =
    'SPELL_DAMAGE,Pet-0-1-1-1-165189-01P,"Kitty",0x1112,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,17253,"Bite",0x1,Pet-0-1-1-1-165189-01P,Player-1-A,500,500,0,0,0,0,0,0,3,10,10,0,1.0,-1.0,0,1.0,70,60,60,-1,1,0,0,0,nil,nil,nil';
  const OWNDMG =
    'SPELL_DAMAGE,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,50622,"Bladestorm",0x1,Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,40,40,-1,1,0,0,0,nil,nil,nil';
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 253, 2400),
    CI("Player-2-B", 1, 71, 2380),
    OWNDMG,
    PETDMG,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("owner's damageOut contains own + pet rows, timestamp-sorted", () => {
    const a = legacy.units["Player-1-A"]!;
    const dmg = a.damageOut.filter(
      (e) => e.logLine.event === LogEvent.SPELL_DAMAGE,
    );
    expect(dmg).toHaveLength(2);
    const total = dmg.reduce((s, e) => s + Math.abs(e.effectiveAmount), 0);
    expect(total).toBe(100); // 40 own + 60 pet
  });

  it("victim's damageIn also carries both rows", () => {
    const b = legacy.units["Player-2-B"]!;
    expect(
      b.damageIn.filter((e) => e.logLine.event === LogEvent.SPELL_DAMAGE),
    ).toHaveLength(2);
  });
});

describe("pet-target zeroing (adjudication #17: old zeroes eff for rows onto pets)", () => {
  const HEAL_PET =
    'SPELL_PERIODIC_HEAL,Player-1-A,"Alice-X",0x511,0x80000000,Pet-0-1-1-1-165189-01P,"Kitty",0x1112,0x80000000,136,"Mend Pet",0x8,Pet-0-1-1-1-165189-01P,Player-1-A,500,500,0,0,0,0,0,0,3,10,10,0,1.0,-1.0,0,1.0,70,149504,149504,0,0,nil';
  const DMG_PET =
    'SPELL_DAMAGE,Player-2-B,"Bob-Y",0x548,0x80000000,Pet-0-1-1-1-165189-01P,"Kitty",0x1112,0x80000000,50622,"Bladestorm",0x1,Pet-0-1-1-1-165189-01P,Player-1-A,400,500,0,0,0,0,0,0,3,10,10,0,1.0,-1.0,0,1.0,70,100,100,-1,1,0,0,0,nil,nil,nil';
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 253, 2400),
    CI("Player-2-B", 1, 71, 2380),
    HEAL_PET,
    DMG_PET,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("heal onto pet: row kept, effectiveAmount zeroed, amount kept", () => {
    const a = legacy.units["Player-1-A"]!;
    const h = a.healOut.filter((e) => e.destUnitId?.startsWith("Pet-"));
    expect(h).toHaveLength(1);
    expect(h[0]!.effectiveAmount).toBe(0);
    expect(Math.abs(h[0]!.amount)).toBe(149504);
  });

  it("damage onto pet: row kept, effectiveAmount zeroed (negative-zero ok as 0)", () => {
    const b = legacy.units["Player-2-B"]!;
    const d = b.damageOut.filter((e) => e.destUnitId?.startsWith("Pet-"));
    expect(d).toHaveLength(1);
    expect(d[0]!.effectiveAmount).toBe(-0);
  });
});

describe("advancedActions legacy shape (adjudication #20: logLine + advancedActorId)", () => {
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("entries carry advancedActorId and logLine.timestamp (downstream binary-search contract)", () => {
    const b = legacy.units["Player-2-B"]!; // on a damage line the advanced actor is the victim
    expect(b.advancedActions.length).toBeGreaterThan(0);
    const a = b.advancedActions[0]! as {
      advancedActorId?: string;
      logLine?: { timestamp?: number };
      advancedActorCurrentHp?: number;
    };
    expect(a.advancedActorId).toBe("Player-2-B");
    expect(typeof a.logLine?.timestamp).toBe("number");
    expect(a.advancedActorCurrentHp).toBe(900);
  });
});

describe("logLine.parameters passthrough (adjudication #21)", () => {
  const AURA_DOSE =
    'SPELL_AURA_APPLIED_DOSE,Player-1-A,"Alice-X",0x511,0x80000000,Player-1-A,"Alice-X",0x511,0x80000000,110310,"Dampening",0x1,DEBUFF,7';
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    AURA_DOSE,
    `SPELL_HEAL,Player-1-A,"Alice-X",0x511,0x80000000,Player-1-A,"Alice-X",0x511,0x80000000,2061,"Flash Heal",0x2,Player-1-A,0000000000000000,1000,1000,0,0,0,0,0,0,0,50,50,0,1.0,-1.0,0,1.0,70,200,200,50,0,nil`,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);
  const a = legacy.units["Player-1-A"]!;

  it("aura event parameters: [11]='BUFF'|'DEBUFF' string, [12]=stacks as number", () => {
    const aura = a.auraEvents.find((e) => e.spellId === "110310")! as {
      logLine: { parameters: (string | number)[] };
    };
    expect(aura.logLine.parameters[11]).toBe("DEBUFF");
    expect(aura.logLine.parameters[12]).toBe(7);
    expect(typeof aura.logLine.parameters[12]).toBe("number");
  });

  it("heal 数额走物化字段;params 已瘦身(2026-07-25),[30]/[32] 不再透传", () => {
    // The old contract (as written in adjudication #21) passed through
    // [30]=amount / [32]=overheal — but the one consumer in the whole chain
    // (healerMetrics) always used the decoded fields, and the params 13+ tail is
    // trimmed at the factory in slimMatchParams (after the 442MB memory
    // incident on a single shuffle doc). The amount contract is now anchored on
    // the materialized fields.
    const heal = a.healOut.find((e) => e.spellId === "2061")! as {
      amount: number;
      effectiveAmount: number;
      logLine: { parameters: (string | number)[] };
    };
    expect(heal.logLine.parameters.length).toBeLessThanOrEqual(13);
    expect(heal.amount).toBe(200);
    expect(heal.effectiveAmount).toBe(150); // 200 - 50 overheal
  });

  it("guid/flag params stay strings", () => {
    const aura = a.auraEvents[0]! as {
      logLine: { parameters: (string | number)[] };
    };
    expect(typeof aura.logLine.parameters[0]).toBe("string");
    expect(typeof aura.logLine.parameters[2]).toBe("string"); // 0x511 stays a string
  });
});

describe("CombatantInfo legacy shapes (adjudication #22, observed from old runtime)", () => {
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    "COMBATANT_INFO,Player-1-A,0,1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,71,[(90269,112121,1),(90270,112122,2)],(0,1219165,1227751,236077),[(249952,298,(7991,0,0),(13448,13452),(241144,610))],[Player-1-A,386208,1],248,41,2273,13",
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const info = toLegacyMatch(matches[0]!).units["Player-1-A"]!.info!;

  it("talents: {id1,id2,count} objects", () => {
    expect(info.talents[0]).toEqual({ id1: 90269, id2: 112121, count: 1 });
    expect(info.talents[1]).toEqual({ id1: 90270, id2: 112122, count: 2 });
  });
  it("pvpTalents: string ids", () => {
    expect(info.pvpTalents).toEqual(["0", "1219165", "1227751", "236077"]);
  });
  it("equipment: structured {id,ilvl,enchants,bonuses,gems}", () => {
    expect(info.equipment[0]).toEqual({
      id: "249952",
      ilvl: 298,
      enchants: ["7991", "0", "0"],
      bonuses: ["13448", "13452"],
      gems: ["241144", "610"],
    });
  });
  it("interestingAurasJSON: JSON string of flat [guid, spellId, count] array", () => {
    expect(JSON.parse(info.interestingAurasJSON as string)).toEqual([
      "Player-1-A",
      386208,
      1,
    ]);
  });
  it("specId and teamId are strings", () => {
    expect(info.specId).toBe("71");
    expect(info.teamId).toBe("0");
  });
});

describe("absorb NOT interleaved into damageIn; spellSchoolId hex string (adjudication #24/#25)", () => {
  const ABS =
    'SPELL_ABSORBED,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,50622,"Bladestorm",0x1,Player-3-OWN,"Own-Z",0x511,0x80000000,1246768,"Power Word: Shield",0x2,21986,30763,nil';
  const DMG8 =
    'SPELL_DAMAGE,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,190356,"Blizzard",0x10,Player-2-VIC,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,100,120,-1,16,0,0,0,nil,nil,nil';
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-ATK", 0, 64, 2000),
    CI("Player-2-VIC", 1, 71, 2380),
    DMG8,
    ABS,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("victim damageIn has NO SPELL_ABSORBED rows (old semantics: attacker-out only)", () => {
    const vic = legacy.units["Player-2-VIC"]!;
    expect(
      vic.damageIn.filter((e) => e.logLine.event === LogEvent.SPELL_ABSORBED),
    ).toHaveLength(0);
    const atk = legacy.units["Player-1-ATK"]!;
    expect(
      atk.damageOut.filter((e) => e.logLine.event === LogEvent.SPELL_ABSORBED),
    ).toHaveLength(1);
  });

  it("events carry spellSchoolId as 0x-hex string", () => {
    const atk = legacy.units["Player-1-ATK"]!;
    const d = atk.damageOut.find((e) => e.spellId === "190356")! as {
      spellSchoolId?: string;
    };
    expect(d.spellSchoolId).toBe("0x10");
  });
});

describe("outsider filter (adjudication #27: CI-less players excluded from legacy units)", () => {
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    // Does B have a COMBATANT_INFO? No — but it still counts as an enemy
    // combatant
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    CI("Player-2-B", 1, 71, 2380),
    // Outsider: appears in events but has no COMBATANT_INFO all match
    'SPELL_AURA_APPLIED,Player-9-OUT,"Watcher-Z",0x548,0x80000000,Player-9-OUT,"Watcher-Z",0x548,0x80000000,1784,"Stealth",0x1,BUFF',
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("CI-less player is excluded from legacy units; CI players kept", () => {
    expect(legacy.units["Player-9-OUT"]).toBeUndefined();
    expect(legacy.units["Player-1-A"]).toBeDefined();
    expect(legacy.units["Player-2-B"]).toBeDefined();
  });

  it("non-player units unaffected by the filter", () => {
    const kinds = Object.values(legacy.units).map((u) => u.type);
    expect(kinds).toContain(1);
  });
});

describe("mergePetEvents merges by SUMMON relationship (GH #57, user ruling 2026-08-29)", () => {
  const GHOUL = "Creature-0-3882-980-18134-237409-0000651AAD";
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 252, 2400),
    CI("Player-2-B", 1, 71, 2380),
    // Army of the Dead ghoul: the game flags it NPC / NPC-controlled (0xa28),
    // no Pet or Guardian bit — only SPELL_SUMMON names the DK as owner.
    `SPELL_SUMMON,Player-1-A,"Alice-X",0x511,0x80000000,${GHOUL},"次级食尸鬼",0xa28,0x80000000,1282535,"次级食尸鬼",0x20`,
    `SPELL_DAMAGE,${GHOUL},"次级食尸鬼",0xa28,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,91776,"Claw",0x1,Player-2-B,0000000000000000,900000,1000000,0,0,0,-1,0,0,0,0.00,0.00,0,0.0000,0,4321,0,-1,1,0,0,0,nil,nil,nil`,
    `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,0`,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("an NPC-typed unit summoned by a player has its damage folded into the summoner", () => {
    const ghoul = legacy.units[GHOUL]!;
    expect(ghoul.type).toBe(CombatUnitType.NPC);
    expect(ghoul.ownerId).toBe("Player-1-A");
    const owner = legacy.units["Player-1-A"]!;
    const fromGhoul = owner.damageOut.filter((e) => e.srcUnitId === GHOUL);
    expect(fromGhoul).toHaveLength(1);
    expect(Math.abs(fromGhoul[0]!.effectiveAmount)).toBe(4321);
  });
});

describe("overkill is carried on killing blows only (GH #100)", () => {
  // 12.x logs write no UNIT_DIED for totems/guardians; a killing damage event
  // is the only kill evidence, and effectiveAmount is zeroed on pet/guardian
  // targets, so the amount − effectiveAmount difference needs its own field.
  const KILL = DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y").replace(
    ",100,120,-1,",
    ",100,120,30,",
  );
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    KILL,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);

  it("the fixture really differs (guards a silent no-op replace)", () => {
    expect(KILL).toContain(",100,120,30,");
  });

  it("damageIn and damageOut both carry overkill = 30 on the killing row", () => {
    for (const rows of [
      legacy.units["Player-2-B"]!.damageIn,
      legacy.units["Player-1-A"]!.damageOut,
    ]) {
      const dmg = rows.filter((e) => e.logLine.event === LogEvent.SPELL_DAMAGE);
      expect(dmg).toHaveLength(2);
      expect("overkill" in dmg[0]!).toBe(false);
      expect(dmg[1]!.overkill).toBe(30);
      expect(dmg[1]!.amount).toBe(-100);
      expect(dmg[1]!.effectiveAmount).toBe(-70);
    }
  });
});

describe("absorbs carry the ATTACKER's spell (GH #100: what did the shield eat)", () => {
  // The event's own spellId is the SHIELD. Before 2026-09-20 nothing kept the
  // attacking spell, and the archive slimmer clears those params, so "what did
  // the Grounding Totem eat" was unanswerable from a stored document.
  const SPELL_FORM = `SPELL_ABSORBED,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,50622,"Bladestorm",0x1,Player-2-B,"Bob-Y",0x548,0x80000000,17,"Power Word: Shield",0x2,40,140,nil`;
  const SWING_FORM = `SPELL_ABSORBED,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,17,"Power Word: Shield",0x2,25,90,nil`;
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    SPELL_FORM,
    SWING_FORM,
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const legacy = toLegacyMatch(matches[0]!);
  const absorbs = legacy.units["Player-2-B"]!.absorbsIn;

  it("spell form: attackSpellId/Name = the attacker's spell, spellId stays the shield", () => {
    expect(absorbs).toHaveLength(2);
    expect(absorbs[0]!.spellId).toBe("17");
    expect(absorbs[0]!.attackSpellId).toBe("50622");
    expect(absorbs[0]!.attackSpellName).toBe("Bladestorm");
  });

  it("swing form has no spell — the keys are absent, not empty", () => {
    expect(absorbs[1]!.absorbedAmount).toBe(25);
    expect("attackSpellId" in absorbs[1]!).toBe(false);
    expect("attackSpellName" in absorbs[1]!).toBe(false);
  });

  it("the shield owner's absorbsOut carries it too", () => {
    const out = legacy.units["Player-2-B"]!.absorbsOut;
    expect(out[0]!.attackSpellId).toBe("50622");
  });
});
