import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GladMatch } from "@gladlog/parser";
import { describe, expect, it } from "vitest";

import { MatchStore, stageMatch } from "./matchStore";

function tmpStore() {
  return new MatchStore(mkdtempSync(join(tmpdir(), "ms-")));
}
function mkMatch(id: string, startTime: number): GladMatch {
  return {
    kind: "match",
    id,
    bracket: "2v2",
    zoneId: "0",
    startTime,
    endTime: startTime + 1,
    result: 0,
    rawLines: [],
  } as unknown as GladMatch;
}

describe("MatchStore.page", () => {
  it("returns the most-recent `limit` matches, newest first", () => {
    const s = tmpStore();
    for (const t of [100, 300, 200]) s.store(mkMatch(`m${t}`, t));
    const p = s.page({ limit: 2 });
    expect(p.map((m) => m.startTime)).toEqual([300, 200]);
  });
  it("pages older via `before` (strict <)", () => {
    const s = tmpStore();
    for (const t of [100, 200, 300]) s.store(mkMatch(`m${t}`, t));
    expect(s.page({ before: 300, limit: 10 }).map((m) => m.startTime)).toEqual([
      200, 100,
    ]);
    expect(s.page({ before: 100, limit: 10 })).toEqual([]);
  });
  it("clamps limit to [1,500]", () => {
    const s = tmpStore();
    for (const t of [1, 2, 3]) s.store(mkMatch(`m${t}`, t));
    expect(s.page({ limit: 0 })).toHaveLength(1);
  });
});

