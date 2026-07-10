import { parseLine } from "../src/l1/parseLine";
import { Segmenter } from "../src/l2/segmenter";
import { buildMatch, buildShuffle } from "../src/l3/compose";
import type { Segment, ShuffleClose } from "../src/l2/types";
import type { GladMatch, GladShuffle } from "../src/l3/model";

const TZ = { timezone: "UTC" } as const;

function collect(specs: string[]) {
  const raws = specs.map(
    (s, i) => `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`,
  );
  const matches: { seg: Segment; end: ReturnType<typeof parseLine> }[] = [];
  const shuffles: ShuffleClose[] = [];
  const seg = new Segmenter();
  seg.onMatch((s, end) => matches.push({ seg: s, end }));
  seg.onShuffle((s) => shuffles.push(s));
  for (const raw of raws) {
    const p = parseLine(raw, TZ);
    if (p) seg.push(p, raw);
  }
  seg.end();
  return { matches, shuffles };
}

// 极简 CI 行:playerGuid + teamId + 22 个属性占位(与真实行对齐),再 specId、talents、pvp、equip、auras、honor,season,rating,tier
const CI = (guid: string, team: number, spec: number, rating: number) =>
  `COMBATANT_INFO,${guid},${team},1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,${spec},[(1,2,1)],(0,1,2,3),[(100,200,())],[],248,41,${rating},13`;

const DMG = (
  src: string,
  sn: string,
  dst: string,
  dn: string,
  dstFlags = "0x548",
) =>
  `SPELL_DAMAGE,${src},"${sn}",0x511,0x80000000,${dst},"${dn}",${dstFlags},0x80000000,50622,"Bladestorm",0x1,${dst},0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,100,120,-1,1,0,0,0,nil,nil,nil`;

const DIE = (guid: string, name: string, unconscious: 0 | 1, flags = "0x548") =>
  `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${guid},"${name}",${flags},0x80000000,${unconscious}`;

describe("buildMatch (2v2/3v3)", () => {
  const { matches } = collect([
    "ARENA_MATCH_START,1825,41,3v3,1",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    DIE("Player-2-B", "Bob-Y", 0),
    "ARENA_MATCH_END,0,30,1500,1501",
  ]);
  const m: GladMatch = buildMatch(matches[0]!.seg, matches[0]!.end!);

  it("kind/bracket/zone/times", () => {
    expect(m.kind).toBe("match");
    expect(m.bracket).toBe("3v3");
    expect(m.zoneId).toBe("1825");
    expect(m.endTime).toBeGreaterThan(m.startTime);
  });
  it("CI backfill: specId/classId/info/teamId", () => {
    const a = m.units["Player-1-A"]!;
    expect(a.specId).toBe(257);
    expect(a.classId).toBe(5);
    expect(a.info?.teamId).toBe(0);
    expect(a.info?.personalRating).toBe(2400);
  });
  it("owner + playerTeamId + result: owner team 0, END winner 0 → Win", () => {
    expect(m.playerId).toBe("Player-1-A");
    expect(m.playerTeamId).toBe(0);
    expect(m.winningTeamId).toBe(0);
    expect(m.result).toBe("Win");
  });
  it("rawLines and content hash id", () => {
    expect(m.rawLines.length).toBeGreaterThanOrEqual(5);
    expect(m.id).toMatch(/^[0-9a-f]{8,}$/);
  });
});

describe("buildMatch: losing and sentinel branches", () => {
  it("END winner 1, owner team 0 → Lose", () => {
    const { matches } = collect([
      "ARENA_MATCH_START,1825,41,2v2,1",
      CI("Player-1-A", 0, 257, 2400),
      "ARENA_MATCH_END,1,30,1500,1501",
    ]);
    expect(buildMatch(matches[0]!.seg, matches[0]!.end!).result).toBe("Lose");
  });
  it("END winner 255 → Unknown", () => {
    const { matches } = collect([
      "ARENA_MATCH_START,1825,41,2v2,1",
      CI("Player-1-A", 0, 257, 2400),
      "ARENA_MATCH_END,255,30,1500,1501",
    ]);
    expect(buildMatch(matches[0]!.seg, matches[0]!.end!).result).toBe(
      "Unknown",
    );
  });
});

describe("buildShuffle", () => {
  const { shuffles } = collect([
    "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
    CI("Player-1-A", 0, 257, 2400),
    CI("Player-2-B", 1, 71, 2380),
    DMG("Player-1-A", "Alice-X", "Player-2-B", "Bob-Y"),
    DIE("Player-2-B", "Bob-Y", 1), // 假死,不定胜负
    DIE("Player-2-B", "Bob-Y", 0), // 真死,team1 输 → team0 胜
    "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
    CI("Player-1-A", 1, 257, 2400), // teamId 重分!
    CI("Player-2-B", 0, 71, 2380),
    "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
    CI("Player-1-A", 0, 257, 2400),
    "ARENA_MATCH_END,0,155,1729,1730",
  ]);
  const s: GladShuffle = buildShuffle(shuffles[0]!);

  it("3 rounds with per-round teamIds", () => {
    expect(s.rounds).toHaveLength(3);
    expect(s.rounds[0]!.units["Player-1-A"]!.info?.teamId).toBe(0);
    expect(s.rounds[1]!.units["Player-1-A"]!.info?.teamId).toBe(1);
  });
  it("round outcome from first real death: round0 team0 wins (owner Win)", () => {
    expect(s.rounds[0]!.winningTeamId).toBe(0);
    expect(s.rounds[0]!.result).toBe("Win");
  });
  it("round without deaths → Unknown", () => {
    expect(s.rounds[1]!.result).toBe("Unknown");
    expect(s.rounds[1]!.winningTeamId).toBeNull();
  });
  it("sequence numbers and shuffle envelope", () => {
    expect(s.rounds.map((r) => r.sequenceNumber)).toEqual([0, 1, 2]);
    expect(s.kind).toBe("shuffle");
    expect(s.startTime).toBeLessThan(s.endTime);
  });
});
