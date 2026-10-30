import { describe, expect, it } from "vitest";

import {
  dateKeyOf,
  knownIdsFrom,
  knownKeysFrom,
  latestById,
  LEDGER_WINDOW_DAYS,
  type LedgerEntry,
  ledgerShardPath,
  mergeIndexLines,
  parseShard,
  recentDateKeys,
  serializeEntry,
  toIndexLine,
} from "./archiveLedger";

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "m1",
    logObjectUrl: "https://storage.googleapis.com/x/m1",
    dateKey: "2026-08-01",
    bracket: "3v3",
    startTime: Date.UTC(2026, 7, 1, 12, 0, 0),
    playerTeamRating: 2100,
    team0MMR: 2090,
    team1MMR: 2110,
    playerTeamId: "0",
    winningTeamId: "1",
    durationInSeconds: 120,
    specs: ["105", "265"],
    bytes: 309855,
    uploaded: true,
    ...over,
  };
}

describe("dateKeyOf", () => {
  it("UTC 归日,epoch ms → YYYY-MM-DD", () => {
    expect(dateKeyOf(Date.UTC(2026, 7, 1, 12, 0, 0))).toBe("2026-08-01");
  });
  it("零点边界", () => {
    expect(dateKeyOf(Date.UTC(2026, 7, 1, 23, 59, 59))).toBe("2026-08-01");
    expect(dateKeyOf(Date.UTC(2026, 7, 2, 0, 0, 0))).toBe("2026-08-02");
  });
  it("月/日补零 —— 与 ledgerShardPath / 暂存目录名逐字一致", () => {
    expect(dateKeyOf(Date.UTC(2026, 0, 9))).toBe("2026-01-09");
  });
  it("recentDateKeys 也走它,分片名与日期归属不会各写一份格式化", () => {
    const today = Date.UTC(2026, 7, 3, 5, 0, 0);
    expect(recentDateKeys(today, 1)).toEqual([dateKeyOf(today)]);
  });
});

describe("recentDateKeys", () => {
  it("返回最近 N 天,含今天,新到旧", () => {
    const keys = recentDateKeys(Date.UTC(2026, 7, 3, 5, 0, 0), 3);
    expect(keys).toEqual(["2026-08-03", "2026-08-02", "2026-08-01"]);
  });
  it("默认窗口是 10 天 —— 比 feed 的 7 天留 3 天余量", () => {
    expect(LEDGER_WINDOW_DAYS).toBe(10);
    expect(
      recentDateKeys(Date.UTC(2026, 7, 3), LEDGER_WINDOW_DAYS),
    ).toHaveLength(10);
  });
  it("跨月边界正确", () => {
    expect(recentDateKeys(Date.UTC(2026, 8, 1), 2)).toEqual([
      "2026-09-01",
      "2026-08-31",
    ]);
  });
});

describe("分片路径", () => {
  it("一天一个 jsonl", () => {
    expect(ledgerShardPath("/l", "2026-08-01")).toBe("/l/2026-08-01.jsonl");
  });
});

describe("序列化", () => {
  it("一行一条,可往返", () => {
    const e = entry();
    expect(parseShard(serializeEntry(e))).toEqual([e]);
  });
  it("忽略空行与坏行,不让一行脏数据毁掉整个分片", () => {
    const text = `${serializeEntry(entry())}\n\n{不是json\n${serializeEntry(entry({ id: "m2" }))}\n`;
    expect(parseShard(text).map((e) => e.id)).toEqual(["m1", "m2"]);
  });
});

describe("knownIdsFrom", () => {
  it("只有 uploaded 为真的才算已归档 —— 上传失败的必须允许重下", () => {
    const ids = knownIdsFrom([
      entry({ id: "ok", uploaded: true }),
      entry({ id: "pending", uploaded: false }),
    ]);
    expect(ids.has("ok")).toBe(true);
    expect(ids.has("pending")).toBe(false);
  });
});

describe("knownKeysFrom", () => {
  it("同时返回 id 与 logObjectUrl 双键 —— SS 一场 6 轮共享同一日志对象但 id 各异", () => {
    const keys = knownKeysFrom([
      entry({ id: "r1", logObjectUrl: "gs://shuffle-A", uploaded: true }),
    ]);
    expect(keys.ids.has("r1")).toBe(true);
    expect(keys.logUrls.has("gs://shuffle-A")).toBe(true);
  });
  it("暂存里还躺着的场次算已知 —— 否则上传持续失败时会被反复重下", () => {
    const entries = [
      entry({ id: "stuck", logObjectUrl: "gs://stuck", uploaded: false }),
    ];
    expect(knownKeysFrom(entries).ids.has("stuck")).toBe(false);
    const withStaged = knownKeysFrom(entries, new Set(["stuck"]));
    expect(withStaged.ids.has("stuck")).toBe(true);
    expect(withStaged.logUrls.has("gs://stuck")).toBe(true);
  });
  it("既未上传、暂存里也没有 → 不算已知(必须允许重下)", () => {
    const keys = knownKeysFrom(
      [entry({ id: "gone", uploaded: false })],
      new Set(["别的场次"]),
    );
    expect(keys.ids.size).toBe(0);
    expect(keys.logUrls.size).toBe(0);
  });
  it("老账本行没有 logObjectUrl 时不能把空串塞进集合", () => {
    const keys = knownKeysFrom([
      { ...entry({ id: "old" }), logObjectUrl: "" } as LedgerEntry,
    ]);
    expect(keys.ids.has("old")).toBe(true);
    expect(keys.logUrls.has("")).toBe(false);
  });
});

