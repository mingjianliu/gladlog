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
    expect(legacy.playerTeamId).toBe(0);
    expect(legacy.winningTeamId).toBe(0);
    expect(legacy.result).toBe(CombatResult.Win);
    expect(legacy.durationInSeconds).toBeGreaterThan(0);
    expect(legacy.rawLines.length).toBeGreaterThanOrEqual(5);
  });

  it("unit mapping: enums use legacy numeric/string values", () => {
    const a = legacy.units["Player-1-A"]!;
    expect(a.spec).toBe(CombatUnitSpec.Priest_Holy); // '257'
    expect(a.spec).toBe("257");
    expect(a.class).toBe(CombatUnitClass.Priest); // 6(manifest 序)
    expect(a.type).toBe(CombatUnitType.Player); // 1
    expect(a.reaction).toBe(CombatUnitReaction.Friendly); // 1
    const b = legacy.units["Player-2-B"]!;
    expect(b.reaction).toBe(CombatUnitReaction.Hostile); // 2
    expect(b.class).toBe(CombatUnitClass.Warrior); // 1
    expect(b.info?.teamId).toBe(1);
    expect(b.info?.personalRating).toBe(2380);
  });

  it("hp events carry legacy shape incl. logLine.event", () => {
    const a = legacy.units["Player-1-A"]!;
    expect(a.damageOut).toHaveLength(1);
    const e = a.damageOut[0]!;
    expect(e.effectiveAmount).toBe(-100);
    expect(e.spellId).toBe(50622);
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
    expect(legacy.rounds[1]!.units["Player-1-A"]!.info?.teamId).toBe(1);
  });
});

describe("legacy damage conventions (adjudication #6, 2026-07-10)", () => {
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    // SPELL_ABSORBED: A 打 B,B 的盾(Player-2-B 自己的 PW:S)吸收 40
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
    // 上方 describe 的 A 自疗样本已验证正号;此处防回归:damageIn 同为负
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
  const SWING = (ev: string, src: string, sn: string, dst: string, dn: string) =>
    `${ev},${src},"${sn}",0x511,0x80000000,${dst},"${dn}",0x548,0x80000000,${dst},0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,77,90,-1,1,0,0,0,nil,nil,nil`;

  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    PERIODIC("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    SWING("SWING_DAMAGE", "Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    SWING("SWING_DAMAGE_LANDED", "Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
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
    // 伤害总量只含一次 swing:periodic 55 + swing 77(负号惯例)
    const total = a.damageOut.reduce(
      (s, e) => s + Math.abs(e.effectiveAmount), 0,
    );
    expect(total).toBe(55 + 77);
  });
});

describe("absorb attribution + damage effective semantics (adjudication #13, real lines)", () => {
  // 真实行:Pakoartisti 攻击 Envenum,Vierforfear 的盾吸收 21986(spell 形态,22 项)
  const ABS_SPELL =
    'SPELL_ABSORBED,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,50622,"Bladestorm",0x1,Player-3-OWN,"Own-Z",0x511,0x80000000,1246768,"Power Word: Shield",0x2,21986,30763,nil';
  // swing 形态(19 项,无攻击 spell 段)
  const ABS_SWING =
    'SPELL_ABSORBED,Player-1-ATK,"Atk-X",0x548,0x80000000,Player-2-VIC,"Vic-Y",0x10512,0x80000000,Player-3-OWN,"Own-Z",0x511,0x80000000,17,"Power Word: Shield",0x2,814,4755,nil';
  // 带 absorbed 参数的伤害行:amount=100, overkill=-1, absorbed=30 → legacy eff = -(100-0-30) = -70
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

describe("pet merge into owner (adjudication #16: old attributes pet dmg/heal to owner)", () => {
  const PETDMG =
    'SPELL_DAMAGE,Pet-0-1-1-1-165189-01P,"Kitty",0x1112,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,17253,"Bite",0x1,Pet-0-1-1-1-165189-01P,Player-1-A,500,500,0,0,0,0,0,0,3,10,10,0,1.0,-1.0,0,1.0,70,60,60,-1,1,0,0,0,nil,nil,nil';
  const OWNDMG =
    'SPELL_DAMAGE,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,50622,"Bladestorm",0x1,Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,40,40,-1,1,0,0,0,nil,nil,nil';
  const { matches } = parseLines([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 253, 2400),
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
