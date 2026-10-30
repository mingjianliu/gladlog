import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { dateKeyOf, type LedgerEntry } from "./archiveLedger";
import {
  checkArchivePayload,
  driveDestFor,
  isDateKeyDir,
  isKnownStub,
  ledgerEntriesToAppend,
  matchDateKey,
  MAX_CONSECUTIVE_FAILURES,
  MIN_DOWNLOAD_SLEEP_MS,
  parseThrottleEnv,
  reconcileStaging,
  shouldAbortAfterFailures,
  shouldArchive,
  shouldFlushBatch,
  shouldSkipFlush,
  shouldStopScanning,
  stagedIdsFrom,
  stagedMatchIdFrom,
  stagingPathFor,
  STOP_AFTER_KNOWN,
} from "./archivePlan";
import type { DetailedMatchStub } from "./feedClient";

function ledgerEntry(over: Partial<LedgerEntry> = {}): LedgerEntry {
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
    specs: [],
    bytes: 1,
    uploaded: false,
    ...over,
  };
}

function stub(over: Partial<DetailedMatchStub> = {}): DetailedMatchStub {
  return {
    typename: "ArenaMatchDataStub",
    id: "m1",
    logObjectUrl: "https://storage.googleapis.com/x/m1",
    playerId: "Player-1",
    hasAdvancedLogging: true,
    durationInSeconds: 120,
    bracket: "3v3",
    units: [],
    startTime: Date.UTC(2026, 7, 1, 12, 0, 0),
    result: 1,
    playerTeamRating: 2100,
    winningTeamId: "0",
    playerTeamId: "0",
    team0MMR: 2100,
    team1MMR: 2100,
    ...over,
  };
}

describe("matchDateKey", () => {
  it("按 UTC 归日,不受本机时区影响", () => {
    expect(matchDateKey(Date.UTC(2026, 7, 1, 12, 0, 0))).toBe("2026-08-01");
  });
  it("UTC 零点边界:23:59 与 00:01 分属两天", () => {
    expect(matchDateKey(Date.UTC(2026, 7, 1, 23, 59, 59))).toBe("2026-08-01");
    expect(matchDateKey(Date.UTC(2026, 7, 2, 0, 0, 1))).toBe("2026-08-02");
  });
  it("月末跨月", () => {
    expect(matchDateKey(Date.UTC(2026, 7, 31, 23, 59, 0))).toBe("2026-08-31");
  });
  it("与账本分片名共用 dateKeyOf —— 两处各写一份格式化会直接毁掉去重", () => {
    for (const ms of [
      Date.UTC(2026, 0, 1, 0, 0, 0),
      Date.UTC(2026, 7, 1, 12, 34, 56),
      Date.UTC(2026, 11, 31, 23, 59, 59),
    ]) {
      expect(matchDateKey(ms)).toBe(dateKeyOf(ms));
    }
  });
});

describe("isDateKeyDir", () => {
  it("日期目录名 → true", () => {
    expect(isDateKeyDir("2026-08-01")).toBe(true);
  });
  it(".DS_Store 不是日期目录 —— Finder 打开一次就有,且字典序排在所有日期之前", () => {
    expect(isDateKeyDir(".DS_Store")).toBe(false);
  });
  it("其他非日期条目一律排除(否则 readdirSync 抛 ENOTDIR,整轮静默停摆)", () => {
    for (const n of [
      "index.jsonl",
      ".lock",
      "2026-8-1",
      "2026-08-01.jsonl",
      "2026-08-01x",
      "tmp",
      "",
    ]) {
      expect(isDateKeyDir(n)).toBe(false);
    }
  });
  it("dateKeyOf 的输出必然被认为是日期目录(两者同构)", () => {
    expect(isDateKeyDir(dateKeyOf(Date.UTC(2026, 7, 1)))).toBe(true);
    expect(isDateKeyDir(dateKeyOf(Date.UTC(2026, 0, 9)))).toBe(true);
  });
});

