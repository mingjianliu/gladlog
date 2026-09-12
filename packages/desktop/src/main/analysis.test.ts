import type { CandidateEvent } from "@gladlog/analysis";
// Pre-warm deepDive: production code does an on-demand `await import` inside
// deepenInner (so main no longer loads the 12MB spellNames table at startup).
// Tests must keep that 12MB load in the collect phase — otherwise the first
// deepen case pays a table load inside its 5s timeout budget, and slow CI
// machines demonstrably time out (run 30193881051: green locally, failed twice on CI).
import "@gladlog/analysis/src/analysis/deepDive";
import { describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";

// Only for the "disk-write failure" regression case (F2 re-review) to simulate
// EACCES: the real fs named exports are non-redefinable properties under this
// runtime (vi.spyOn throws "Cannot redefine property" outright), so the module
// factory of vi.mock is the only way. It delegates to the real implementation
// by default (actual.writeFileSync), so disk I/O behavior for every other case
// in this file is unchanged; only the one case below uses
// mockImplementationOnce to throw once, then falls back to the real implementation.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});
import { join } from "path";

import { PROMPT_VERSION } from "./ai";
import { listAiDebug } from "./aiDebugLog";
import { findingKey } from "../shared/findingKey";
import { createAnalysisService } from "./analysis";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];
function svc(streamText: string, apiKey: string | null = "k") {
  const emitted: Array<{ ch: string; p: any }> = [];
  const s = createAnalysisService({
    getSettings: () => ({
      anthropicApiKey: apiKey,
      wowDirectory: null,
    }),
    clientFactory: () => ({
      async *stream() {
        yield { delta: streamText };
      },
    }),
    matchesDir: "/tmp/nope-" + Math.random(),
    emit: (ch, p) => emitted.push({ ch, p }),
  });
  return { s, emitted };
}
const input = {
  matchId: "m1",
  candidates,
  richContext: "ctx",
  spec: "Discipline Priest",
};

describe("createAnalysisService", () => {
  it("audits LLM JSON findings and returns interpolated survivors", async () => {
    const { s, emitted } = svc(
      JSON.stringify([
        {
          eventIds: ["death:a:30"],
          severity: "high",
          category: "survival",
          title: "Death",
          explanation: "You died at {{t}}s.",
        },
      ]),
    );
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.findings[0].explanation).toBe("You died at 30s.");
    expect(done.p.result.hadNarration).toBe(true);
  });
  it("invalid JSON → deterministic fallback, no error", async () => {
    const { s, emitted } = svc("not json at all");
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.hadNarration).toBe(false);
    expect(
      emitted.find((e) => e.ch === "gladlog:analysis:error"),
    ).toBeUndefined();
  });
  it("bad-json 自动重试要发 retry 事件(2026-08-05:CLI 后端单发分钟级,静默重试=总时长翻倍无解释);好 JSON 不发", async () => {
    const { s, emitted } = svc("not json at all");
    await s.run(input);
    const retries = emitted.filter((e) => e.ch === "gladlog:analysis:retry");
    expect(retries).toEqual([
      { ch: "gladlog:analysis:retry", p: { matchId: "m1" } },
    ]);

    const ok = svc(JSON.stringify([]));
    await ok.s.run(input);
    expect(
      ok.emitted.find((e) => e.ch === "gladlog:analysis:retry"),
    ).toBeUndefined();
  });
  it("重试轮进行中 getState 的 runningMeta.retrying=true(agy review #1:重挂载不丢翻倍解释)", async () => {
    let attempt = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          attempt++;
          if (attempt === 1) {
            yield { delta: "not json" };
            return;
          }
          await gate; // 卡住 attempt 2,给 getState 一个观测窗口
          yield { delta: "[]" };
        },
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
    });
    const p = s.run(input);
    // 等 attempt 2 真正开始(attempt 1 结束、retrying 已置位)
    await vi.waitFor(() => expect(attempt).toBe(2));
    const mid = await s.getState("m1");
    expect(mid.runningMeta?.retrying).toBe(true);
    release();
    await p;
    expect((await s.getState("m1")).runningMeta).toBeNull(); // 跑完清干净
  });
  it("no API key → deterministic fallback, no error", async () => {
    const { s, emitted } = svc("unused", null);
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.hadNarration).toBe(false);
  });
});

/**
 * coach chat (2026-08-02 spec) Task 4: the session id captured by CLI-backend
 * (claudeCli/agy/codex) analysis calls must be written into the cached
 * AnalysisResult so later chats can resume.
 *
 * claudeCli goes resolveAiClient → claudeCliClientFactory and does not pass
 * through the clientFactory injection surface (which only stubs the anthropic
 * backend) — the only option is vi.doMock("./ai") to swap out resolveAiClient
 * while keeping the other real exports (buildCoachSystemPrompt/PROMPT_VERSION),
 * then dynamically import("./analysis") to get a createAnalysisService bound to
 * the stub, without polluting the other cases in this file (they still use the
 * top-level static import and the real "./ai").
 */
describe("sessionId 捕获(coach chat Task 4)", () => {
  it("CLI 后端分析捕获 sessionId 进缓存;重试轮 claudeCli 换新 UUID", async () => {
    const hints: Array<string | undefined> = [];
    let attempt = 0;
    vi.resetModules();
    vi.doMock("./ai", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./ai")>();
      return {
        ...actual,
        resolveAiClient: () => ({
          async *stream(params: { sessionIdHint?: string }) {
            attempt++;
            hints.push(params.sessionIdHint);
            if (attempt === 1) {
              // attempt 1: bad JSON, triggers a retry
              yield { delta: "not json" };
              return;
            }
            // attempt 2: valid finding + session id event
            yield {
              delta: JSON.stringify([
                {
                  eventIds: ["death:a:30"],
                  severity: "high",
                  category: "survival",
                  title: "阵亡",
                  explanation: "你在 {{t}}s 倒下。",
                },
              ]),
            };
            yield { sessionId: params.sessionIdHint! };
          },
        }),
      };
    });
    try {
      const { createAnalysisService: createSvc } = await import("./analysis");
      const dir = mkdtempSync(join(tmpdir(), "gl-session-"));
      const s = createSvc({
        getSettings: () => ({
          anthropicApiKey: null,
          wowDirectory: null,
          aiBackend: "claudeCli" as const,
          aiLanguage: "zh" as const,
        }),
        matchesDir: dir,
        emit: () => {},
      });
      await s.run(input);
      const cached = (await s.getCached("m1")) as { sessionId?: string };
      expect(cached?.sessionId).toBe(hints[1]);
      expect(hints[0]).not.toBe(hints[1]);
    } finally {
      vi.doUnmock("./ai");
      vi.resetModules();
    }
  });
});

describe("isRunning 追踪(切页防丢 + 泄漏回归)", () => {
  it("完成后清除 running", async () => {
    const { s } = svc(JSON.stringify([]));
    await s.run(input);
    expect(await s.isRunning("m1")).toBe(false);
  });

  // Leak found in re-review: when a run is superseded by deepen (which ++es the
  // same matchId's generation), the old implementation's abort path did not clear
  // `running` (and the cleanup criterion was "is the generation current", which is
  // necessarily false after deepen) → `running` lingered forever → switching to a
  // language with no cache got stuck on "analyzing…". Fix: store the generation in
  // `running`, clear by ownership, and clear on abort too.
  it("run 被 deepen 取代后 running 不泄漏", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
      }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: JSON.stringify([]) };
          await gate; // hang: simulates the first round still running
        },
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
    });
    const runP = s.run(input); // marks running, emits first delta, then parks at gate
    await new Promise((r) => setTimeout(r, 0)); // let the for-await reach the gate
    expect(await s.isRunning("m1")).toBe(true);
    // Empty packs → deepen just ++es the generation and returns (no streaming),
    // which exactly simulates "a deep dive superseding an in-flight run"
    await s.deepen({ matchId: "m1", findings: [], packs: [], spec: "x" });
    release(); // run resumes → isCurrent false → abort → clearRunning
    await runP;
    expect(await s.isRunning("m1")).toBe(false); // old implementation left true here
  });
});

describe("AI 语言(backlog #1)", () => {
  const finding = JSON.stringify([
    {
      eventIds: ["death:a:30"],
      severity: "high",
      category: "survival",
      title: "Death",
      explanation: "You died at {{t}}s.",
    },
  ]);

  function langSvc(lang: "zh" | "en" | undefined, dir: string) {
    const captured: Array<{ system?: string }> = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        aiLanguage: lang,
      }),
      clientFactory: () => ({
        async *stream(params: { system?: string }) {
          captured.push({ system: params.system });
          yield { delta: finding };
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    return { s, captured };
  }

  it("system prompt 按语言注入;缓存分键 analysis-v2.<lang>.json,互不命中", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { existsSync } = await import("fs");
    const dir = mkdtempSync(join(tmpdir(), "gl-ai-lang-"));

    const zh = langSvc("zh", dir);
    await zh.s.run(input);
    expect(zh.captured[0]!.system).toContain("Simplified Chinese");
    expect(existsSync(join(dir, "m1", "analysis-v2.zh.json"))).toBe(true);
    expect(await zh.s.getCached("m1")).not.toBeNull();

    // Same dir, switch to English: zh cache invisible (miss); generates then writes the en key
    const en = langSvc("en", dir);
    expect(await en.s.getCached("m1")).toBeNull();
    await en.s.run(input);
    expect(en.captured[0]!.system).toContain("Respond in English");
    expect(en.captured[0]!.system).not.toContain("Simplified Chinese");
    expect(existsSync(join(dir, "m1", "analysis-v2.en.json"))).toBe(true);
    expect(await en.s.getCached("m1")).not.toBeNull();
    // zh key still present; switching back to zh hits directly
    expect(await zh.s.getCached("m1")).not.toBeNull();
  });

  it("旧缓存(无语言键)只在请求英文时兜底命中;缺省语言为 zh", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "gl-ai-legacy-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "analysis-v2.json"),
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: PROMPT_VERSION,
        createdAt: 1,
        result: { findings: [], dropped: 0, hadNarration: false },
      }),
    );
    const en = langSvc("en", dir);
    expect(await en.s.getCached("m1")).not.toBeNull();
    const zhDefault = langSvc(undefined, dir); // default → zh
    expect(await zhDefault.s.getCached("m1")).toBeNull();
  });
});

