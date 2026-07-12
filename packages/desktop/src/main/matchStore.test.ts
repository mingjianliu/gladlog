import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MatchStore } from "./matchStore";
import type { GladMatch } from "@gladlog/parser";

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
