import type { LedgerRun } from "@gladlog/analysis/src/learning/types";
import { appendFileSync,mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { createLearningLedger } from "./learningLedger";

const run = (
  matchId: string,
  createdAt: number,
  cat = "survival",
): LedgerRun => ({
  v: 1,
  matchId,
  startTime: 1000,
  win: false,
  enemySpecs: [62],
  promptVersion: 12,
  createdAt,
  findings: [{ category: cat, severity: "high", eventTypes: ["death"] }],
});

const fresh = () =>
  createLearningLedger(mkdtempSync(join(tmpdir(), "gl-ledger-")));

describe("learningLedger", () => {
  it("append → read 往返;同场 last-run-wins(整场替换)", () => {
    const l = fresh();
    l.append([run("m1", 100, "survival")]);
    l.append([run("m1", 200, "cooldowns"), run("m2", 150)]);
    const { matches, badLines } = l.read();
    expect(badLines).toBe(0);
    expect(matches).toHaveLength(2);
    const m1 = matches.find((m) => m.matchId === "m1")!;
    // a newer run replaces the whole match
    expect(m1.findings[0]!.category).toBe("cooldowns");
  });

  it("坏行跳过并计数,不影响好行", () => {
    const l = fresh();
    l.append([run("m1", 100)]);
    appendFileSync(l.file, "not json\n{broken\n", "utf-8");
    l.append([run("m2", 100)]);
    const { matches, badLines } = l.read();
    expect(matches).toHaveLength(2);
    expect(badLines).toBe(2);
  });

  it("文件不存在 → 空结果不抛", () => {
    const l = fresh();
    expect(l.read()).toEqual({ matches: [], badLines: 0, totalLines: 0 });
  });

  it("compact:冗余行超阈值时重写为归并视图,前后 read 等价", () => {
    const l = fresh();
    // m1 is written 5 times (4 redundant rows), m2 once
    for (let i = 1; i <= 5; i++) l.append([run("m1", i * 100)]);
    l.append([run("m2", 100)]);
    const before = l.read();
    l.compact();
    const after = l.read();
    expect(after.matches).toEqual(expect.arrayContaining(before.matches));
    expect(after.totalLines).toBe(2);
    // Idempotent: with no redundancy, compact leaves the file untouched
    const raw = readFileSync(l.file, "utf-8");
    l.compact();
    expect(readFileSync(l.file, "utf-8")).toBe(raw);
  });
});
