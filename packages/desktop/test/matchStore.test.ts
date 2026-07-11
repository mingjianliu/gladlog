import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GladMatch, GladShuffle } from "@gladlog/parser";
import { MatchStore } from "../src/main/matchStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-store-"));

function fakeMatch(id: string): GladMatch {
  return {
    kind: "match",
    id,
    bracket: "3v3",
    zoneId: "1825",
    startTime: 100,
    endTime: 200,
    units: {},
    playerId: "p",
    playerTeamId: 0,
    winningTeamId: 1,
    result: "loss",
    linesTotal: 3,
    linesDropped: 0,
    rawLines: ["l1", "l2"],
    hasAdvancedLogging: true,
    timezone: "UTC",
  } as unknown as GladMatch;
}
function fakeShuffle(roundId: string): GladShuffle {
  const round = {
    ...(fakeMatch(roundId) as unknown as Record<string, unknown>),
    kind: "shuffleRound",
    sequenceNumber: 1,
  };
  return {
    kind: "shuffle",
    rounds: [round],
    startTime: 100,
    endTime: 500,
    rawLines: ["r1"],
    result: "win",
  } as unknown as GladShuffle;
}

describe("MatchStore", () => {
  it("store match → 三文件落盘,match.json 剥 rawLines,raw.txt 保留", () => {
    const root = dir();
    const s = new MatchStore(root);
    const r = s.store(fakeMatch("abc123"));
    expect(r.stored).toBe(true);
    expect(existsSync(join(root, "abc123", "meta.json"))).toBe(true);
    const doc = JSON.parse(
      readFileSync(join(root, "abc123", "match.json"), "utf-8"),
    );
    expect(doc.schemaVersion).toBe(1);
    expect(doc.data.rawLines).toBeUndefined();
    expect(readFileSync(join(root, "abc123", "raw.txt"), "utf-8")).toBe(
      "l1\nl2\n",
    );
  });

  it("重复 id → stored:false,不覆盖", () => {
    const s = new MatchStore(dir());
    s.store(fakeMatch("dup"));
    expect(s.store(fakeMatch("dup")).stored).toBe(false);
    expect(s.list()).toHaveLength(1);
  });

  it("shuffle:id 取 rounds[0].id;round 的 rawLines 也剥掉", () => {
    const root = dir();
    const s = new MatchStore(root);
    const r = s.store(fakeShuffle("shufid"));
    expect(r.meta!.id).toBe("shufid");
    expect(r.meta!.kind).toBe("shuffle");
    const doc = JSON.parse(
      readFileSync(join(root, "shufid", "match.json"), "utf-8"),
    );
    expect(doc.data.rawLines).toBeUndefined();
    expect(doc.data.rounds[0].rawLines).toBeUndefined();
  });

  it("rounds 为空的 shuffle → stored:false, meta:null", () => {
    const s = new MatchStore(dir());
    const empty = {
      kind: "shuffle",
      rounds: [],
      startTime: 0,
      endTime: 0,
      rawLines: [],
      result: "unknown",
    } as unknown as GladShuffle;
    expect(s.store(empty)).toEqual({ stored: false, meta: null });
  });

  it("init 重扫恢复索引,list 按 startTime 降序", () => {
    const root = dir();
    const s1 = new MatchStore(root);
    s1.store({ ...fakeMatch("m1"), startTime: 100 } as GladMatch);
    s1.store({ ...fakeMatch("m2"), startTime: 300 } as GladMatch);
    const s2 = new MatchStore(root);
    const metas = s2.init();
    expect(metas.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(s2.get("m1")).not.toBeNull();
    expect(s2.get("nope")).toBeNull();
  });
});