describe("finding 标记(phase3 #3a)", () => {
  it("setFlag 落盘、覆盖、清除;getFlags 缺文件回空", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "gl-flags-"));
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
      }),
      matchesDir: dir,
      emit: () => {},
    });
    expect(await s.getFlags("m1")).toEqual({});
    await s.setFlag("m1", "survival|e1,e2", "done");
    expect(await s.getFlags("m1")).toEqual({ "survival|e1,e2": "done" });
    await s.setFlag("m1", "survival|e1,e2", "recurring");
    await s.setFlag("m1", "cd|e3", "done");
    expect(await s.getFlags("m1")).toEqual({
      "survival|e1,e2": "recurring",
      "cd|e3": "done",
    });
    await s.setFlag("m1", "cd|e3", null);
    expect(await s.getFlags("m1")).toEqual({ "survival|e1,e2": "recurring" });
  });
});

describe("跨场聚合(phase3 #3b)", () => {
  it("按 category 计数、双语言只计一份、flag 统计、recent 按时间", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "gl-agg-"));
    const doc = (createdAt: number, findings: unknown[]) =>
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: PROMPT_VERSION,
        createdAt,
        result: { findings, dropped: 0, hadNarration: true },
      });
    const f = (category: string, title: string, ids: string[]) => ({
      category,
      title,
      severity: "high",
      eventIds: ids,
      explanation: "",
    });
    // m1: both zh + en caches (must count only once); m2: en only; m1 has a recurring flag
    mkdirSync(join(dir, "m1"));
    writeFileSync(
      join(dir, "m1", "analysis-v2.zh.json"),
      doc(200, [f("survival", "死亡A", ["e1"]), f("cd", "CD浪费", ["e2"])]),
    );
    writeFileSync(
      join(dir, "m1", "analysis-v2.en.json"),
      doc(200, [f("survival", "DeathA", ["e1"])]),
    );
    writeFileSync(
      join(dir, "m1", "findingFlags.json"),
      JSON.stringify({ "survival|e1": "recurring" }),
    );
    writeFileSync(
      join(dir, "m1", "meta.json"),
      JSON.stringify({ id: "m1-real" }),
    );
    mkdirSync(join(dir, "m2"));
    writeFileSync(
      join(dir, "m2", "analysis-v2.en.json"),
      doc(100, [f("survival", "DeathB", ["e9"])]),
    );

    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
        aiLanguage: "zh",
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const agg = await s.aggregate();
    const survival = agg.find((a) => a.category === "survival")!;
    // m1 contributes its zh copy (1 survival) + m2 falls back to en (1) = 2
    expect(survival.count).toBe(2);
    expect(survival.recurring).toBe(1);
    // recent is sorted by createdAt descending; newest is m1 (200); the real id from meta.json applies
    expect(survival.recent[0]!.matchId).toBe("m1-real");
    expect(survival.recent[0]!.title).toBe("死亡A");
    // Aggregation keys are normalized (enumerated): the legacy "cd" shape merges into the cooldowns group
    expect(agg.find((a) => a.category === "cooldowns")!.count).toBe(1);
    expect(agg.find((a) => a.category === "cd")).toBeUndefined();
  });
});

describe("定点取消(批量取消不误伤手动分析)", () => {
  it("cancel(matchId) 只 abort 该场在飞的 run,别场照常完成", async () => {
    const gates = new Map<string, () => void>();
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
      }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: JSON.stringify([]) };
          await new Promise<void>((r) => {
            // Each stream hangs on its own gate, released one by one
            gates.set(gates.has("g1") ? "g2" : "g1", r);
          });
          yield { delta: "" };
        },
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
    });
    const p1 = s.run({ ...input, matchId: "m1" });
    const p2 = s.run({ ...input, matchId: "m2" });
    await new Promise((r) => setTimeout(r, 0)); // both streams parked at their gates
    expect(await s.isRunning("m1")).toBe(true);
    expect(await s.isRunning("m2")).toBe(true);

    await s.cancel("m1"); // targeted: invalidates only m1
    expect(await s.isRunning("m1")).toBe(false);
    expect(await s.isRunning("m2")).toBe(true); // other match unharmed
    gates.get("g1")!();
    gates.get("g2")!();
    await Promise.all([p1, p2]);
    expect(await s.isRunning("m2")).toBe(false); // m2 completed normally
  });
});

describe("listAnalyzed(批量分析的跳过谓词)", () => {
  it("命中谓词与 getCached 一致:当前语言有效缓存才算;id 走 meta.json 兜底目录名", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "gl-la-"));
    const doc = (promptVersion: number) =>
      JSON.stringify({
        schemaVersion: 1,
        promptVersion,
        createdAt: 1,
        result: { findings: [], dropped: 0, hadNarration: true },
      });
    // m1: valid zh cache + real id in meta.json → counted, id taken from meta
    mkdirSync(join(dir, "m1"));
    writeFileSync(join(dir, "m1", "analysis-v2.zh.json"), doc(PROMPT_VERSION));
    writeFileSync(
      join(dir, "m1", "meta.json"),
      JSON.stringify({ id: "m1-real" }),
    );
    // m2: stale promptVersion → not counted (equivalent to a getCached miss; batch will re-run it)
    mkdirSync(join(dir, "m2"));
    writeFileSync(
      join(dir, "m2", "analysis-v2.zh.json"),
      doc(PROMPT_VERSION - 1),
    );
    // m3: en cache only while the current language is zh → not counted (the zh panel can't see this cache either)
    mkdirSync(join(dir, "m3"));
    writeFileSync(join(dir, "m3", "analysis-v2.en.json"), doc(PROMPT_VERSION));
    // m4: valid cache without meta.json (non-first shuffle round) → counted, directory name as fallback
    mkdirSync(join(dir, "m4"));
    writeFileSync(join(dir, "m4", "analysis-v2.zh.json"), doc(PROMPT_VERSION));

    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
        aiLanguage: "zh",
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const ids = await s.listAnalyzed();
    expect(ids.sort()).toEqual(["m1-real", "m4"]);
  });

  it("matchesDir 不存在 → 空数组", async () => {
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
        aiLanguage: "zh",
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
    });
    expect(await s.listAnalyzed()).toEqual([]);
  });
});

describe("fallbackReason(0 finding 可解释)", () => {
  it("无候选 → no-candidates", async () => {
    const { s: svc1, emitted } = svc("unused");
    await svc1.run({ ...input, candidates: [] });
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.fallbackReason).toBe("no-candidates");
  });
  it("无 client → no-client;坏 JSON → bad-json", async () => {
    const a = svc("unused", null);
    await a.s.run(input);
    expect(
      a.emitted.find((e) => e.ch === "gladlog:analysis:done")!.p.result
        .fallbackReason,
    ).toBe("no-client");
    const b = svc("not json at all");
    await b.s.run(input);
    expect(
      b.emitted.find((e) => e.ch === "gladlog:analysis:done")!.p.result
        .fallbackReason,
    ).toBe("bad-json");
  });
});

describe("onFindings(学习台账写入点)", () => {
  it("审计成功 → 回调,matchId 与 candidates 原样带出", async () => {
    const events: Array<{
      matchId: string;
      findings: unknown[];
      candidates: unknown[];
    }> = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
      }),
      clientFactory: () => ({
        async *stream() {
          yield {
            delta: JSON.stringify([
              {
                eventIds: ["death:a:30"],
                severity: "high",
                category: "survival",
                title: "Death",
                explanation: "You died at {{t}}s.",
              },
            ]),
          };
        },
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
      onFindings: (e) => events.push(e),
    });
    await s.run(input);
    expect(events).toHaveLength(1);
    expect(events[0]!.matchId).toBe("m1");
    expect(events[0]!.candidates).toBe(input.candidates);
    expect(events[0]!.findings).toHaveLength(1);
  });

  it("no-candidates → 记录(0 findings 进频次分母)", async () => {
    const events: Array<{ matchId: string; findings: unknown[] }> = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
      onFindings: (e) => events.push(e),
    });
    await s.run({ ...input, candidates: [] });
    expect(events).toHaveLength(1);
    expect(events[0]!.matchId).toBe("m1");
    expect(events[0]!.findings).toEqual([]);
  });

  it("no-client → 不记录(没分析就没记忆)", async () => {
    const events: unknown[] = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
      onFindings: (e) => events.push(e),
    });
    await s.run(input);
    expect(events).toHaveLength(0);
  });

  it("bad-json → 不记录", async () => {
    const events: unknown[] = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
      }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: "not json at all" };
        },
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
      onFindings: (e) => events.push(e),
    });
    await s.run(input);
    expect(events).toHaveLength(0);
  });

  it("onFindings 同步抛错(no-candidates 路径)不污染主流程:done 照发、无 error、Promise 不 reject", async () => {
    const emitted: Array<{ ch: string; p: any }> = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: (ch, p) => emitted.push({ ch, p }),
      onFindings: () => {
        throw new Error("ledger write boom");
      },
    });
    await expect(s.run({ ...input, candidates: [] })).resolves.toBeUndefined();
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done");
    expect(done).toBeDefined();
    expect(done!.p.result.fallbackReason).toBe("no-candidates");
    expect(
      emitted.find((e) => e.ch === "gladlog:analysis:error"),
    ).toBeUndefined();
  });
});