describe("MatchStore NDJSON index", () => {
  it("store appends one line to _index.ndjson (no full rewrite)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("a", 1));
    s.store(mkMatch("b", 2));
    const lines = readFileSync(join(dir, "_index.ndjson"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("a");
  });
  it("init() reads the NDJSON in one shot (dedups by id, last wins)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    new MatchStore(dir).store(mkMatch("a", 5));
    const s2 = new MatchStore(dir);
    expect(s2.init().map((m) => m.id)).toEqual(["a"]);
  });
  it("migrates: rebuilds _index.ndjson from per-dir meta.json when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("a", 3));
    rmSync(join(dir, "_index.ndjson"));
    const s2 = new MatchStore(dir);
    expect(s2.init().map((m) => m.id)).toEqual(["a"]);
    expect(existsSync(join(dir, "_index.ndjson"))).toBe(true);
  });
  it("reconciles a dir present but missing from the index", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("a", 1));
    s.store(mkMatch("b", 2));
    writeFileSync(
      join(dir, "_index.ndjson"),
      JSON.stringify({
        id: "a",
        kind: "match",
        bracket: "2v2",
        zoneId: "0",
        startTime: 1,
        endTime: 2,
        result: "0",
        storedAt: 0,
      }) + "\n",
    );
    const s2 = new MatchStore(dir);
    expect(
      s2
        .init()
        .map((m) => m.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});

describe("MatchStore.rawLine(B2 溯源:lineIndex → raw.txt 行)", () => {
  it("普通对局:直接按下标取行", async () => {
    const s = tmpStore();
    const m = mkMatch("r1", 100);
    (m as unknown as { rawLines: string[] }).rawLines = ["L0", "L1", "L2"];
    s.store(m);
    expect(await s.rawLine("r1", { lineIndex: 1 })).toEqual({
      line: "L1",
      fileLine: 1,
    });
    expect(await s.rawLine("r1", { lineIndex: 99 })).toBeNull();
    expect(await s.rawLine("r1", { lineIndex: -1 })).toBeNull();
    expect(await s.rawLine("nope", { lineIndex: 0 })).toBeNull();
  });

  it("shuffle:轮内下标 + 前序轮 linesTotal 偏移", async () => {
    const s = tmpStore();
    const round = (seq: number, lines: string[]) =>
      ({
        kind: "shuffleRound",
        id: `sr${seq}`,
        sequenceNumber: seq,
        bracket: "Rated Solo Shuffle",
        zoneId: "0",
        startTime: 100 + seq,
        endTime: 101 + seq,
        result: 0,
        linesTotal: lines.length,
        rawLines: lines,
      }) as unknown as GladMatch;
    const shuffle = {
      kind: "shuffle",
      startTime: 100,
      endTime: 200,
      result: 0,
      rounds: [round(0, ["A0", "A1"]), round(1, ["B0", "B1", "B2"])],
      rawLines: ["A0", "A1", "B0", "B1", "B2", "END"],
    } as unknown as GladMatch;
    s.store(shuffle as never);
    // Index 2 within round 1 → offset 2 (round 0's linesTotal) + 2 = line 4 of
    // the whole match, "B2"
    expect(await s.rawLine("sr0", { roundSeq: 1, lineIndex: 2 })).toEqual({
      line: "B2",
      fileLine: 4,
    });
    expect(await s.rawLine("sr0", { roundSeq: 0, lineIndex: 0 })).toEqual({
      line: "A0",
      fileLine: 0,
    });
  });
});

describe("MatchStore.readRawText(BACKLOG #26 Task 2 意图守护:rawStreams 管线的 raw.txt 读)", () => {
  it("已存的对局 → 返回 raw.txt 全文(store() 写入的 rawLines join)", async () => {
    const s = tmpStore();
    const m = mkMatch("r1", 100);
    (m as unknown as { rawLines: string[] }).rawLines = ["L0", "L1", "L2"];
    s.store(m);
    expect(await s.readRawText("r1")).toBe("L0\nL1\nL2\n");
  });

  it("不在索引里的 id → null,不抛", async () => {
    const s = tmpStore();
    expect(await s.readRawText("nope")).toBeNull();
  });

  it("在索引里但磁盘上的 raw.txt 已被删除(旧档案/损坏)→ null,不抛", async () => {
    const s = tmpStore();
    const m = mkMatch("gone-raw", 100);
    (m as unknown as { rawLines: string[] }).rawLines = ["L0"];
    s.store(m);
    rmSync(join(s.dirOf("gone-raw")!, "raw.txt"));
    expect(await s.readRawText("gone-raw")).toBeNull();
  });

  it("shuffle:lobby id(rounds[0].id)可读到共享的 raw.txt", async () => {
    const s = tmpStore();
    const round = (seq: number, lines: string[]) =>
      ({
        kind: "shuffleRound",
        id: `sr${seq}`,
        sequenceNumber: seq,
        bracket: "Rated Solo Shuffle",
        zoneId: "0",
        startTime: 100 + seq,
        endTime: 101 + seq,
        result: 0,
        linesTotal: lines.length,
        rawLines: lines,
      }) as unknown as GladMatch;
    const shuffle = {
      kind: "shuffle",
      startTime: 100,
      endTime: 200,
      result: 0,
      rounds: [round(0, ["A0"]), round(1, ["B0", "B1"])],
      rawLines: ["A0", "B0", "B1", "END"],
    } as unknown as GladMatch;
    s.store(shuffle as never);
    // Per matchStore's own store() convention, a shuffle's on-disk id is the
    // first round's id — the same directory rawLine's provenance lookup uses.
    expect(await s.readRawText("sr0")).toBe("A0\nB0\nB1\nEND\n");
    // The lobby is NOT addressable by a later round's own id — same "storage
    // id ≠ round content-hash id" fact rawStreamsCache.ts's doc comment
    // relies on.
    expect(await s.readRawText("sr1")).toBeNull();
  });
});

describe("MatchStore dir naming (GH #38 hardening: id → dir name must be injective)", () => {
  // Before: safeName collapsed every unsafe character to "_", so two distinct
  // ids could map to ONE directory; store() of the second rmSync'd the first
  // match's files while the index kept both rows → a phantom duplicate whose
  // raw.txt / match.json belong to the other match.
  it("ids that the lossy escape collapsed get separate dirs; both survive a cold init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-coll-"));
    const s = new MatchStore(dir);
    const a = mkMatch("x/y", 100);
    (a as unknown as { rawLines: string[] }).rawLines = ["A"];
    const b = mkMatch("x_y", 200);
    (b as unknown as { rawLines: string[] }).rawLines = ["B"];
    expect(s.store(a).stored).toBe(true);
    expect(s.store(b).stored).toBe(true);
    expect(s.dirOf("x/y")).not.toBe(s.dirOf("x_y"));
    expect(await s.readRawText("x/y")).toBe("A\n");
    expect(await s.readRawText("x_y")).toBe("B\n");
    const s2 = new MatchStore(dir);
    expect(
      s2
        .init()
        .map((m) => m.id)
        .sort(),
    ).toEqual(["x/y", "x_y"]);
    expect(await s2.readRawText("x/y")).toBe("A\n");
  });

  it("production ids (8 hex chars, parser FNV-1a) keep their dir name verbatim — on-disk layout unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-hex-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("0a1b2c3d", 1));
    expect(s.dirOf("0a1b2c3d")).toBe(join(dir, "0a1b2c3d"));
  });

  it("an id starting with '.' or '_' never yields a dir that init()'s reconcile skips as hidden", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-lead-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("_idx", 1));
    s.store(mkMatch(".dot", 2));
    rmSync(join(dir, "_index.ndjson"));
    expect(
      new MatchStore(dir)
        .init()
        .map((m) => m.id)
        .sort(),
    ).toEqual([".dot", "_idx"]);
  });
});