describe("shouldArchive", () => {
  it("新场次且有 advanced logging → 收", () => {
    expect(shouldArchive(stub(), new Set())).toBe(true);
  });
  it("已在账本里 → 不收", () => {
    expect(shouldArchive(stub({ id: "m1" }), new Set(["m1"]))).toBe(false);
  });
  it("没有 advanced logging → 不收(用户拍板跳过)", () => {
    expect(shouldArchive(stub({ hasAdvancedLogging: false }), new Set())).toBe(
      false,
    );
  });
  it("startTime 为 0(元数据损坏)→ 不收,否则会归到 1970 目录", () => {
    expect(shouldArchive(stub({ startTime: 0 }), new Set())).toBe(false);
  });
  it("logObjectUrl 已知 → 不收(SS 6 轮共享同一对象但 id 各异)", () => {
    const s = stub({ id: "轮次2", logObjectUrl: "gs://shuffle-A" });
    expect(shouldArchive(s, new Set(), new Set(["gs://shuffle-A"]))).toBe(
      false,
    );
    // Not in the id set — deduplicating by id alone would download the very same
    // GCS object a second time
    expect(shouldArchive(s, new Set())).toBe(true);
  });
  it("logObjectUrl 为空串时不被空串集合误判为已知", () => {
    expect(
      shouldArchive(stub({ logObjectUrl: "" }), new Set(), new Set([""])),
    ).toBe(true);
  });
  it("本轮内把下过的 id/URL 加进集合后即不再重下 —— feed 翻页会让同一 stub 再现", () => {
    const s = stub({ id: "m9", logObjectUrl: "gs://m9" });
    const known = new Set<string>();
    const knownLogs = new Set<string>();
    expect(shouldArchive(s, known, knownLogs)).toBe(true);
    known.add(s.id);
    knownLogs.add(s.logObjectUrl);
    // The same match reappearing verbatim at the head of the next page
    expect(shouldArchive(s, known, knownLogs)).toBe(false);
  });
});

describe("isKnownStub", () => {
  it("id 命中 → 已知", () => {
    expect(isKnownStub(stub({ id: "m1" }), new Set(["m1"]))).toBe(true);
  });
  it("logObjectUrl 命中 → 已知(SS 6 轮共享同一对象但 id 各异)", () => {
    const s = stub({ id: "轮次2", logObjectUrl: "gs://shuffle-A" });
    expect(isKnownStub(s, new Set(), new Set(["gs://shuffle-A"]))).toBe(true);
  });
  it("两把钥匙都不命中 → 未知", () => {
    expect(isKnownStub(stub({ id: "新场" }), new Set(["别的"]))).toBe(false);
  });
  it("空 logObjectUrl 不被空串集合误判为已知(编排壳手抄副本曾漏掉这条真值守卫)", () => {
    expect(
      isKnownStub(
        stub({ id: "新场", logObjectUrl: "" }),
        new Set(),
        new Set([""]),
      ),
    ).toBe(false);
  });
  it("与 shouldArchive 同源:凡 isKnownStub 为真,shouldArchive 必为假", () => {
    const cases: Array<[DetailedMatchStub, Set<string>, Set<string>]> = [
      [stub({ id: "a" }), new Set(["a"]), new Set()],
      [
        stub({ id: "b", logObjectUrl: "gs://b" }),
        new Set(),
        new Set(["gs://b"]),
      ],
      [stub({ id: "c", logObjectUrl: "" }), new Set(), new Set([""])],
      [stub({ id: "d", logObjectUrl: "gs://d" }), new Set(), new Set()],
    ];
    for (const [s, known, logs] of cases) {
      if (isKnownStub(s, known, logs)) {
        expect(shouldArchive(s, known, logs)).toBe(false);
      }
    }
  });
});

describe("shouldSkipFlush(DRY_RUN)", () => {
  it("DRY_RUN 下整段跳过冲刷 —— rclone --dry-run 什么也没传却退 0", () => {
    expect(shouldSkipFlush(true)).toBe(true);
  });
  it("正常运行不跳过", () => {
    expect(shouldSkipFlush(false)).toBe(false);
  });
});

describe("ledgerEntriesToAppend", () => {
  it("DRY_RUN 下不得写 uploaded:true —— 记早一场就是永久丢一场", () => {
    const out = ledgerEntriesToAppend(
      [ledgerEntry({ id: "a" }), ledgerEntry({ id: "b" })],
      true,
    );
    expect(out).toEqual([]);
    expect(out.some((e) => e.uploaded)).toBe(false);
  });
  it("正常运行才盖 uploaded:true 的章", () => {
    const out = ledgerEntriesToAppend(
      [ledgerEntry({ id: "a", uploaded: false })],
      false,
    );
    expect(out.map((e) => [e.id, e.uploaded])).toEqual([["a", true]]);
  });
  it("不就地改传入条目(调用方还要拿原对象比对)", () => {
    const src = ledgerEntry({ id: "a", uploaded: false });
    ledgerEntriesToAppend([src], false);
    expect(src.uploaded).toBe(false);
  });
  it("空批次 → 空数组(别往账本 append 一个空串)", () => {
    expect(ledgerEntriesToAppend([], false)).toEqual([]);
  });
});