describe("notebook(错题本跨场分组)", () => {
  it("按 category 分组、并入 meta 与标记、组内时间倒序", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "gl-nb-"));

    const writeMatch = (
      id: string,
      startTime: number,
      findings: Array<{
        eventIds: string[];
        severity: string;
        category: string;
        title: string;
        explanation: string;
      }>,
      flags?: Record<string, string>,
    ) => {
      const base = join(dir, id);
      mkdirSync(base, { recursive: true });
      writeFileSync(
        join(base, "analysis-v2.zh.json"),
        JSON.stringify({
          schemaVersion: 1,
          promptVersion: PROMPT_VERSION,
          language: "zh",
          createdAt: startTime,
          result: { findings, dropped: 0, hadNarration: true },
        }),
      );
      writeFileSync(
        join(base, "meta.json"),
        JSON.stringify({
          id,
          startTime,
          zoneId: "1505",
          result: "Win",
          bracket: "3v3",
        }),
      );
      if (flags)
        writeFileSync(join(base, "findingFlags.json"), JSON.stringify(flags));
    };

    const f = (category: string, title: string, ev: string) => ({
      eventIds: [ev],
      severity: "high",
      category,
      title,
      explanation: "x",
    });
    writeMatch("old", 1000, [f("生存", "早的", "e1")]);
    writeMatch(
      "new",
      2000,
      [f("生存", "晚的", "e2"), f("打断", "另一类", "e3")],
      {
        [findingKey(f("生存", "晚的", "e2"))]: "recurring",
      },
    );

    const s2 = createAnalysisService({
      getSettings: () => ({ aiLanguage: "zh" }) as never,
      matchesDir: dir,
      clientFactory: () => null as never,
      emit: () => {},
    });
    const nb = await s2.notebook();
    expect(nb.map((g) => g.category)).toEqual(["生存", "打断"]); // count descending
    const surv = nb[0]!;
    expect(surv.count).toBe(2);
    expect(surv.recurring).toBe(1);
    expect(surv.entries.map((e) => e.title)).toEqual(["晚的", "早的"]); // reverse chronological
    expect(surv.entries[0]).toMatchObject({
      matchId: "new",
      flag: "recurring",
      zoneId: "1505",
      result: "Win",
      bracket: "3v3",
      startTime: 2000,
    });
  });
});

describe("deepen(深挖轮)", () => {
  const pack = {
    findingIndex: 0,
    anchorFrom: 100,
    anchorTo: 150,
    items: [
      {
        key: "p1",
        kind: "cc" as const,
        t: 128,
        label: "Fear → Healer(4.0s)",
        unitNames: ["Healer-R"],
        facts: { t: "128", spell: "Fear", duration: "4.0" },
      },
    ],
    facts: { "p1.t": "128", "p1.spell": "Fear", "p1.duration": "4.0" },
  };
  const baseFindings = [
    {
      eventIds: ["death:v:150"],
      severity: "high",
      category: "survival",
      title: "被秒",
      explanation: "You died at 150s.",
    },
  ];

  it("合规深挖 → 合并进结果并再次 emit done;审不过 → 保持初轮", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const good = JSON.stringify([
      {
        findingIndex: 0,
        deepDive: "At {{p1.t}}s the healer ate {{p1.spell}}. Swap earlier.",
        citedKeys: ["p1"],
      },
    ]);
    const emitted: Array<{ ch: string; p: any }> = [];
    const svcDeep = (raw: string) =>
      createAnalysisService({
        getSettings: () => ({ anthropicApiKey: "k" }) as never,
        matchesDir: mkdtempSync(join(tmpdir(), "gl-deep-")),
        clientFactory: () =>
          ({
            stream: () =>
              (async function* () {
                yield { delta: raw };
              })(),
          }) as never,
        emit: (ch, p) => emitted.push({ ch, p }),
      });

    await svcDeep(good).deepen({
      matchId: "m1",
      findings: baseFindings as never,
      packs: [pack] as never,
      spec: "Frost Mage",
    });
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.deepened).toBe(true);
    expect(done.p.result.findings[0].deepDive.text).toContain(
      "At 128s the healer ate Fear",
    );
    expect(done.p.result.findings[0].deepDive.chips[0].t).toBe(128);

    emitted.length = 0;
    const bad = JSON.stringify([
      {
        findingIndex: 0,
        deepDive: "The Fear caused your death at {{p1.t}}s.", // causal assertion
        citedKeys: ["p1"],
      },
    ]);
    await svcDeep(bad).deepen({
      matchId: "m1",
      findings: baseFindings as never,
      packs: [pack] as never,
      spec: "Frost Mage",
    });
    const done2 = emitted
      .filter((e) => e.ch === "gladlog:analysis:done")
      .pop()!;
    expect(done2.p.result.deepened).toBe(true);
    expect(done2.p.result.findings[0].deepDive).toBeUndefined();
  });

  it("无 client / 空 packs → 只落 deepened 标志,不调模型", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const emitted: Array<{ ch: string; p: any }> = [];
    const s2 = createAnalysisService({
      getSettings: () => ({}) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-deep2-")),
      clientFactory: () => null as never,
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    await s2.deepen({
      matchId: "m1",
      findings: baseFindings as never,
      packs: [] as never,
      spec: "s",
    });
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.deepened).toBe(true);
    expect(done.p.result.findings[0].deepDive).toBeUndefined();
  });

  // agy flash re-review (Task 4) F2: when writing the deep-dive merged result to
  // disk fails, the original implementation still put slotKey: doc.lastSlotKey in
  // the done payload — but that value comes from the "old file it read", and this
  // deep dive never actually wrote it back to disk. The activeKey the renderer
  // refreshes with goes through a different read path (a different legacySlotKey
  // placeholder), so they most likely disagree and trigger a meaningless
  // "invariant violated" warn. Fix: the write-failure branch simply omits slotKey
  // (consistent with the "no doc / no slot" cold path — a slot that was never
  // written must not masquerade as a written one).
  it("写盘失败 → done payload 不带 slotKey(避免与刷新后 activeKey 误判不一致)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-deep-writefail-"));
    const emitted: Array<{ ch: string; p: any }> = [];
    const s = createAnalysisService({
      getSettings: () => ({}) as never,
      matchesDir: dir,
      clientFactory: () => null as never, // no client → deepen goes straight to writeMerged, no model call
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    // First do a real run() to land a valid v2 cache on disk (writeMerged only
    // enters the "attempt disk write" branch after reading a non-empty doc/slot).
    await s.run({
      matchId: "m1",
      candidates: [] as never,
      richContext: "ctx",
      spec: "s",
    });
    emitted.length = 0;

    const writeSpy = vi.mocked(writeFileSync);
    const callsBefore = writeSpy.mock.calls.length;
    writeSpy.mockImplementationOnce(() => {
      throw new Error("EACCES (simulated disk-write failure)");
    });
    await s.deepen({
      matchId: "m1",
      findings: baseFindings as never,
      packs: [] as never,
      spec: "s",
    });
    // First confirm the mocked write call was actually reached (otherwise the assertion below proves nothing).
    expect(writeSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.deepened).toBe(true);
    expect(done.p.slotKey).toBeUndefined();
  });
});