// GH #149: the log worker writes a live match itself (stageMatch) and main
// only renames it into place (commitStaged) — no structured clone of the
// document, no JSON.stringify on main's thread.
describe("MatchStore.commitStaged + stageMatch (GH #149 worker-side write)", () => {
  const withRaw = (id: string, t: number): GladMatch =>
    ({ ...mkMatch(id, t), rawLines: ["L1", "L2"] }) as unknown as GladMatch;

  it("stage + commit leaves the same files and index row as store()", () => {
    const a = mkdtempSync(join(tmpdir(), "ms-st-a-"));
    const b = mkdtempSync(join(tmpdir(), "ms-st-b-"));
    const viaStore = new MatchStore(a, { now: () => 42 });
    viaStore.init();
    viaStore.store(withRaw("m1", 7));
    const viaStage = new MatchStore(b, { now: () => 999 });
    viaStage.init();
    const staged = stageMatch(b, withRaw("m1", 7), 42);
    expect(staged).not.toBeNull();
    expect(staged!.stagingDir.startsWith(join(b, ".stage-"))).toBe(true);
    const r = viaStage.commitStaged(staged!);
    expect(r.stored).toBe(true);
    for (const f of ["meta.json", "match.json", "raw.txt"])
      expect(readFileSync(join(b, "m1", f), "utf-8")).toBe(
        readFileSync(join(a, "m1", f), "utf-8"),
      );
    expect(readFileSync(join(b, "_index.ndjson"), "utf-8")).toBe(
      readFileSync(join(a, "_index.ndjson"), "utf-8"),
    );
    expect(readdirSync(b).filter((n) => n.startsWith("."))).toEqual([]);
    expect(viaStage.list().map((m) => m.id)).toEqual(["m1"]);
  });

  it("dedups like store(): an intact stored match is not staged again", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-st-dup-"));
    const s = new MatchStore(dir);
    s.init();
    s.store(withRaw("m1", 1));
    expect(stageMatch(dir, withRaw("m1", 1), 5)).toBeNull();
  });

  it("commit of a copy staged before the first landed drops the staging dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-st-race-"));
    const s = new MatchStore(dir);
    s.init();
    const first = stageMatch(dir, withRaw("m1", 1), 5)!;
    const second = stageMatch(dir, withRaw("m1", 1), 6)!;
    expect(s.commitStaged(first).stored).toBe(true);
    const r = s.commitStaged(second);
    expect(r.stored).toBe(false);
    expect(r.meta?.storedAt).toBe(5);
    expect(existsSync(second.stagingDir)).toBe(false);
    expect(s.list()).toHaveLength(1);
  });

  it("a dir whose meta.json does not name the id is staged again, and the commit indexes it", () => {
    // codex review 2026-11-06: `{}` parses, but init() cannot index it
    const dir = mkdtempSync(join(tmpdir(), "ms-st-bare-"));
    const s = new MatchStore(dir);
    s.init();
    s.store(withRaw("m1", 1));
    writeFileSync(join(dir, "m1", "meta.json"), "{}");
    rmSync(join(dir, "_index.ndjson"));
    const s2 = new MatchStore(dir);
    expect(s2.init()).toEqual([]);
    const staged = stageMatch(dir, withRaw("m1", 1), 9);
    expect(staged).not.toBeNull();
    expect(s2.commitStaged(staged!).stored).toBe(true);
    expect(s2.list().map((m) => m.id)).toEqual(["m1"]);
  });

  it("a failed staging write removes its own directory before rethrowing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-st-fail-"));
    const bad = {
      ...withRaw("m1", 1),
      rawLines: {
        join() {
          throw new Error("EIO");
        },
      },
    } as unknown as GladMatch;
    expect(() => stageMatch(dir, bad, 5)).toThrow("EIO");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("init() removes staging dirs a crash left behind and indexes none of them", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-st-crash-"));
    const left = stageMatch(dir, withRaw("m1", 1), 5)!;
    const s = new MatchStore(dir);
    expect(s.init()).toEqual([]);
    expect(existsSync(left.stagingDir)).toBe(false);
  });
});