describe("checkArchivePayload", () => {
  const goodText = "ARENA_MATCH_START,...\nARENA_MATCH_END,...\n";
  const gz = gzipSync(Buffer.from(goodText));

  it("gzip + 字节数相符 + 两个哨兵齐全 → 通过", () => {
    expect(
      checkArchivePayload({
        contentEncoding: "gzip",
        byteLength: gz.length,
        expectedBytes: gz.length,
        decode: () => goodText,
      }).ok,
    ).toBe(true);
  });
  it("content-encoding 不是 gzip → 拒(否则明文以 .txt.gz 落盘,体积 11.4x)", () => {
    const r = checkArchivePayload({
      contentEncoding: "",
      byteLength: goodText.length,
      // When GCS transcodes server-side the response is chunked with no
      // content-length — the byte check would wave it straight through, and only
      // this encoding layer can stop it.
      expectedBytes: undefined,
      decode: () => goodText,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("gzip");
  });
  it("identity 编码同样拒绝", () => {
    expect(
      checkArchivePayload({
        contentEncoding: "identity",
        byteLength: 10,
        expectedBytes: undefined,
        decode: () => goodText,
      }).ok,
    ).toBe(false);
  });
  it("压缩字节数与 GCS 声明不符 → 拒(HTTP 200 但中途断流)", () => {
    const r = checkArchivePayload({
      contentEncoding: "gzip",
      byteLength: gz.length - 100,
      expectedBytes: gz.length,
      decode: () => goodText,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("byte length mismatch");
  });
  it("缺哨兵 → 拒", () => {
    expect(
      checkArchivePayload({
        contentEncoding: "gzip",
        byteLength: 3,
        expectedBytes: 3,
        decode: () => "ARENA_MATCH_START,...",
      }).reason,
    ).toBe("missing ARENA_MATCH_END");
  });
  it("前两层不过时不白花一次 gunzip(decode 是 thunk)", () => {
    let decoded = 0;
    checkArchivePayload({
      contentEncoding: "",
      byteLength: 1,
      expectedBytes: undefined,
      decode: () => {
        decoded++;
        return goodText;
      },
    });
    checkArchivePayload({
      contentEncoding: "gzip",
      byteLength: 1,
      expectedBytes: 2,
      decode: () => {
        decoded++;
        return goodText;
      },
    });
    expect(decoded).toBe(0);
  });
});

describe("暂存文件名 ↔ matchId", () => {
  it("反解 id", () => {
    expect(stagedMatchIdFrom("abc.txt.gz")).toBe("abc");
  });
  it("非暂存文件返回 null(index.jsonl / .DS_Store 不能被当成场次)", () => {
    expect(stagedMatchIdFrom("index.jsonl")).toBeNull();
    expect(stagedMatchIdFrom(".DS_Store")).toBeNull();
    expect(stagedMatchIdFrom(".txt.gz")).toBeNull();
  });
  it("与 stagingPathFor 同一后缀,可往返", () => {
    const p = stagingPathFor("/s", "2026-08-01", "abc");
    expect(stagedMatchIdFrom(p.split("/").pop()!)).toBe("abc");
  });
  it("stagedIdsFrom 只挑暂存文件", () => {
    expect([...stagedIdsFrom(["a.txt.gz", "index.jsonl", "b.txt.gz"])]).toEqual(
      ["a", "b"],
    );
  });
});

describe("reconcileStaging", () => {
  it("有账本条目且未上传 → 该传", () => {
    const plan = reconcileStaging(
      ["a.txt.gz"],
      [ledgerEntry({ id: "a", uploaded: false })],
    );
    expect(plan.toUpload.map((e) => e.id)).toEqual(["a"]);
    expect(plan.alreadyUploaded).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });
  it("账本已 uploaded:true 却还在本地 → 只删不重传(记账与删除之间被 kill)", () => {
    const plan = reconcileStaging(
      ["a.txt.gz"],
      [ledgerEntry({ id: "a", uploaded: true })],
    );
    expect(plan.toUpload).toEqual([]);
    expect(plan.alreadyUploaded).toEqual(["a"]);
  });
  it("盘上有文件但账本查无此条 → 孤儿(落盘与记账之间被 kill),不盲传", () => {
    const plan = reconcileStaging(["ghost.txt.gz"], []);
    expect(plan.orphans).toEqual(["ghost"]);
    expect(plan.toUpload).toEqual([]);
  });
  it("同 id 多条按最后一条判定 —— 分片是 append-only,先 false 后 true", () => {
    const plan = reconcileStaging(
      ["a.txt.gz"],
      [
        ledgerEntry({ id: "a", uploaded: false }),
        ledgerEntry({ id: "a", uploaded: true }),
      ],
    );
    expect(plan.toUpload).toEqual([]);
    expect(plan.alreadyUploaded).toEqual(["a"]);
  });
  it("index.jsonl 不算场次", () => {
    const plan = reconcileStaging(["index.jsonl"], []);
    expect(plan.orphans).toEqual([]);
    expect(plan.toUpload).toEqual([]);
  });
  it("账本里有、盘上没有的条目不该被传(已被删或从未落盘)", () => {
    const plan = reconcileStaging([], [ledgerEntry({ id: "a" })]);
    expect(plan.toUpload).toEqual([]);
  });
});

describe("parseThrottleEnv", () => {
  it("未设置 → 默认值", () => {
    expect(parseThrottleEnv(undefined, 2000, 250)).toEqual({
      value: 2000,
      usedFallback: false,
    });
  });
  it("空串 → 默认值(?? 拦不住空串,Number('') 是 0)", () => {
    expect(parseThrottleEnv("", 2000, 250).value).toBe(2000);
  });
  it("非数字 → 默认值(setTimeout(r, NaN) 等价 0ms,节流会静默消失)", () => {
    const r = parseThrottleEnv("2s", 2000, 250);
    expect(r.value).toBe(2000);
    expect(r.usedFallback).toBe(true);
  });
  it("0 与负数低于下限 → 默认值(硬约束:不得默认为 0)", () => {
    expect(parseThrottleEnv("0", 2000, 250).value).toBe(2000);
    expect(parseThrottleEnv("-1", 2000, 250).value).toBe(2000);
  });
  it("合法且不低于下限 → 采用", () => {
    expect(parseThrottleEnv("500", 2000, 250)).toEqual({
      value: 500,
      usedFallback: false,
    });
  });
  it("下载间隔下限是 250ms,不是 0", () => {
    expect(MIN_DOWNLOAD_SLEEP_MS).toBe(250);
    expect(parseThrottleEnv("100", 2000, MIN_DOWNLOAD_SLEEP_MS).value).toBe(
      2000,
    );
  });
});

describe("shouldAbortAfterFailures", () => {
  it("零星失败不中止 22 小时的首次全量", () => {
    expect(shouldAbortAfterFailures(1)).toBe(false);
    expect(shouldAbortAfterFailures(MAX_CONSECUTIVE_FAILURES - 1)).toBe(false);
  });
  it("连续失败达阈值就停 —— 继续空转只是在敲对方的 GCS", () => {
    expect(shouldAbortAfterFailures(MAX_CONSECUTIVE_FAILURES)).toBe(true);
  });
});

describe("shouldStopScanning", () => {
  it("连续已知未达阈值时继续扫", () => {
    expect(shouldStopScanning(STOP_AFTER_KNOWN - 1)).toBe(false);
  });
  it("达到阈值才停 —— 防 feed 零星乱序导致的静默漏采", () => {
    expect(shouldStopScanning(STOP_AFTER_KNOWN)).toBe(true);
  });
  it("阈值是 200(4 页),不是 1", () => {
    expect(STOP_AFTER_KNOWN).toBe(200);
    expect(shouldStopScanning(1)).toBe(false);
  });
});

describe("路径", () => {
  it("暂存路径按日期分目录,文件名是 matchId.txt.gz", () => {
    expect(stagingPathFor("/s", "2026-08-01", "abc")).toBe(
      "/s/2026-08-01/abc.txt.gz",
    );
  });
  it("Drive 目标是 YYYY/MM/DD", () => {
    expect(driveDestFor("2026-08-01")).toBe("2026/08/01");
  });
});

describe("shouldFlushBatch", () => {
  it("满 200 场即冲刷", () => {
    expect(shouldFlushBatch({ count: 200, bytes: 1 })).toBe(true);
  });
  it("满 500MB 即冲刷(场数未满也要)", () => {
    expect(shouldFlushBatch({ count: 3, bytes: 500 * 1024 * 1024 })).toBe(true);
  });
  it("两者都未满则继续攒", () => {
    expect(shouldFlushBatch({ count: 199, bytes: 1024 })).toBe(false);
  });
});