describe("deepen 审计全灭反馈重试(SDD 2026-08-06)", () => {
  const pack = {
    findingIndex: 0,
    anchorFrom: 100,
    anchorTo: 150,
    items: [
      {
        key: "p1",
        kind: "cc" as const,
        t: 128,
        label: "Fear → Healer(4.0s)",
        unitNames: ["Healer-R"],
        facts: { t: "128", spell: "Fear", duration: "4.0" },
      },
    ],
    facts: { "p1.t": "128", "p1.spell": "Fear", "p1.duration": "4.0" },
  };
  const baseFindings = [
    {
      eventIds: ["death:v:150"],
      severity: "high",
      category: "survival",
      title: "被秒",
      explanation: "You died at 150s.",
    },
  ];
  // Bare digit ("128s" outside any {{p1.field}} placeholder) → dropped at the
  // bare-digit gate regardless of claimChecker's more lenient pass — 0
  // survivors, 1 drop, exactly the shouldAttemptAuditRepair(0, drops>0) shape.
  const BAD = JSON.stringify([
    {
      findingIndex: 0,
      deepDive: "The healer ate Fear at 128s with no trinket up.",
      citedKeys: ["p1"],
    },
  ]);
  const GOOD = JSON.stringify([
    {
      findingIndex: 0,
      deepDive: "At {{p1.t}}s the healer ate {{p1.spell}}. Swap earlier.",
      citedKeys: ["p1"],
    },
  ]);
  // Still a causal assertion after the "repair" — a model that refuses to fix
  // the violation, used to prove the retry never becomes a loop.
  const BAD2 = JSON.stringify([
    {
      findingIndex: 0,
      deepDive: "The Fear caused your death at {{p1.t}}s.",
      citedKeys: ["p1"],
    },
  ]);

  /** Sequential-response mock: call i gets responses[i] (clamped to the last
   * entry once the sequence is exhausted, so a stray extra call never throws
   * inside the mock itself — a test asserting the call COUNT is the one that
   * proves no extra call happened, not the mock running out of fixtures). */
  function svc(dir: string, responses: string[]) {
    let calls = 0;
    const emitted: Array<{ ch: string; p: any }> = [];
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: dir,
      clientFactory: () => ({
        stream: () => {
          const resp = responses[calls] ?? responses[responses.length - 1]!;
          calls++;
          return (async function* () {
            yield { delta: resp };
          })();
        },
      }),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    return { s, emitted, calls: () => calls };
  }

  it("首响应全灭(裸数字)→ 修复响应合规 → 存活合并进结果,recordAiDebug 出现 #audit-repair", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-deep-repair-ok-"));
    const { s, emitted } = svc(dir, [BAD, GOOD]);
    await s.deepen({
      matchId: "m-repair-ok",
      findings: baseFindings as never,
      packs: [pack] as never,
      spec: "Frost Mage",
    });
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.deepened).toBe(true);
    expect(done.p.result.findings[0].deepDive.text).toContain(
      "At 128s the healer ate Fear",
    );
    expect(
      listAiDebug().some((e) => e.matchId === "m-repair-ok#audit-repair"),
    ).toBe(true);
  });

  it("首响应已有存活 → 不触发修复重试(只调一次模型)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-deep-repair-noneed-"));
    const { s, emitted, calls } = svc(dir, [GOOD]);
    await s.deepen({
      matchId: "m-repair-noneed",
      findings: baseFindings as never,
      packs: [pack] as never,
      spec: "Frost Mage",
    });
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.findings[0].deepDive.text).toContain(
      "At 128s the healer ate Fear",
    );
    expect(calls()).toBe(1); // one survivor on the first pass -> no repair call
  });

  it("修复响应仍违规(因果断言)→ 维持空结果,不再发起第三次调用", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-deep-repair-stillbad-"));
    const { s, emitted, calls } = svc(dir, [BAD, BAD2]);
    await s.deepen({
      matchId: "m-repair-stillbad",
      findings: baseFindings as never,
      packs: [pack] as never,
      spec: "Frost Mage",
    });
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.deepened).toBe(true);
    expect(done.p.result.findings[0].deepDive).toBeUndefined();
    expect(calls()).toBe(2); // first attempt + one repair retry, never a third call
  });

  it("修复调用抛错 → 静默维持空结果(不影响首轮已完成的部分)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-deep-repair-throws-"));
    const emitted: Array<{ ch: string; p: any }> = [];
    let n = 0;
    await createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: dir,
      clientFactory: () => ({
        stream: () => {
          n++;
          if (n === 1)
            return (async function* () {
              yield { delta: BAD };
            })();
          throw new Error("repair call boom");
        },
      }),
      emit: (ch, p) => emitted.push({ ch, p }),
    }).deepen({
      matchId: "m-repair-throws",
      findings: baseFindings as never,
      packs: [pack] as never,
      spec: "Frost Mage",
    });
    const done = emitted.filter((e) => e.ch === "gladlog:analysis:done").pop()!;
    expect(done.p.result.deepened).toBe(true);
    expect(done.p.result.findings[0].deepDive).toBeUndefined();
    expect(n).toBe(2);
  });
});

describe("deepen 幂等守卫(周度复核 P2#4)", () => {
  // Root cause: the renderer's trigger condition is that `deepened` is still false
  // in the cache, but that flag only lands on disk after this round's writeMerged.
  // During the tens of seconds a deep dive is in flight, switching away and back →
  // panel remounts → triggers again, burning a whole round of tokens for nothing
  // (the old gen gets aborted as stale by nextGen, but the request already went out).
  it("同一场深挖在飞时的重复调用被丢弃,模型只调一次", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const payload = JSON.stringify([
      {
        findingIndex: 0,
        deepDive: "At {{p1.t}}s the healer ate {{p1.spell}}. Swap earlier.",
        citedKeys: ["p1"],
      },
    ]);
    let streamCalls = 0;
    let release!: () => void;
    const inFlight = new Promise<void>((r) => (release = r));
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-deep-idem-")),
      clientFactory: () =>
        ({
          stream: () => {
            streamCalls++;
            return (async function* () {
              await inFlight; // stuck = deep dive in flight
              yield { delta: payload };
            })();
          },
        }) as never,
      emit: () => {},
    });
    const args = {
      matchId: "m1",
      findings: [
        {
          eventIds: ["death:v:150"],
          severity: "high",
          category: "survival",
          title: "被秒",
          explanation: "You died at 150s.",
        },
      ] as never,
      packs: [
        {
          findingIndex: 0,
          anchorFrom: 100,
          anchorTo: 150,
          items: [
            {
              key: "p1",
              kind: "cc" as const,
              t: 128,
              label: "Fear → Healer",
              unitNames: ["Healer-R"],
              facts: { t: "128", spell: "Fear" },
            },
          ],
          facts: { "p1.t": "128", "p1.spell": "Fear" },
        },
      ] as never,
      spec: "Frost Mage",
    };

    const first = s.deepen(args);
    // The deepDive module is imported on demand inside deepenInner (so main
    // doesn't load the 12MB spellNames at startup, see analysis.ts); entering the
    // stream lags deepen() by a few microtasks — poll until it's there. The
    // deepening guard itself still takes effect synchronously before the first await.
    await vi.waitFor(() => expect(streamCalls).toBe(1)); // first round is streaming
    await s.deepen(args); // duplicate trigger from switching back to the page
    expect(streamCalls).toBe(1); // no second model call
    release();
    await first;
    expect(streamCalls).toBe(1);

    // The guard is "while in flight", not "forever": after this round finishes a new deep dive is allowed (manual re-run by the user)
    release = () => {};
    await s.deepen(args);
    expect(streamCalls).toBe(2);
  });
});

/**
 * Per-slot persistence (multi-model comparison, Task 2): analysis results for
 * different backend/model pairs on the same match must not overwrite each other,
 * getState must summarize every slot, deepen must touch only the lastSlotKey
 * slot, and cross-match consumers (aggregate/notebook) must report the same
 * numbers as the single-result era even with v1/v2 files mixed on disk.
 *
 * How backendOverride is injected: the override uses backend:"anthropic" plus a
 * different model (claude-opus-4-8), reusing the Anthropic clientFactory
 * injection surface that svc() already provides — resolveAiClient only calls
 * clientFactory for the anthropic backend; deepseek/claudeCli and friends
 * hardcode their own factories and cannot be injected into. This route already
 * varies both segments of slotKeyOf(backend, model) (backend fixed, model
 * changed → still a different slotKey), which is enough to exercise the slotting
 * mechanism itself; genuinely cross-backend slots (e.g. deepseek) are covered in
 * the aggregate/notebook cases below by writing v2 fixture files directly, so no
 * separate network client is needed for them.
 */
