import {
  backfillStatedStart,
  openingInstantsOf,
} from "../src/shared/statedStartBackfill";

// pipeline T200: a document stored before the parser kept statedStartTime
// (2026-11-11, T90) gets it from raw.txt's opening lines.

describe("openingInstantsOf:raw.txt 里每条开局行自述的时刻", () => {
  it("带负号的偏移(UTC 以西):与解析机器所在时区无关", () => {
    expect(
      openingInstantsOf(
        "8/18/2026 18:56:32.167-4  ARENA_MATCH_START,980,42,3v3,1\n8/18/2026 18:56:32.167-4  COMBATANT_INFO,x\n",
      ),
    ).toEqual([Date.UTC(2026, 7, 18, 22, 56, 32, 167)]);
  });

  it("不带符号的偏移(UTC 以东)紧跟在毫秒后面;CRLF", () => {
    // .365 and +13
    expect(
      openingInstantsOf(
        "11/7/2026 13:38:17.36513  ARENA_MATCH_START,1504,42,Rated Solo Shuffle,0\r\n",
      ),
    ).toEqual([Date.UTC(2026, 10, 7, 0, 38, 17, 365)]);
  });

  it("没写偏移的开局行 → null;没有开局行 → 空", () => {
    expect(
      openingInstantsOf(
        "8/18/2026 18:56:32.167  ARENA_MATCH_START,980,42,3v3,1\n",
      ),
    ).toEqual([null]);
    expect(
      openingInstantsOf(
        "8/18/2026 18:56:32.167-4  SPELL_CAST_SUCCESS,Player-1,x\n",
      ),
    ).toEqual([]);
    expect(openingInstantsOf("")).toEqual([]);
  });

  it("shuffle:每回合一条,按文件顺序;别的行里出现这个词不算", () => {
    const raw = [
      "3/29/2026 01:59:00.0001  ARENA_MATCH_START,1504,42,Rated Solo Shuffle,0",
      '3/29/2026 01:59:05.0001  CHAT_MSG,"x  ARENA_MATCH_START,",1',
      "3/29/2026 03:01:00.0002  ARENA_MATCH_START,1504,42,Rated Solo Shuffle,0",
    ].join("\n");
    // codex 85-tk-ENG-T200-1 #1: the offset changes between the two rounds
    // (DST) — each line is read as written
    expect(openingInstantsOf(raw)).toEqual([
      Date.UTC(2026, 2, 29, 0, 59, 0, 0),
      Date.UTC(2026, 2, 29, 1, 1, 0, 0),
    ]);
  });
});

describe("backfillStatedStart", () => {
  const A = 1_800_000_000_000;

  it("普通对局:缺字段 → 写入它那条开局行自述的时刻", () => {
    const doc = {
      kind: "match",
      data: { startTime: 5_000 } as Record<string, unknown>,
    };
    expect(backfillStatedStart(doc, [A])).toEqual({
      changed: true,
      complete: true,
    });
    expect(doc.data["statedStartTime"]).toBe(A);
  });

  it("shuffle:第 k 条开局行归序号 k 的回合(存档顺序无关),不做任何外推", () => {
    const rounds = [
      { sequenceNumber: 1, startTime: 10_000 + 185_000 },
      { sequenceNumber: 0, startTime: 10_000 },
      { sequenceNumber: 2, startTime: 10_000 + 400_500 },
    ] as Array<Record<string, unknown>>;
    const doc = { kind: "shuffle", data: { startTime: 10_000, rounds } };
    // the second line states an instant that is NOT first + 185 s (an offset
    // change in between): it is taken as written
    expect(backfillStatedStart(doc, [A, A + 3_785_000, null]).complete).toBe(
      true,
    );
    expect(rounds.map((r) => r["statedStartTime"])).toEqual([
      A + 3_785_000,
      A,
      null,
    ]);
  });

  // codex 85-tk-ENG-T200-1b: 10/25 02:59 (+2) then 02:01 (+1) — the clock
  // went back, the second round's PARSED start is the earlier one
  it("时钟回拨(秋季换时):解析出的起点倒了序,仍按序号对应,不对调", () => {
    const rounds = [
      { sequenceNumber: 0, startTime: Date.UTC(2026, 9, 25, 2, 59) },
      { sequenceNumber: 1, startTime: Date.UTC(2026, 9, 25, 2, 1) },
    ] as Array<Record<string, unknown>>;
    const stated = [Date.UTC(2026, 9, 25, 0, 59), Date.UTC(2026, 9, 25, 1, 1)];
    backfillStatedStart({ data: { rounds } }, stated);
    expect(rounds.map((r) => r["statedStartTime"])).toEqual(stated);
  });

  it("已有字段(数字或 null)不动;全都有 → changed false、complete true", () => {
    const rounds = [
      { sequenceNumber: 0, statedStartTime: 42 },
      { sequenceNumber: 1, statedStartTime: null },
    ] as Array<Record<string, unknown>>;
    const doc = { kind: "shuffle", data: { rounds } };
    expect(backfillStatedStart(doc, [A, A + 1])).toEqual({
      changed: false,
      complete: true,
    });
    // and without a raw.txt at all
    expect(backfillStatedStart(doc, null)).toEqual({
      changed: false,
      complete: true,
    });
    rounds.push({ sequenceNumber: 2 });
    expect(backfillStatedStart(doc, [A, A + 1, A + 2]).changed).toBe(true);
    expect(rounds.map((r) => r["statedStartTime"])).toEqual([42, null, A + 2]);
  });

  it("开局行数与回合数对不上、或没有 raw.txt → 什么都不写,complete false(不打标记)", () => {
    const doc = {
      data: { rounds: [{ sequenceNumber: 0 }, { sequenceNumber: 1 }] },
    };
    for (const openings of [[A], [A, A, A], [], null])
      expect(backfillStatedStart(doc, openings)).toEqual({
        changed: false,
        complete: false,
      });
    expect(doc.data.rounds).toEqual([
      { sequenceNumber: 0 },
      { sequenceNumber: 1 },
    ]);
  });

  it("回合序号不是 0..n-1(缺号、重号、没有序号)→ 什么都不写,complete false", () => {
    expect(backfillStatedStart(null, [A])).toEqual({
      changed: false,
      complete: false,
    });
    expect(backfillStatedStart({ data: { rounds: [] } }, [])).toEqual({
      changed: false,
      complete: false,
    });
    for (const rounds of [
      [{ sequenceNumber: 0 }, { sequenceNumber: 2 }],
      [{ sequenceNumber: 1 }, { sequenceNumber: 1 }],
      [{ sequenceNumber: 0 }, {}],
      [{ sequenceNumber: 0 }, null],
    ]) {
      const doc = { data: { rounds } };
      expect(backfillStatedStart(doc, [A, A + 1])).toEqual({
        changed: false,
        complete: false,
      });
      expect(JSON.stringify(doc)).not.toContain("statedStartTime");
    }
  });
});
