import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { firstLineStatedOf } from "../src/main/matchStore";
import { backfillStatedStart } from "../src/shared/statedStartBackfill";

// pipeline T200: a document stored before the parser kept statedStartTime
// (2026-11-11, T90) gets it from raw.txt's opening line.

describe("firstLineStatedOf:raw.txt 首行自述的时刻", () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-stated-"));
  const raw = (name: string, text: string) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };

  it("带负号的偏移(UTC 以西):与解析机器所在时区无关", async () => {
    const p = raw(
      "west.txt",
      "8/18/2026 18:56:32.167-4  ARENA_MATCH_START,980,42,3v3,1\n8/18/2026 18:56:32.167-4  COMBATANT_INFO,x\n",
    );
    expect(await firstLineStatedOf(p)).toBe(
      Date.UTC(2026, 7, 18, 22, 56, 32, 167),
    );
  });

  it("不带符号的偏移(UTC 以东)紧跟在毫秒后面", async () => {
    const p = raw(
      "east.txt",
      "11/7/2026 13:38:17.36513  ARENA_MATCH_START,1504,42,Rated Solo Shuffle,0\r\n",
    );
    // .365 and +13
    expect(await firstLineStatedOf(p)).toBe(
      Date.UTC(2026, 10, 7, 0, 38, 17, 365),
    );
  });

  it("首行没写偏移 → null(读到了,但没有可说的时刻)", async () => {
    const p = raw(
      "none.txt",
      "8/18/2026 18:56:32.167  ARENA_MATCH_START,980,42,3v3,1\n",
    );
    expect(await firstLineStatedOf(p)).toBeNull();
  });

  it("没有 raw.txt、或首行不是开局行 → undefined(什么都不补)", async () => {
    expect(await firstLineStatedOf(join(dir, "missing.txt"))).toBeUndefined();
    const p = raw(
      "mid.txt",
      "8/18/2026 18:56:32.167-4  SPELL_CAST_SUCCESS,Player-1,x\n",
    );
    expect(await firstLineStatedOf(p)).toBeUndefined();
    expect(await firstLineStatedOf(raw("empty.txt", ""))).toBeUndefined();
  });
});

describe("backfillStatedStart", () => {
  const STATED = 1_800_000_000_000;

  it("普通对局:缺字段 → 写入首行自述的时刻", () => {
    const doc = {
      kind: "match",
      data: { startTime: 5_000 } as Record<string, unknown>,
    };
    expect(backfillStatedStart(doc, STATED)).toBe(true);
    expect(doc.data["statedStartTime"]).toBe(STATED);
  });

  it("shuffle:每个回合 = 首行时刻 + 它与最早回合的解析起点之差(存档顺序无关)", () => {
    const rounds = [
      { sequenceNumber: 1, startTime: 10_000 + 185_000 },
      { sequenceNumber: 0, startTime: 10_000 },
      { sequenceNumber: 2, startTime: 10_000 + 400_500 },
    ] as Array<Record<string, unknown>>;
    const doc = { kind: "shuffle", data: { startTime: 10_000, rounds } };
    expect(backfillStatedStart(doc, STATED)).toBe(true);
    expect(rounds.map((r) => r["statedStartTime"])).toEqual([
      STATED + 185_000,
      STATED,
      STATED + 400_500,
    ]);
  });

  it("首行没写偏移 → 写 null(与新解析的文档同义:已知没有),不是留空", () => {
    const doc = {
      kind: "match",
      data: { startTime: 5_000 } as Record<string, unknown>,
    };
    expect(backfillStatedStart(doc, null)).toBe(true);
    expect(doc.data["statedStartTime"]).toBeNull();
  });

  it("已有字段(数字或 null)不动;全都有 → 返回 false", () => {
    const rounds = [
      { startTime: 1_000, statedStartTime: 42 },
      { startTime: 2_000, statedStartTime: null },
    ] as Array<Record<string, unknown>>;
    const doc = { kind: "shuffle", data: { rounds } };
    expect(backfillStatedStart(doc, STATED)).toBe(false);
    expect(rounds.map((r) => r["statedStartTime"])).toEqual([42, null]);
    // one round of a lobby stored half-way: only the missing one is written
    rounds.push({ startTime: 3_000 });
    expect(backfillStatedStart(doc, STATED)).toBe(true);
    expect(rounds[2]!["statedStartTime"]).toBe(STATED + 2_000);
    expect(rounds[0]!["statedStartTime"]).toBe(42);
  });

  it("没有可读的起点 → 什么都不写", () => {
    expect(backfillStatedStart(null, STATED)).toBe(false);
    expect(backfillStatedStart({ data: { rounds: [] } }, STATED)).toBe(false);
    const doc = { data: { rounds: [{ startTime: 1 }, { startTime: "x" }] } };
    expect(backfillStatedStart(doc, STATED)).toBe(false);
    expect(doc.data.rounds[0]).toEqual({ startTime: 1 });
  });
});