describe("分槽落盘(多模型对比)", () => {
  function multiModelSvc(dir: string) {
    const streamCalls: Array<{ model: string }> = [];
    const findingFor = (model: string) =>
      JSON.stringify([
        {
          eventIds: ["death:a:30"],
          severity: "high",
          category: "survival",
          title: `Death(${model})`,
          explanation: "You died at {{t}}s.",
        },
      ]);
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream(params: { model: string }) {
          streamCalls.push({ model: params.model });
          yield { delta: findingFor(params.model) };
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    return { s, streamCalls };
  }

  it("分槽:换 backendOverride(同后端换模型)重分析不覆盖旧槽,getState 列两槽", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-"));
    const { s } = multiModelSvc(dir);
    await s.run({ matchId: "m1", candidates, richContext: "ctx", spec: "s" });
    await s.run({
      matchId: "m1",
      candidates,
      richContext: "ctx",
      spec: "s",
      backendOverride: { backend: "anthropic", model: "claude-opus-4-8" },
    });
    const st = await s.getState("m1");
    expect(st.slots.map((x) => x.key).sort()).toEqual([
      "anthropic:claude-opus-4-8",
      "anthropic:claude-opus-5",
    ]);
    expect(st.activeKey).toBe("anthropic:claude-opus-4-8");
    expect(st.slots.every((x) => x.stale === false)).toBe(true);
    const oldSlot = await s.getCached("m1", "anthropic:claude-opus-5");
    expect(oldSlot).not.toBeNull();
    expect(oldSlot!.findings[0]!.title).toBe("Death(claude-opus-5)");
    const newSlot = await s.getCached("m1", "anthropic:claude-opus-4-8");
    expect(newSlot!.findings[0]!.title).toBe("Death(claude-opus-4-8)");
  });

  it("旧 v1 文件读取:getCached 照常返回结果(懒迁移),再分析后升 v2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-v1-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "analysis-v2.zh.json"),
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: PROMPT_VERSION,
        language: "zh",
        createdAt: 1,
        result: { findings: [], dropped: 0, hadNarration: false },
      }),
    );
    const { s } = multiModelSvc(dir);
    // Lazy migration: the v1 file is not upgraded on disk; getCached still hits
    // it directly (converted in memory)
    expect(await s.getCached("m1")).not.toBeNull();
    await s.run({ matchId: "m1", candidates, richContext: "ctx", spec: "s" });
    const raw = JSON.parse(
      readFileSync(join(dir, "m1", "analysis-v2.zh.json"), "utf-8"),
    );
    expect(raw.schemaVersion).toBe(2);
    expect(Object.keys(raw.slots)).toEqual(["anthropic:claude-opus-5"]);
    expect(await s.getCached("m1")).not.toBeNull();
  });

  it("旧 v1 文件 + backendOverride 重分析:v1 内容归属 settings 默认槽,不被 override 槽覆盖(legacySlotKey 修复)", async () => {
    // Review-round fix: legacySlotKey must be the backend:model of the *current
    // settings* (excluding any override), not the slotKey produced by this
    // override — otherwise, when overriding to a backend that has never run,
    // toSlottedDoc temporarily files the old v1 analysis under the override key
    // and upsertSlot immediately overwrites that same key with the new result,
    // making the v1 content vanish.
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-v1-override-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "analysis-v2.zh.json"),
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: PROMPT_VERSION,
        language: "zh",
        createdAt: 1,
        result: {
          findings: [
            {
              eventIds: ["death:a:30"],
              severity: "high",
              category: "survival",
              title: "v1旧分析",
              explanation: "x",
            },
          ],
          dropped: 0,
          hadNarration: true,
        },
      }),
    );
    const { s } = multiModelSvc(dir);
    await s.run({
      matchId: "m1",
      candidates,
      richContext: "ctx",
      spec: "s",
      backendOverride: { backend: "anthropic", model: "claude-opus-4-8" },
    });
    const raw = JSON.parse(
      readFileSync(join(dir, "m1", "analysis-v2.zh.json"), "utf-8"),
    );
    expect(raw.schemaVersion).toBe(2);
    // Two slots: the settings default key (where the v1 migration lands) + the
    // override key (this new analysis)
    expect(Object.keys(raw.slots).sort()).toEqual([
      "anthropic:claude-opus-4-8",
      "anthropic:claude-opus-5",
    ]);
    expect(raw.lastSlotKey).toBe("anthropic:claude-opus-4-8");
    expect(
      raw.slots["anthropic:claude-opus-5"].result.findings[0].title,
    ).toBe("v1旧分析"); // not overwritten
    expect(
      raw.slots["anthropic:claude-opus-4-8"].result.findings[0].title,
    ).toBe("Death(claude-opus-4-8)");
    expect((await s.getCached("m1"))!.findings[0]!.title).toBe(
      "Death(claude-opus-4-8)",
    );
    expect(
      (await s.getCached("m1", "anthropic:claude-opus-5"))!.findings[0]!
        .title,
    ).toBe("v1旧分析");
  });

  it("deepen 写进 lastSlotKey 槽,不碰其他槽", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-deepen-"));
    const { s } = multiModelSvc(dir);
    await s.run({ matchId: "m1", candidates, richContext: "ctx", spec: "s" });
    await s.run({
      matchId: "m1",
      candidates,
      richContext: "ctx",
      spec: "s",
      backendOverride: { backend: "anthropic", model: "claude-opus-4-8" },
    }); // lastSlotKey → anthropic:claude-opus-4-8
    await s.deepen({
      matchId: "m1",
      findings: [
        {
          eventIds: ["death:a:30"],
          severity: "high",
          category: "survival",
          title: "深挖后",
          explanation: "x",
        },
      ] as never,
      packs: [], // empty packs → straight to writeMerged, no extra client shape needed
      spec: "s",
    });
    const active = await s.getCached("m1", "anthropic:claude-opus-4-8");
    const other = await s.getCached("m1", "anthropic:claude-opus-5");
    expect(active!.deepened).toBe(true);
    expect(active!.findings[0]!.title).toBe("深挖后");
    expect(other!.deepened).toBeFalsy(); // the other slot is untouched
    expect(other!.findings[0]!.title).toBe("Death(claude-opus-5)");
  });

  // Final review I-1: after an override round, the automatic deep dive used to
  // call the model with the *global default* backend/model from settings while
  // writing into the override slot — cross-model contamination that breaks slot
  // isolation (spec §1). This case fails before the fix (streamCalls records the
  // global default "claude-opus-5" instead of the override slot's
  // "claude-opus-4-8") and goes green after it.
  it("deepen 跟随 override 槽的 backend/model,不用全局默认(复核 I-1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-deepen-model-"));
    const { s, streamCalls } = multiModelSvc(dir);
    await s.run({ matchId: "m1", candidates, richContext: "ctx", spec: "s" });
    await s.run({
      matchId: "m1",
      candidates,
      richContext: "ctx",
      spec: "s",
      backendOverride: { backend: "anthropic", model: "claude-opus-4-8" },
    }); // lastSlotKey → anthropic:claude-opus-4-8
    streamCalls.length = 0; // only care which model this deepen call hits
    await s.deepen({
      matchId: "m1",
      findings: [
        {
          eventIds: ["death:a:30"],
          severity: "high",
          category: "survival",
          title: "深挖前",
          explanation: "x",
        },
      ] as never,
      packs: [
        {
          findingIndex: 0,
          anchorFrom: 100,
          anchorTo: 150,
          items: [
            {
              key: "p1",
              kind: "cc" as const,
              t: 128,
              label: "Fear → Healer",
              unitNames: ["Healer-R"],
              facts: { t: "128", spell: "Fear" },
            },
          ],
          facts: { "p1.t": "128", "p1.spell": "Fear" },
        },
      ] as never,
      spec: "s",
    });
    // The mock's payload is a RawFinding-shaped array (findingFor), not a
    // deep-dive-shaped one — deepen's audit sees an invalid-shape entry, 0
    // survivors, 1 drop, and (SDD 2026-08-06) fires the audit-repair retry
    // once, so this scenario always costs two stream calls now; both must
    // still carry the override slot's model, which is what this test guards.
    expect(streamCalls).toEqual([
      { model: "claude-opus-4-8" },
      { model: "claude-opus-4-8" },
    ]);
  });

  it("槽键 backend 段不是已知 AiBackend(如手改配置/v1 迁移占位符)→ 回退 settings 默认后端并 warn(复核 I-1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-deepen-unknown-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "analysis-v2.zh.json"),
      JSON.stringify({
        schemaVersion: 2,
        language: "zh",
        slots: {
          "totallyUnknown:whatever": {
            promptVersion: PROMPT_VERSION,
            createdAt: 1,
            result: {
              findings: [
                {
                  eventIds: ["death:a:30"],
                  severity: "high",
                  category: "survival",
                  title: "深挖前",
                  explanation: "x",
                },
              ],
              dropped: 0,
              hadNarration: true,
            },
          },
        },
        lastSlotKey: "totallyUnknown:whatever",
      }),
    );
    const streamCalls: Array<{ model: string }> = [];
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream(params: { model: string }) {
          streamCalls.push({ model: params.model });
          yield { delta: "[]" };
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await s.deepen({
      matchId: "m1",
      findings: [
        {
          eventIds: ["death:a:30"],
          severity: "high",
          category: "survival",
          title: "深挖前",
          explanation: "x",
        },
      ] as never,
      packs: [
        {
          findingIndex: 0,
          anchorFrom: 100,
          anchorTo: 150,
          items: [
            {
              key: "p1",
              kind: "cc" as const,
              t: 128,
              label: "Fear → Healer",
              unitNames: ["Healer-R"],
              facts: { t: "128", spell: "Fear" },
            },
          ],
          facts: { "p1.t": "128", "p1.spell": "Fear" },
        },
      ] as never,
      spec: "s",
    });
    expect(warnSpy).toHaveBeenCalled();
    // settings has no aiBackend/aiModels → defaults to anthropic:claude-opus-5
    expect(streamCalls).toEqual([{ model: "claude-opus-5" }]);
    warnSpy.mockRestore();
  });

  it("aggregate/notebook 在 v1 与 v2 文件混布下数字与改前一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-slot-agg-"));
    const f = (title: string, ev: string) => ({
      category: "survival",
      title,
      severity: "high",
      eventIds: [ev],
      explanation: "x",
    });
    // m1: old v1 single-result file (a match untouched by this change, read via lazy migration)
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "analysis-v2.zh.json"),
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: PROMPT_VERSION,
        language: "zh",
        createdAt: 100,
        result: { findings: [f("v1死", "e1")], dropped: 0, hadNarration: true },
      }),
    );
    // m2: new v2 single-slot file (a cross-backend slot, the shape produced after slotting landed)
    mkdirSync(join(dir, "m2"), { recursive: true });
    writeFileSync(
      join(dir, "m2", "analysis-v2.zh.json"),
      JSON.stringify({
        schemaVersion: 2,
        language: "zh",
        slots: {
          "deepseek:deepseek-chat": {
            promptVersion: PROMPT_VERSION,
            createdAt: 200,
            result: {
              findings: [f("v2死", "e2")],
              dropped: 0,
              hadNarration: true,
            },
          },
        },
        lastSlotKey: "deepseek:deepseek-chat",
      }),
    );
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: null,
        wowDirectory: null,
        aiLanguage: "zh",
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const agg = await s.aggregate();
    const survival = agg.find((a) => a.category === "survival")!;
    expect(survival.count).toBe(2);
    expect(survival.recent.map((r) => r.title).sort()).toEqual([
      "v1死",
      "v2死",
    ]);
    const nb = await s.notebook();
    const nbSurv = nb.find((g) => g.category === "survival")!;
    expect(nbSurv.count).toBe(2);
    expect(nbSurv.entries.map((e) => e.title).sort()).toEqual(["v1死", "v2死"]);
  });
});

