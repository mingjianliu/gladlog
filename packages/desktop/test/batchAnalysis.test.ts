// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Orchestration unit tests for the driver: input building / pack building are
// mocked to constants, so only the queue semantics are verified (skipping /
// serialization / deep-dive triggering / cancellation / per-round shuffle).
// The builders themselves have their own smoke test on a real fixture.
vi.mock("../src/renderer/src/report/derive/analysisInput", () => ({
  buildAnalysisInput: vi.fn((_source: unknown, matchId: string) => ({
    matchId,
    candidates: [{ id: "c1" }],
    richContext: "ctx",
    spec: "spec",
    ownerName: "me",
    enemySpecs: [],
  })),
  buildDeepenPacks: vi.fn(() => [{ findingIndex: 0 }]),
}));
vi.mock("@gladlog/analysis", () => ({
  ensureAnalysisData: async () => {},
  // rawStreamsCache.ts's fetchRawStreams calls this to derive its 3rd
  // getRawStreams arg — must be present or the mock module makes it
  // `undefined`, throwing inside fetchRawStreams' try block and silently
  // degrading to UNAVAILABLE without ever calling getRawStreams (exactly the
  // real guarded semantics from rawStreams.ts's roundDurationSOf).
  roundDurationSOf: (startMs: number, endMs: number | undefined) =>
    typeof endMs === "number" && Number.isFinite(endMs) && endMs >= startMs
      ? (endMs - startMs) / 1000
      : undefined,
}));

import {
  cancelBatch,
  getBatchStatus,
  startBatch,
  subscribeBatch,
} from "../src/renderer/src/batch/batchAnalysis";
import { buildDeepenPacks } from "../src/renderer/src/report/derive/analysisInput";

type Calls = {
  run: string[];
  deepen: string[];
  cancel: Array<string | undefined>;
};

function stubBridge(opts: {
  cachedIds?: string[];
  runningIds?: string[];
  failIds?: string[];
  rejectStateIds?: string[];
  /** Spec §6.13: ids whose only cache is the other language's result (zh
   * while the current language is en) -- getState / getCached hand it back
   * tagged `contentLang: "zh"`. */
  otherLangIds?: string[];
  docs: Record<string, { kind: string; data: unknown }>;
  onRun?: (matchId: string) => Promise<void> | void;
}): Calls {
  const calls: Calls = { run: [], deepen: [], cancel: [] };
  const done = new Set<string>(); // After a successful run, getCached can hit
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    matches: {
      get: async (id: string) => opts.docs[id] ?? null,
    },
    analysis: {
      getState: async (matchId: string) => {
        if (opts.rejectStateIds?.includes(matchId)) throw new Error("ipc boom");
        if (opts.otherLangIds?.includes(matchId))
          return {
            cached: { findings: [], contentLang: "zh" },
            lang: "en",
            running: false,
          };
        return {
          cached: opts.cachedIds?.includes(matchId) ? { findings: [] } : null,
          running: opts.runningIds?.includes(matchId) ?? false,
        };
      },
      run: async (input: { matchId: string }) => {
        calls.run.push(input.matchId);
        await opts.onRun?.(input.matchId);
        if (!opts.failIds?.includes(input.matchId)) done.add(input.matchId);
      },
      getCached: async (matchId: string) =>
        done.has(matchId)
          ? { findings: [{ severity: "high" }], hadNarration: true }
          : opts.otherLangIds?.includes(matchId)
            ? {
                findings: [{ severity: "high" }],
                hadNarration: true,
                contentLang: "zh",
              }
            : null,
      deepen: async (input: { matchId: string }) => {
        calls.deepen.push(input.matchId);
      },
      cancel: async (matchId?: string) => {
        calls.cancel.push(matchId);
      },
    },
  };
  return calls;
}

const src = { units: {} };

