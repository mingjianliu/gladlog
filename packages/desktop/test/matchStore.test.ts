import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
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

  it("init 重扫恢复索引,list 按 startTime 降序", async () => {
    const root = dir();
    const s1 = new MatchStore(root);
    s1.store({ ...fakeMatch("m1"), startTime: 100 } as GladMatch);
    s1.store({ ...fakeMatch("m2"), startTime: 300 } as GladMatch);
    const s2 = new MatchStore(root);
    const metas = s2.init();
    expect(metas.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(await s2.get("m1")).not.toBeNull();
    expect(await s2.get("nope")).toBeNull();
  });

  it("自愈:meta.json 损坏后重存同 id 不抛并恢复三文件", () => {
    const root = dir();
    const s1 = new MatchStore(root);
    s1.store(fakeMatch("heal1"));
    rmSync(join(root, "heal1", "meta.json"));
    const s2 = new MatchStore(root);
    s2.init();
    const r = s2.store(fakeMatch("heal1"));
    expect(r.stored).toBe(true);
    expect(existsSync(join(root, "heal1", "meta.json"))).toBe(true);
  });
});

describe("富行 meta 字段(backlog #7)", () => {
  const withUnits = (id: string): GladMatch =>
    ({
      ...(fakeMatch(id) as unknown as Record<string, unknown>),
      startTime: 100_000,
      endTime: 245_000,
      playerTeamId: 0,
      units: {
        a: {
          kind: "Player",
          specId: 105,
          classId: 11,
          info: { teamId: 0, personalRating: 2400 },
        },
        b: {
          kind: "Player",
          specId: 71,
          classId: 1,
          info: { teamId: 0, personalRating: 2600 },
        },
        c: {
          kind: "Player",
          specId: 64,
          classId: 8,
          info: { teamId: 1, personalRating: 2500 },
        },
        pet: { kind: "Pet", specId: 0, classId: 0 },
      },
    }) as unknown as GladMatch;

  it("store 时提炼 durationS/avgRating/teams(宠物排除,己方在前)", () => {
    const s = new MatchStore(dir());
    const { meta } = s.store(withUnits("rich1"));
    expect(meta!.durationS).toBe(145);
    expect(meta!.avgRating).toBe(2500); // (2400+2600)/2
    expect(meta!.teams).toEqual([
      [
        { specId: 105, classId: 11 },
        { specId: 71, classId: 1 },
      ],
      [{ specId: 64, classId: 8 }],
    ]);
  });

  it("rebuildIndex 给旧 meta 回填富行字段", () => {
    const d = dir();
    const s = new MatchStore(d);
    const { meta } = s.store(withUnits("rich2"));
    // 模拟旧索引:剥掉富行字段重写 meta.json 与内存索引
    const stripped = { ...meta! };
    delete stripped.durationS;
    delete stripped.avgRating;
    delete stripped.teams;
    (s as unknown as { index: Map<string, unknown> }).index.set(
      "rich2",
      stripped,
    );
    const r = s.rebuildIndex();
    expect(r.updated).toBe(1);
    const after = s.list().find((m) => m.id === "rich2")!;
    expect(after.durationS).toBe(145);
    expect(after.teams?.[0]?.length).toBe(2);
  });

  it("无评分数据时 avgRating 为 null,不炸", () => {
    const s = new MatchStore(dir());
    const m = withUnits("rich3") as unknown as {
      units: Record<string, { info?: { personalRating?: number } }>;
    };
    for (const u of Object.values(m.units)) {
      if (u.info) delete u.info.personalRating;
    }
    const { meta } = s.store(m as unknown as GladMatch);
    expect(meta!.avgRating).toBeNull();
  });

  it("get 未决时，发一个 page 应立即返回 (<100ms)", async () => {
    const root = dir();
    const s = new MatchStore(root);
    const largeId = "large_match";
    const data = { dummy: "x".repeat(15 * 1024 * 1024) };
    const safeDir = join(root, largeId);
    mkdirSync(safeDir, { recursive: true });
    writeFileSync(join(safeDir, "match.json"), JSON.stringify({ data }));

    s.init();
    (s as any).index.set(largeId, { id: largeId, startTime: 100 } as any);

    const t0 = Date.now();
    const getPromise = s.get(largeId);

    const pageStart = Date.now();
    s.page({ limit: 10 });
    const pageEnd = Date.now();

    expect(pageEnd - pageStart).toBeLessThan(100);

    const retrieved = await getPromise;
    expect(retrieved).not.toBeNull();
    const tEnd = Date.now();
    console.log(`[probe] get took ${tEnd - t0}ms, page took ${pageEnd - pageStart}ms`);
  });

  it("LRU 缓存正常工作：最多缓存 2 个条目且遵循 LRU 淘汰", async () => {
    const root = dir();
    const s = new MatchStore(root);

    for (const id of ["m1", "m2", "m3"]) {
      const safeDir = join(root, id);
      mkdirSync(safeDir, { recursive: true });
      writeFileSync(join(safeDir, "match.json"), JSON.stringify({ id, data: id }));
      (s as any).index.set(id, { id, startTime: 100 } as any);
    }

    const res1 = await s.get("m1");
    const res2 = await s.get("m2");

    const res1_again = await s.get("m1");
    const res2_again = await s.get("m2");
    expect(res1).toBe(res1_again);
    expect(res2).toBe(res2_again);

    await s.get("m3");

    const res1_third = await s.get("m1");
    expect(res1_third).not.toBe(res1);
  });
});