describe("getState 原子查询(周度复核 P2#5)", () => {
  const mk = async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    return createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-getstate-")),
      clientFactory: () => null as never,
      emit: () => {},
    });
  };

  it("未跑过 → {cached:null, running:false}(分槽摘要为空)", async () => {
    const s = await mk();
    expect(await s.getState("m1")).toEqual({
      cached: null,
      running: false,
      runningMeta: null,
      slots: [],
      activeKey: null,
    });
  });

  it("在跑但还没落盘 → {cached:null, running:true}(面板显示「分析中…」)", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    let release!: () => void;
    const inFlight = new Promise<void>((r) => (release = r));
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-getstate-run-")),
      clientFactory: () =>
        ({
          stream: () =>
            (async function* () {
              await inFlight;
              yield { delta: "[]" };
            })(),
        }) as never,
      emit: () => {},
    });
    const p = s.run({
      matchId: "m1",
      candidates: [{ id: "c1", type: "x", t: 1, unitNames: [], facts: {} }],
      richContext: "ctx",
      spec: "Frost Mage",
    } as never);
    const mid = await s.getState("m1");
    expect(mid).toEqual({
      cached: null,
      running: true,
      // 状态行数据源(2026-08-05):在跑时必须能拿到起点与实际后端/模型,
      // renderer 重挂载后靠它显示真实已耗时
      runningMeta: {
        since: expect.any(Number),
        backend: "anthropic",
        model: "claude-opus-5",
        retrying: false,
      },
      slots: [],
      activeKey: null,
    });
    release();
    await p;
  });

  it("跑完后 → cached 非空、running 已清(两次分开问时漏结果的那个缝)", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-getstate-done-")),
      clientFactory: () =>
        ({
          stream: () =>
            (async function* () {
              yield { delta: "[]" };
            })(),
        }) as never,
      emit: () => {},
    });
    await s.run({
      matchId: "m1",
      candidates: [{ id: "c1", type: "x", t: 1, unitNames: [], facts: {} }],
      richContext: "ctx",
      spec: "Frost Mage",
    } as never);
    const after = await s.getState("m1");
    expect(after.running).toBe(false);
    expect(after.cached).not.toBeNull(); // result is reachable, not stuck idle
  });
});

describe("代际条目回收(周度复核 P3#9)", () => {
  const mkSvc = async (gen: () => AsyncGenerator<{ delta: string }>) => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    return createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-reap-")),
      clientFactory: () => ({ stream: () => gen() }) as never,
      emit: () => {},
    });
  };
  const input = (matchId: string) =>
    ({
      matchId,
      candidates: [{ id: "c1", type: "x", t: 1, unitNames: [], facts: {} }],
      richContext: "ctx",
      spec: "Frost Mage",
    }) as never;

  it("跑完即回收,不随看过的场次线性增长", async () => {
    const s = await mkSvc(async function* () {
      yield { delta: "[]" };
    });
    for (const id of ["m1", "m2", "m3"]) await s.run(input(id));
    // All three finished → all three generation entries must be reaped
    // (observed through the getState side channel: everything back to initial state)
    for (const id of ["m1", "m2", "m3"])
      expect((await s.getState(id)).running).toBe(false);
    expect(s.__generationCount()).toBe(0);
  });

  it("deepen 收尾时不得回收同场在飞的 run —— 否则 run 把自己判成过期,分析凭空丢", async () => {
    // This is where the guard actually earns its keep: a deep dive is in flight →
    // the user clicks "AI analysis" → the new run takes over (generation ++, so
    // deepen immediately sees itself as stale and exits) → deepen's finally reaps
    // the generation entry. Without the "only reap when no run is in flight"
    // criterion, the new run's next isCurrent check reads undefined, decides it is
    // itself stale, aborts midway, and the cache is never written.
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    let releaseDeep!: () => void;
    const deepInFlight = new Promise<void>((r) => (releaseDeep = r));
    let releaseRun!: () => void;
    const runInFlight = new Promise<void>((r) => (releaseRun = r));
    let call = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k" }) as never,
      matchesDir: mkdtempSync(join(tmpdir(), "gl-reap-race-")),
      clientFactory: () =>
        ({
          stream: () => {
            const mine = ++call;
            return (async function* () {
              await (mine === 1 ? deepInFlight : runInFlight);
              yield { delta: "[]" };
            })();
          },
        }) as never,
      emit: () => {},
    });

    const deep = s.deepen({
      matchId: "m1",
      findings: [] as never,
      packs: [
        {
          findingIndex: 0,
          anchorFrom: 0,
          anchorTo: 10,
          items: [
            {
              key: "p1",
              kind: "cc" as const,
              t: 5,
              label: "x",
              unitNames: [],
              facts: { t: "5" },
            },
          ],
          facts: { "p1.t": "5" },
        },
      ] as never,
      spec: "Frost Mage",
    });
    const run = s.run(input("m1")); // new run takes over, deepen becomes stale
    releaseDeep();
    await deep; // deepen wraps up → finally → reapGeneration
    releaseRun();
    await run;
    // run was not wrongly aborted: the result made it to disk
    expect((await s.getState("m1")).cached).not.toBeNull();
  });

  it("在飞期间不回收 —— 回收了会让这一轮把自己判成过期而中途 abort", async () => {
    let release!: () => void;
    const inFlight = new Promise<void>((r) => (release = r));
    const s = await mkSvc(async function* () {
      await inFlight;
      yield { delta: "[]" };
    });
    const p = s.run(input("m1"));
    expect(s.__generationCount()).toBe(1); // in flight, must be kept
    release();
    await p;
    expect(s.__generationCount()).toBe(0); // reaped once it lands
    expect((await s.getState("m1")).cached).not.toBeNull(); // not wrongly aborted
  });
});

/**
 * Regression on the *shape* of real model output.
 *
 * Production bug (reproduced 2026-07-20): for the findings prompt, `claude -p`
 * returns fully valid content wrapped in a ```json … ``` fence, while the main
 * side did a zero-tolerance JSON.parse(raw.trim()) — so a perfectly good
 * analysis was ruled bad-json and fell back to the deterministic view.
 *
 * The old tests only fed "not json at all" and asserted the fallback fired —
 * that verifies the fallback mechanism itself and encodes "strict parsing" as
 * correct behavior, so it can never catch this class of false kill. What is
 * added here is the opposite assertion: real output that *should* be accepted
 * must survive.
 */
describe("模型输出形态容错(bad-json 误杀回归)", () => {
  const good = [
    {
      eventIds: ["death:a:30"],
      severity: "high",
      category: "survival",
      title: "阵亡",
      explanation: "你在 {{t}}s 倒下,考虑早一拍交减伤。",
    },
  ];
  const body = JSON.stringify(good, null, 2);

  const runWith = async (raw: string) => {
    const { s, emitted } = svc(raw);
    await s.run(input);
    return emitted.find((e) => e.ch === "gladlog:analysis:done")!.p.result;
  };

  it("```json 围栏(claude -p 实测形态)不该被判 bad-json", async () => {
    const r = await runWith("```json\n" + body + "\n```");
    expect(r.fallbackReason).toBeUndefined();
    expect(r.hadNarration).toBe(true);
    expect(r.findings).toHaveLength(1);
  });

  it("裸 ``` 围栏(无语言标注)同样要吃下", async () => {
    const r = await runWith("```\n" + body + "\n```");
    expect(r.fallbackReason).toBeUndefined();
    expect(r.findings).toHaveLength(1);
  });

  it("围栏外还有前后散文(system prompt 要求中文回复时常见)", async () => {
    const r = await runWith(
      "好的,以下是本场的教练要点:\n\n```json\n" +
        body +
        "\n```\n\n希望有帮助。",
    );
    expect(r.fallbackReason).toBeUndefined();
    expect(r.findings).toHaveLength(1);
  });

  it("真正的垃圾仍要回退 —— 容错不能把 bad-json 兜没了", async () => {
    expect((await runWith("not json at all")).fallbackReason).toBe("bad-json");
    expect((await runWith("")).fallbackReason).toBe("bad-json");
    // Truncated array: if it can't be recovered, fall back honestly — never emit half a result
    expect(
      (await runWith('```json\n[{"eventIds":["death:a:30"],"sev'))
        .fallbackReason,
    ).toBe("bad-json");
  });

  it("顶层是对象(非数组)仍判 bad-json —— 契约是数组", async () => {
    expect(
      (await runWith('```json\n{"findings":[]}\n```')).fallbackReason,
    ).toBe("bad-json");
  });
});