beforeEach(() => {
  // Singleton state leaks across tests: each test must wait for the previous
  // round to fully finish (startBatch has a `running` re-entrancy guard, so a
  // leftover `running` makes later tests silently no-op)
  expect(getBatchStatus().running).toBe(false);
});

describe("批量分析驱动器", () => {
  it("跑到一半把语言从 zh 切到 en:跑完读回的是刚写的 zh 结果(回退),不深挖、不写 en(§6.13)", async () => {
    let lang = "zh";
    const deepened: string[] = [];
    let wroteZh = false;
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { get: async () => ({ kind: "match", data: src }) },
      analysis: {
        getState: async () => ({ cached: null, lang, running: false }),
        run: async () => {
          lang = "en"; // the user switches language while the round runs
          wroteZh = true; // main pinned zh at the start: the zh cache is written
        },
        // under en, getCached falls back to the fresh zh result
        getCached: async () =>
          wroteZh
            ? {
                findings: [{ severity: "high" }],
                hadNarration: true,
                contentLang: "zh",
              }
            : null,
        deepen: async (input: { matchId: string }) => {
          deepened.push(input.matchId);
        },
        cancel: async () => {},
      },
    };
    await startBatch([{ id: "s", label: "S" }]);
    const st = getBatchStatus();
    expect(deepened).toEqual([]);
    expect({ ok: st.ok, skipped: st.skipped, failed: st.failed }).toEqual({
      ok: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("深挖认这一轮自己的 done(语言 + 槽),不认 getCached:zh 一轮跑完时界面已是 en、en 里有旧的未深挖结果 → 不深挖(codex A#4)", async () => {
    let lang = "zh";
    const deepenInputs: Array<{ matchId: string; contentLang?: string }> = [];
    const doneCbs = new Set<(d: unknown) => void>();
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { get: async () => ({ kind: "match", data: src }) },
      analysis: {
        getState: async () => ({ cached: null, lang, running: false }),
        run: async (input: { matchId: string }) => {
          lang = "en"; // switched mid-run; main pinned zh
          for (const cb of doneCbs)
            cb({
              matchId: input.matchId,
              result: {
                findings: [{ severity: "high", title: "新的" }],
                hadNarration: true,
              },
              slotKey: "anthropic:m",
              contentLang: "zh",
            });
        },
        // the old English result: what getCached + the new UI language picks
        getCached: async () => ({
          findings: [{ severity: "high", title: "Old" }],
          hadNarration: true,
          deepened: false,
          contentLang: "en",
        }),
        onDone: (cb: (d: unknown) => void) => {
          doneCbs.add(cb);
          return () => doneCbs.delete(cb);
        },
        deepen: async (input: { matchId: string; contentLang?: string }) => {
          deepenInputs.push(input);
        },
        cancel: async () => {},
      },
    };
    await startBatch([{ id: "a4", label: "A4" }]);
    expect(deepenInputs).toEqual([]);
    expect(getBatchStatus().ok).toBe(1);
    expect(doneCbs.size).toBe(0); // unsubscribed
  });

  it("深挖用这一轮 done 带回的 findings 与语言(codex A#4)", async () => {
    const deepenInputs: Array<{
      matchId: string;
      contentLang?: string;
      findings: Array<{ title: string }>;
    }> = [];
    const doneCbs = new Set<(d: unknown) => void>();
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { get: async () => ({ kind: "match", data: src }) },
      analysis: {
        getState: async () => ({ cached: null, lang: "en", running: false }),
        run: async (input: { matchId: string }) => {
          // another match's done must not be taken
          for (const cb of doneCbs)
            cb({
              matchId: "other",
              result: { findings: [{ title: "X" }], hadNarration: true },
              contentLang: "en",
            });
          for (const cb of doneCbs)
            cb({
              matchId: input.matchId,
              result: { findings: [{ title: "Fresh" }], hadNarration: true },
              contentLang: "en",
            });
        },
        getCached: async () => ({
          findings: [{ title: "Stale read" }],
          hadNarration: true,
          contentLang: "en",
        }),
        onDone: (cb: (d: unknown) => void) => {
          doneCbs.add(cb);
          return () => doneCbs.delete(cb);
        },
        deepen: async (input: (typeof deepenInputs)[number]) => {
          deepenInputs.push(input);
        },
        cancel: async () => {},
      },
    };
    await startBatch([{ id: "a4b", label: "A4B" }]);
    expect(
      deepenInputs.map((d) => [d.matchId, d.contentLang, d.findings[0]!.title]),
    ).toEqual([["a4b", "en", "Fresh"]]);
  });

  it("有 onDone 但这一轮没发 done(失败):记失败,不拿 getCached 的旧结果去深挖(codex A#4)", async () => {
    const deepened: string[] = [];
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { get: async () => ({ kind: "match", data: src }) },
      analysis: {
        getState: async () => ({ cached: null, lang: "zh", running: false }),
        run: async () => {},
        getCached: async () => ({
          findings: [{ title: "旧" }],
          hadNarration: true,
          contentLang: "zh",
        }),
        onDone: () => () => {},
        deepen: async (input: { matchId: string }) => {
          deepened.push(input.matchId);
        },
        cancel: async () => {},
      },
    };
    await startBatch([{ id: "a4c", label: "A4C" }]);
    expect(deepened).toEqual([]);
    expect(getBatchStatus().failed).toBe(1);
  });

  it("深挖 chips 的语言取结果自己的 contentLang(不回退到 zh),并把它带给 deepen", async () => {
    // getState carries no `lang` (older stub shape), so the fallback would be
    // "zh": only reading the result's own contentLang yields "en" here.
    const deepenInputs: Array<{ matchId: string; contentLang?: string }> = [];
    let ran = false;
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { get: async () => ({ kind: "match", data: src }) },
      analysis: {
        getState: async () => ({ cached: null, running: false }),
        run: async () => {
          ran = true;
        },
        getCached: async () =>
          ran
            ? {
                findings: [{ severity: "high" }],
                hadNarration: true,
                contentLang: "en",
              }
            : null,
        deepen: async (input: { matchId: string; contentLang?: string }) => {
          deepenInputs.push(input);
        },
        cancel: async () => {},
      },
    };
    const packsMock = vi.mocked(buildDeepenPacks);
    packsMock.mockClear();
    await startBatch([{ id: "cl", label: "CL" }]);
    expect(packsMock).toHaveBeenCalledTimes(1);
    expect(packsMock.mock.calls[0][4]).toBe("en");
    expect(deepenInputs.map((d) => [d.matchId, d.contentLang])).toEqual([
      ["cl", "en"],
    ]);
  });

  it("只有另一种语言的缓存不算已分析:照跑;跑失败时不拿回退内容去深挖(§6.13)", async () => {
    const calls = stubBridge({
      otherLangIds: ["z", "zf"],
      failIds: ["zf"],
      docs: {
        z: { kind: "match", data: src },
        zf: { kind: "match", data: src },
      },
    });
    await startBatch([
      { id: "z", label: "Z" },
      { id: "zf", label: "ZF" },
    ]);
    const st = getBatchStatus();
    expect([...calls.run].sort()).toEqual(["z", "zf"]);
    expect(calls.deepen).toEqual(["z"]);
    expect({ ok: st.ok, skipped: st.skipped, failed: st.failed }).toEqual({
      ok: 1,
      skipped: 0,
      failed: 1,
    });
  });

  it("已缓存跳过、正常场跑 run+deepen、失败场计 failed(并发下顺序不定,比集合)", async () => {
    const calls = stubBridge({
      cachedIds: ["a"],
      failIds: ["c"],
      docs: {
        a: { kind: "match", data: src },
        b: { kind: "match", data: src },
        c: { kind: "match", data: src },
      },
    });
    await startBatch([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    const st = getBatchStatus();
    expect([...calls.run].sort()).toEqual(["b", "c"]); // a is stopped by the cache predicate
    expect(calls.deepen).toEqual(["b"]); // No deep dive for a failed match
    expect({ ok: st.ok, skipped: st.skipped, failed: st.failed }).toEqual({
      ok: 1,
      skipped: 1,
      failed: 1,
    });
    expect(st.done).toBe(3);
    expect(st.running).toBe(false);
    expect(st.finishedAt).not.toBeNull();
  });

  it("shuffle 逐回合(round.id 为缓存键),整场计一次 ok", async () => {
    const calls = stubBridge({
      docs: {
        s1: {
          kind: "shuffle",
          data: {
            rounds: [
              { ...src, id: "r1" },
              { ...src, id: "r2" },
            ],
          },
        },
      },
    });
    await startBatch([{ id: "s1", label: "S1" }]);
    expect([...calls.run].sort()).toEqual(["r1", "r2"]);
    const st = getBatchStatus();
    expect(st.ok).toBe(1);
    expect(st.done).toBe(1);
  });

  it("并发池:三路同时在飞,第四场等有空位才起跑", async () => {
    let inFlightNow = 0;
    let maxInFlight = 0;
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = stubBridge({
      docs: {
        a: { kind: "match", data: src },
        b: { kind: "match", data: src },
        c: { kind: "match", data: src },
        d: { kind: "match", data: src },
      },
      onRun: async () => {
        inFlightNow++;
        maxInFlight = Math.max(maxInFlight, inFlightNow);
        started++;
        if (started === 3) release(); // Release once all three are in flight (a serial implementation deadlocks here)
        await gate;
        inFlightNow--;
      },
    });
    await startBatch([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ]);
    expect(maxInFlight).toBe(3); // Exactly BATCH_CONCURRENCY, no more and no less
    expect([...calls.run].sort()).toEqual(["a", "b", "c", "d"]);
    const st = getBatchStatus();
    expect(st.ok).toBe(4);
    expect(st.done).toBe(4);
  });

  it("doc 拉不到 → failed,继续下一场", async () => {
    const calls = stubBridge({
      docs: { b: { kind: "match", data: src } },
    });
    await startBatch([
      { id: "gone", label: "G" },
      { id: "b", label: "B" },
    ]);
    expect(calls.run).toEqual(["b"]);
    const st = getBatchStatus();
    expect(st.failed).toBe(1);
    expect(st.ok).toBe(1);
  });

  it("取消:逐个定点 cancel 在飞单元(不无参全局取消),未起跑的场不再跑", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = stubBridge({
      docs: {
        a: { kind: "match", data: src },
        b: { kind: "match", data: src },
        c: { kind: "match", data: src },
        d: { kind: "match", data: src },
      },
      onRun: async () => {
        started++;
        if (started === 3) {
          // Cancel while all three are in flight: d must never get its turn
          cancelBatch();
          release();
        }
        await gate;
      },
    });
    await startBatch([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ]);
    // The matchId is mandatory: an argument-less global cancel would also
    // abort another analysis the user started by hand; under concurrency each
    // in-flight unit takes its own targeted cancel
    expect([...calls.cancel].sort()).toEqual(["a", "b", "c"]);
    expect(calls.cancel).not.toContain(undefined);
    expect([...calls.run].sort()).toEqual(["a", "b", "c"]); // d never started
    const st = getBatchStatus();
    expect(st.cancelled).toBe(true);
    expect(st.running).toBe(false);
  });

  it("IPC 意外 reject 只废该场,批次继续(agy F3)", async () => {
    const calls = stubBridge({
      rejectStateIds: ["a"],
      docs: {
        a: { kind: "match", data: src },
        b: { kind: "match", data: src },
      },
    });
    await startBatch([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    expect(calls.run).toEqual(["b"]);
    const st = getBatchStatus();
    expect(st.failed).toBe(1);
    expect(st.ok).toBe(1);
    expect(st.running).toBe(false);
  });

  it("跑批中订阅者能收到进度通知", async () => {
    stubBridge({ docs: { a: { kind: "match", data: src } } });
    const seen: number[] = [];
    const off = subscribeBatch(() => seen.push(getBatchStatus().done));
    await startBatch([{ id: "a", label: "A" }]);
    off();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
  });

  // 跳过已分析开关(2026-08-04):默认 true 保持原行为;false = 重新分析,
  // 已缓存的照跑并由 main 覆盖 —— 但正在跑的任何模式下都不重复。
  it("skipAnalyzed:false → 已缓存重新跑;running 仍跳过", async () => {
    const calls = stubBridge({
      cachedIds: ["a"],
      runningIds: ["b"],
      docs: {
        a: { kind: "match", data: src },
        b: { kind: "match", data: src },
        c: { kind: "match", data: src },
      },
    });
    await startBatch(
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      { skipAnalyzed: false },
    );
    expect(new Set(calls.run)).toEqual(new Set(["a", "c"]));
    const st = getBatchStatus();
    expect(st.ok).toBe(2);
    expect(st.skipped).toBe(1); // b: running
    expect(st.failed).toBe(0);
  });

  it("显式 skipAnalyzed:true 与默认等价:已缓存跳过", async () => {
    const calls = stubBridge({
      cachedIds: ["a"],
      docs: {
        a: { kind: "match", data: src },
        b: { kind: "match", data: src },
      },
    });
    await startBatch(
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      { skipAnalyzed: true },
    );
    expect(calls.run).toEqual(["b"]);
    expect(getBatchStatus().skipped).toBe(1);
  });

  // 意图守护管线接线(BACKLOG #26 Task 2 review, Important 项的整合测试):
  // rawStreamsCache.ts's ensureRawStreams (NOT mocked in this file — only
  // analysisInput.ts is) must be called with `item.id` (the lobby's on-disk
  // storage id) as storageId, not each round's own content-hash id — that
  // distinction is the whole reason the module has a separate `storageId`
  // param at all (see rawStreamsCache.ts's doc comment / matchStore.ts's
  // shuffle id convention).
  it("shuffle 逐轮调 ensureRawStreams,storageId 用 item.id(lobby id),不是各轮自己的 round.id", async () => {
    const getRawStreams = vi.fn().mockResolvedValue({
      available: false,
      manaSamples: [],
      castFailed: [],
    });
    // 与本文件其余用例的极简 `src` 不同:ensureRawStreams 真的会调用
    // toLegacySafe(source),需要一个 toLegacySafe 不报错的最小合法形状
    // (同 legacySource.test.ts 的 fixture)。
    const roundSrc = (id: string, startTime: number) => ({
      id,
      units: {},
      events: [],
      winningTeamId: 0,
      playerId: "p1",
      arenaId: "arena1",
      startTime,
      endTime: startTime + 100,
      duration: 100,
      bracket: "3v3",
    });
    const calls = stubBridge({
      docs: {
        lobby1: {
          kind: "shuffle",
          data: {
            rounds: [roundSrc("r1", 100), roundSrc("r2", 200)],
          },
        },
      },
    });
    (
      window as unknown as {
        __gladlogFixture: { matches: { getRawStreams: unknown } };
      }
    ).__gladlogFixture.matches.getRawStreams = getRawStreams;
    await startBatch([{ id: "lobby1", label: "L1" }]);
    expect([...calls.run].sort()).toEqual(["r1", "r2"]);
    // Both rounds fetch under the SAME (lobby) storageId, each with its own
    // round-specific baseMs (startTime) and roundDurationS (BACKLOG #32,
    // 100ms/1000 = 0.1s per this fixture's `endTime: startTime + 100`) —
    // never the round's own id, never a shared/leaked duration.
    expect(getRawStreams.mock.calls.sort((a, b) => a[1] - b[1])).toEqual([
      ["lobby1", 100, 0.1],
      ["lobby1", 200, 0.1],
    ]);
  });
});