describe("mergeIndexLines", () => {
  it("保留云端已有条目 —— 本地账本只留 10 天,覆盖式重建会截断整天的索引", () => {
    const remote = `${toIndexLine(entry({ id: "old1" }))}\n${toIndexLine(entry({ id: "old2" }))}\n`;
    const merged = mergeIndexLines(remote, [entry({ id: "new1" })]);
    expect(
      merged
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).id),
    ).toEqual(["old1", "old2", "new1"]);
  });
  it("同 id 以本地为准,且不产生重复行", () => {
    const remote = `${JSON.stringify({ id: "m1", bytes: 1 })}\n`;
    const merged = mergeIndexLines(remote, [entry({ id: "m1", bytes: 999 })]);
    const lines = merged.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).bytes).toBe(999);
  });
  it("云端为空(首次上传该日)时就是本地视图", () => {
    const merged = mergeIndexLines("", [entry({ id: "m1" })]);
    expect(JSON.parse(merged.trim()).id).toBe("m1");
  });
  it("云端坏行跳过,不让一行脏数据毁掉整天索引", () => {
    const merged = mergeIndexLines(`{不是json\n{"noId":1}\n`, [
      entry({ id: "m1" }),
    ]);
    expect(merged.trim().split("\n")).toHaveLength(1);
  });
  it("两边都空 → 空串(不写出一个只有换行的文件)", () => {
    expect(mergeIndexLines("", [])).toBe("");
  });
  it("index 行不含本地状态字段 uploaded", () => {
    const merged = mergeIndexLines("", [entry({ id: "m1", uploaded: true })]);
    expect(JSON.parse(merged.trim()).uploaded).toBeUndefined();
  });
});

describe("latestById", () => {
  it("同一 id 后写的胜出 —— 分片是 append-only,同一场会先写 false 再写 true", () => {
    const out = latestById([
      entry({ id: "m1", uploaded: false }),
      entry({ id: "m1", uploaded: true }),
      entry({ id: "m2", uploaded: false }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.id === "m1")!.uploaded).toBe(true);
    expect(out.find((e) => e.id === "m2")!.uploaded).toBe(false);
  });
  it("保持首次出现的顺序,便于 index 稳定", () => {
    const out = latestById([
      entry({ id: "a" }),
      entry({ id: "b" }),
      entry({ id: "a" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("toIndexLine", () => {
  it("导出给 Drive 的 index 不带本地状态字段", () => {
    const line = JSON.parse(toIndexLine(entry()));
    expect(line.uploaded).toBeUndefined();
    expect(line.id).toBe("m1");
    expect(line.team0MMR).toBe(2090);
  });
});

describe("gcsMeta", () => {
  const meta = {
    wowVersion: "11.2.0",
    clientTimezone: "America/Los_Angeles",
    clientYear: "2026",
    startTimeUtc: "2026-08-01T12:00:00Z",
  };

  it("随账本行往返 —— GCS 对象 ~30 天后消失,归档时不存就再也拿不到", () => {
    const e = entry({ gcsMeta: meta });
    expect(parseShard(serializeEntry(e))[0].gcsMeta).toEqual(meta);
  });
  it("出现在传上 Drive 的 index.jsonl 行里(重建绝对时间的唯一来源)", () => {
    const line = JSON.parse(toIndexLine(entry({ gcsMeta: meta })));
    expect(line.gcsMeta).toEqual(meta);
    expect(line.uploaded).toBeUndefined();
  });
  it("缺字段只写拿到的那些(buildGcsMeta 把缺的键整个省掉,不写空串)", () => {
    const partial = { wowVersion: "11.2.0" };
    const line = JSON.parse(toIndexLine(entry({ gcsMeta: partial })));
    expect(line.gcsMeta).toEqual(partial);
    expect("clientTimezone" in line.gcsMeta).toBe(false);
  });
  it("老账本行没有这个字段时照常解析(向后兼容,不能因此丢整天去重)", () => {
    const e = entry();
    delete (e as Partial<LedgerEntry>).gcsMeta;
    const parsed = parseShard(serializeEntry(e));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].gcsMeta).toBeUndefined();
  });
  it("并进 index 时同 id 以本地为准,本地的 gcsMeta 覆盖云端旧行", () => {
    const remote = JSON.stringify({ id: "m1", bytes: 1 });
    const merged = mergeIndexLines(remote, [
      entry({ id: "m1", gcsMeta: meta }),
    ]);
    expect(JSON.parse(merged.trim()).gcsMeta).toEqual(meta);
  });
});