describe("analyzeWindow(#16 选段分析)", () => {
  const PACK = {
    findingIndex: 0,
    anchorFrom: 30,
    anchorTo: 60,
    items: [
      {
        key: "p1",
        kind: "cc" as const,
        t: 40,
        label: "Fear → O",
        unitNames: ["O-R"],
        facts: {
          t: "40",
          spell: "Fear",
          duration: "4.0",
          trinket: "available_unused",
        },
      },
    ],
    facts: {
      "p1.t": "40",
      "p1.spell": "Fear",
      "p1.duration": "4.0",
      "p1.trinket": "available_unused",
    },
  };
  const GOOD = JSON.stringify([
    {
      findingIndex: 0,
      title: "控制窗口",
      deepDive:
        "At {{p1.t}}s the {{p1.spell}} landed with trinket {{p1.trinket}}; trinket that stun.",
      citedKeys: ["p1"],
    },
  ]);
  const input = (_dir: string) => ({
    matchId: "m1",
    fromS: 30,
    toS: 60,
    pack: PACK as never,
    kind: "survival" as const,
    spec: "Holy Paladin",
    ownerName: "O-Realm",
  });

  it("正常链路:LLM → 审计 → ok + 落盘;二次调用命中缓存不再调 client", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: GOOD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r1 = await s.analyzeWindow(input(dir));
    expect(r1.status).toBe("ok");
    if (r1.status === "ok") {
      expect(r1.entries).toHaveLength(1);
      expect(r1.entries[0]!.title).toBe("控制窗口");
      expect(r1.entries[0]!.text).toContain("At 40s");
      expect(r1.fromCache).toBe(false);
    }
    expect(
      JSON.parse(
        readFileSync(join(dir, "m1", "windowAnalysis.zh.json"), "utf-8"),
      )["anthropic:claude-opus-5:30-60"].entries[0].text,
    ).toContain("At 40s");
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("ok");
    if (r2.status === "ok") {
      expect(r2.fromCache).toBe(true);
      expect(r2.entries).toEqual(r1.status === "ok" ? r1.entries : undefined);
    }
    expect(calls).toBe(1);
  });

  it("window-multi-finding Task 2:模型一次返回 2 条(同 findingIndex)→ entries 长度 2,各自 title/text 落盘;二次调用命中缓存返回同 entries(非仅首条)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-multi-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const MULTI = JSON.stringify([
      {
        findingIndex: 0,
        title: "控制窗口",
        deepDive:
          "At {{p1.t}}s the {{p1.spell}} landed with trinket {{p1.trinket}}; trinket that stun.",
        citedKeys: ["p1"],
      },
      {
        findingIndex: 0,
        title: "二次判断",
        deepDive:
          "The {{p1.spell}} at {{p1.t}}s could have been trinketed sooner.",
        citedKeys: ["p1"],
      },
    ]);
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: MULTI };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r1 = await s.analyzeWindow(input(dir));
    expect(r1.status).toBe("ok");
    if (r1.status === "ok") {
      expect(r1.entries).toHaveLength(2);
      expect(r1.entries.map((e) => e.title)).toEqual(["控制窗口", "二次判断"]);
      expect(r1.entries[0]!.text).toContain("At 40s");
      expect(r1.entries[1]!.text).toContain("could have been trinketed");
      expect(r1.fromCache).toBe(false);
    }
    const onDisk = JSON.parse(
      readFileSync(join(dir, "m1", "windowAnalysis.zh.json"), "utf-8"),
    )["anthropic:claude-opus-5:30-60"];
    expect(onDisk.entries).toHaveLength(2);
    expect(onDisk.entries.map((e: { title: string }) => e.title)).toEqual([
      "控制窗口",
      "二次判断",
    ]);

    // Second call: cache hit must replay both entries, not just the first.
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("ok");
    if (r2.status === "ok") {
      expect(r2.fromCache).toBe(true);
      expect(r2.entries).toHaveLength(2);
      expect(r2.entries.map((e) => e.title)).toEqual(["控制窗口", "二次判断"]);
    }
    expect(calls).toBe(1); // cache hit: no second model call
  });

  it("#21 item11(红→绿):审计全丢 → audit-empty 且缓存诚实空终态;二次调用命中缓存不再调 client", async () => {
    // The client emits an entry with bare digits ("died at 40s", no placeholders)
    // → auditDeepDives drops all of them (bare-digit ban, mirroring the
    // first-round discipline).
    const dir = mkdtempSync(join(tmpdir(), "gl-win-audit-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const BAD = JSON.stringify([
      {
        findingIndex: 0,
        deepDive: "The player died at 40s with no trinket up.",
        citedKeys: ["p1"],
      },
    ]);
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: BAD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r1 = await s.analyzeWindow(input(dir));
    expect(r1.status).toBe("audit-empty");
    // Before the fix: existsSync(...) was false here (nothing written) — now the
    // honest empty terminal state is persisted too, under the same windowKey
    // (including backend:model, the same predicate as the success path).
    const cachePath = join(dir, "m1", "windowAnalysis.zh.json");
    expect(existsSync(cachePath)).toBe(true);
    const cached = JSON.parse(readFileSync(cachePath, "utf-8"))[
      "anthropic:claude-opus-5:30-60"
    ];
    expect(cached).toMatchObject({ status: "empty" });
    expect(cached.entries).toBeUndefined(); // an empty terminal state must not carry a "fake" entries list
    // SDD 2026-08-06: 0 survivors + 1 drop (bare-digit) fires the audit-repair
    // retry once — the mock always replies with the same BAD text, so the
    // repair call fails the same gate and `found` stays empty, but it still
    // costs a second stream call before the round settles on audit-empty.
    expect(calls).toBe(2);

    // Second call hits the cache: no model call, just replay the same audit-empty shape.
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("audit-empty");
    expect(calls).toBe(2);
  });

  it("#21 item11 复核轮修复(红→绿):force=true 绕开缓存的 audit-empty 命中,重新打模型;不传 force 仍命中缓存", async () => {
    // Product-semantics bug caught by the batch review: an explicit retry (the
    // "retry" button on WindowAnalysisCard) used to be swallowed by the honest
    // empty-terminal-state cache, so a new answer was unreachable forever.
    // force=true must make the cache read behave as a miss while still writing
    // back over the same windowKey.
    const dir = mkdtempSync(join(tmpdir(), "gl-win-force-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const BAD = JSON.stringify([
      {
        findingIndex: 0,
        deepDive: "The player died at 40s with no trinket up.",
        citedKeys: ["p1"],
      },
    ]);
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: BAD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r1 = await s.analyzeWindow(input(dir));
    expect(r1.status).toBe("audit-empty");
    // SDD 2026-08-06: the all-wipeout audit-repair retry fires once per round
    // now (0 survivors + 1 bare-digit drop), so a round that used to cost one
    // stream call costs two — the mock's BAD text is fixed, so the repair
    // call fails the same gate and the round still lands on audit-empty.
    expect(calls).toBe(2);

    // Without force: cache hit, no model call (existing behavior, regression guard).
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("audit-empty");
    expect(calls).toBe(2);

    // Before the fix (red): calls is still 1 here — the force field did not exist
    // / had no effect, and the cache hit short-circuited before the model call.
    // After the fix (green): force=true bypasses the cache read, calls 2→4
    // (fresh round + its own audit-repair retry).
    const r3 = await s.analyzeWindow({ ...input(dir), force: true });
    expect(r3.status).toBe("audit-empty");
    expect(calls).toBe(4);

    // After the forced write-back it is still the "empty" terminal state under the
    // same windowKey (overwrite, not a second entry piled on) — later calls
    // without force hit this freshly written cache as usual.
    const cachePath = join(dir, "m1", "windowAnalysis.zh.json");
    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(Object.keys(cache)).toEqual(["anthropic:claude-opus-5:30-60"]);
    expect(cache["anthropic:claude-opus-5:30-60"]).toMatchObject({
      status: "empty",
    });
    const r4 = await s.analyzeWindow(input(dir));
    expect(r4.status).toBe("audit-empty");
    expect(calls).toBe(4); // no additional model call
  });

  it("无 client → no-client,不写缓存", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-noclient-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: null, wowDirectory: null }),
      matchesDir: dir,
      emit: () => {},
    });
    const r = await s.analyzeWindow(input(dir));
    expect(r.status).toBe("no-client");
    expect(existsSync(join(dir, "m1", "windowAnalysis.zh.json"))).toBe(false);
  });

  it("LRU:第 21 个窗口写入后最旧 at 的条目被驱逐,文件恰 20 条", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-lru-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    // Use a controllable counter instead of the real wall clock: a real Date.now()
    // can land on the same millisecond inside a tight loop, in which case the LRU
    // ordering (ascending by `at`) silently falls back to Object.keys insertion
    // order instead of actually verifying the "evict the oldest by time" predicate.
    let now = 1000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now++);
    try {
      const s = createAnalysisService({
        getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
        clientFactory: () => ({
          stream: () =>
            (async function* () {
              yield { delta: GOOD };
            })(),
        }),
        matchesDir: dir,
        emit: () => {},
      });
      for (let i = 0; i < 21; i++) {
        const r = await s.analyzeWindow({
          matchId: "m1",
          fromS: i * 100,
          toS: i * 100 + 30,
          pack: PACK as never,
          kind: "survival",
          spec: "Holy Paladin",
        });
        expect(r.status).toBe("ok");
      }
      const cache = JSON.parse(
        readFileSync(join(dir, "m1", "windowAnalysis.zh.json"), "utf-8"),
      );
      const keys = Object.keys(cache);
      expect(keys).toHaveLength(20);
      expect(cache["anthropic:claude-opus-5:0-30"]).toBeUndefined(); // oldest (the 1st) evicted
      expect(cache["anthropic:claude-opus-5:2000-2030"]).toBeDefined(); // newest (the 21st) present
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("幂等:同场同窗口在飞时第二次调用立即返回 busy,不叠加 client 调用", async () => {
    // The client stream hangs on a never-resolving promise; call analyzeWindow twice concurrently
    const dir = mkdtempSync(join(tmpdir(), "gl-win-busy-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let calls = 0;
    const never = new Promise<void>(() => {
      /* never resolves: simulates still in flight */
    });
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            await never;
            yield { delta: GOOD }; // never reached
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const p1 = s.analyzeWindow(input(dir)); // left dangling: this case never awaits it
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("busy");
    await vi.waitFor(() => expect(calls).toBe(1)); // the first round really entered stream()
    expect(calls).toBe(1); // no second model call
    void p1;
  });

  it("跨窗口并发:两个不同 windowKey 同场并发分析,先完成的一方不被后完成的一方覆盖(lost-update 修复)", async () => {
    // The idempotency guard only serializes the *same* window via
    // `${matchId}:${windowKey}`; different windows of the same match still race
    // each other all the way to the disk write. If both stringify and write back
    // the stale snapshot they read at function entry, the later write silently
    // erases the earlier entry. The fix is to re-read the newest file right before
    // writing and upsert only your own key onto that newest snapshot — here two
    // manually released gates simulate the "A finishes and writes first, B
    // finishes second" ordering, asserting A's entry survives B's write.
    const dir = mkdtempSync(join(tmpdir(), "gl-win-race-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const gateB = new Promise<void>((r) => (releaseB = r));
    let call = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          const mine = ++call; // 1 = the earlier call (A), 2 = the later call (B)
          return (async function* () {
            await (mine === 1 ? gateA : gateB);
            yield { delta: GOOD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const pA = s.analyzeWindow({
      matchId: "m1",
      fromS: 30,
      toS: 60,
      pack: PACK as never,
      kind: "survival",
      spec: "Holy Paladin",
    });
    const pB = s.analyzeWindow({
      matchId: "m1",
      fromS: 200,
      toS: 230,
      pack: PACK as never,
      kind: "survival",
      spec: "Holy Paladin",
    });
    releaseA();
    const rA = await pA; // A finishes and writes first
    expect(rA.status).toBe("ok");
    releaseB();
    const rB = await pB; // B finishes and writes second
    expect(rB.status).toBe("ok");
    const cache = JSON.parse(
      readFileSync(join(dir, "m1", "windowAnalysis.zh.json"), "utf-8"),
    );
    // Both entries present: B's write-back did not clobber the one A wrote first
    expect(Object.keys(cache).sort()).toEqual([
      "anthropic:claude-opus-5:200-230",
      "anthropic:claude-opus-5:30-60",
    ]);
  });

  it("client.stream() 抛异常 → error(可重试),不落盘;随后同窗口再调用锁已释放(不是 busy)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-err-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let attempt = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          attempt++;
          if (attempt === 1) throw new Error("network boom"); // thrown synchronously: client.stream() itself fails
          return (async function* () {
            yield { delta: GOOD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r1 = await s.analyzeWindow(input(dir));
    expect(r1.status).toBe("error");
    expect(existsSync(join(dir, "m1", "windowAnalysis.zh.json"))).toBe(false);
    // The lock was released: an immediate re-call on the same window is not busy
    // and completes normally (instead of being stuck at busy)
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("ok");
  });

  // Regressions for the Important audit fixes (three): version stamp /
  // backend+model predicate / 0.1s key precision.
  it("版本戳:旧版本条目(promptVersion 不匹配)判 miss,重新调用 client 并用新版本戳覆盖落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-ver-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const path = join(dir, "m1", "windowAnalysis.zh.json");
    const key = "anthropic:claude-opus-5:30-60";
    writeFileSync(
      path,
      JSON.stringify({
        [key]: {
          fromS: 30,
          toS: 60,
          text: "STALE ANSWER FROM OLD PROMPT VERSION",
          chips: [],
          at: 1,
          promptVersion: PROMPT_VERSION - 1,
        },
      }),
      "utf-8",
    );
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: GOOD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r = await s.analyzeWindow(input(dir));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.fromCache).toBe(false); // version mismatch → miss, not a hit on the stale answer
      expect(r.entries[0]!.text).toContain("At 40s");
    }
    expect(calls).toBe(1); // the client really was called, not the stale entry reused
    const stamped = JSON.parse(readFileSync(path, "utf-8"))[key];
    expect(stamped.promptVersion).toBe(PROMPT_VERSION); // overwritten on disk with the current version
    expect(stamped.entries[0].text).toContain("At 40s");
  });

  it("模型切换:同后端换模型(判据 backend:model 的 model 段)→ miss,新旧两条各自独立命中,互不覆盖", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-model-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let calls = 0;
    let aiModels: Record<string, string> | undefined;
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        aiModels: aiModels as never,
      }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: GOOD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r1 = await s.analyzeWindow(input(dir)); // default model claude-opus-5
    expect(r1.status).toBe("ok");
    if (r1.status === "ok") expect(r1.fromCache).toBe(false);
    expect(calls).toBe(1);

    aiModels = { anthropic: "claude-opus-4-8" }; // different model, same backend and window
    const r2 = await s.analyzeWindow(input(dir));
    expect(r2.status).toBe("ok");
    if (r2.status === "ok") expect(r2.fromCache).toBe(false); // not a hit on the old model's answer
    expect(calls).toBe(2); // the client really was called a second time

    const cache = JSON.parse(
      readFileSync(join(dir, "m1", "windowAnalysis.zh.json"), "utf-8"),
    );
    expect(Object.keys(cache).sort()).toEqual([
      "anthropic:claude-opus-4-8:30-60",
      "anthropic:claude-opus-5:30-60",
    ]);

    // Switch back to the old model → hits that model's cache entry, no client call
    aiModels = undefined;
    const r3 = await s.analyzeWindow(input(dir));
    expect(r3.status).toBe("ok");
    if (r3.status === "ok") expect(r3.fromCache).toBe(true);
    expect(calls).toBe(2);
  });

  it("0.1s 精度:相差 0.7s 的两次拖拽(30.1s vs 30.8s)落成两条独立缓存,不互相顶掉", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-precision-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          calls++;
          return (async function* () {
            yield { delta: GOOD };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const mk = (fromS: number) => ({
      matchId: "m1",
      fromS,
      toS: 60,
      pack: PACK as never,
      kind: "survival" as const,
      spec: "Holy Paladin",
    });
    const r1 = await s.analyzeWindow(mk(30.1));
    expect(r1.status).toBe("ok");
    const r2 = await s.analyzeWindow(mk(30.8));
    expect(r2.status).toBe("ok");
    if (r2.status === "ok") expect(r2.fromCache).toBe(false); // different window, must not hit
    expect(calls).toBe(2);
    const cache = JSON.parse(
      readFileSync(join(dir, "m1", "windowAnalysis.zh.json"), "utf-8"),
    );
    expect(Object.keys(cache).sort()).toEqual([
      "anthropic:claude-opus-5:30.1-60",
      "anthropic:claude-opus-5:30.8-60",
    ]);
    // Requesting the very same window at 0.1s precision still hits
    const r3 = await s.analyzeWindow(mk(30.1));
    if (r3.status === "ok") expect(r3.fromCache).toBe(true);
    expect(calls).toBe(2);
  });

});

describe("analyzeWindow 审计全灭反馈重试(SDD 2026-08-06)", () => {
  const PACK = {
    findingIndex: 0,
    anchorFrom: 30,
    anchorTo: 60,
    items: [
      {
        key: "p1",
        kind: "cc" as const,
        t: 40,
        label: "Fear → O",
        unitNames: ["O-R"],
        facts: {
          t: "40",
          spell: "Fear",
          duration: "4.0",
          trinket: "available_unused",
        },
      },
    ],
    facts: {
      "p1.t": "40",
      "p1.spell": "Fear",
      "p1.duration": "4.0",
      "p1.trinket": "available_unused",
    },
  };
  const input = (matchId = "m1") => ({
    matchId,
    fromS: 30,
    toS: 60,
    pack: PACK as never,
    kind: "survival" as const,
    spec: "Holy Paladin",
    ownerName: "O-Realm",
  });
  // window mode also requires `title`; missing/bare-digit deepDive text is
  // enough on its own to fail the bare-digit gate regardless.
  const BAD = JSON.stringify([
    {
      findingIndex: 0,
      deepDive: "The player died at 40s with no trinket up.",
      citedKeys: ["p1"],
    },
  ]);
  const GOOD = JSON.stringify([
    {
      findingIndex: 0,
      title: "控制窗口",
      deepDive:
        "At {{p1.t}}s the {{p1.spell}} landed with trinket {{p1.trinket}}; trinket that stun.",
      citedKeys: ["p1"],
    },
  ]);
  // Still fails after "repair": missing title (window mode's bare-digit-title
  // gate) — proves the retry loop terminates even when the model refuses to
  // fix the actual violation.
  const BAD2 = JSON.stringify([
    {
      findingIndex: 0,
      deepDive: "At {{p1.t}}s the {{p1.spell}} landed. Trinket it.",
      citedKeys: ["p1"],
    },
  ]);

  function svc(dir: string, responses: string[]) {
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          const resp = responses[calls] ?? responses[responses.length - 1]!;
          calls++;
          return (async function* () {
            yield { delta: resp };
          })();
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    return { s, calls: () => calls };
  }

  it("首响应全灭(裸数字)→ 修复响应合规 → ok 且 recordAiDebug 出现 #audit-repair", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-repair-ok-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const { s } = svc(dir, [BAD, GOOD]);
    const r = await s.analyzeWindow(input("m-win-repair-ok"));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.title).toBe("控制窗口");
      expect(r.entries[0]!.text).toContain("At 40s");
    }
    expect(
      listAiDebug().some((e) => e.matchId === "m-win-repair-ok#audit-repair"),
    ).toBe(true);
  });

  it("首响应已有存活 → 不触发修复重试(只调一次模型)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-repair-noneed-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const { s, calls } = svc(dir, [GOOD]);
    const r = await s.analyzeWindow(input("m-win-repair-noneed"));
    expect(r.status).toBe("ok");
    expect(calls()).toBe(1);
  });

  it("修复响应仍违规(仍缺 title)→ 维持空结果,不再发起第三次调用", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-repair-stillbad-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    const { s, calls } = svc(dir, [BAD, BAD2]);
    const r = await s.analyzeWindow(input("m-win-repair-stillbad"));
    expect(r.status).toBe("audit-empty");
    expect(calls()).toBe(2); // first attempt + one repair retry, never a third call
  });

  it("修复调用抛错 → 静默维持空结果(不是 error 状态)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-win-repair-throws-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    let n = 0;
    const s = createAnalysisService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        stream: () => {
          n++;
          if (n === 1)
            return (async function* () {
              yield { delta: BAD };
            })();
          throw new Error("repair call boom");
        },
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const r = await s.analyzeWindow(input("m-win-repair-throws"));
    // A repair-call throw must land on audit-empty (the first round's honest
    // outcome), never "error" -- "error" means the ROUND never answered at
    // all, but here the first call did, it just failed the audit.
    expect(r.status).toBe("audit-empty");
    expect(n).toBe(2);
  });
});
