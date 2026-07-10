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
    expect(e.effectiveAmount).toBe(100);
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
