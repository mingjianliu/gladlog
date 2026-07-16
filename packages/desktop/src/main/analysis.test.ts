import type { CandidateEvent } from "@gladlog/analysis";
import { describe, expect, it } from "vitest";

import { PROMPT_VERSION } from "./ai";
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
      anthropicModel: "m",
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
  it("no API key → deterministic fallback, no error", async () => {
    const { s, emitted } = svc("unused", null);
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.hadNarration).toBe(false);
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
        anthropicModel: "m",
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

    // 同目录换英文:zh 缓存不可见(未命中),生成后写 en 键
    const en = langSvc("en", dir);
    expect(await en.s.getCached("m1")).toBeNull();
    await en.s.run(input);
    expect(en.captured[0]!.system).toContain("Respond in English");
    expect(en.captured[0]!.system).not.toContain("Simplified Chinese");
    expect(existsSync(join(dir, "m1", "analysis-v2.en.json"))).toBe(true);
    expect(await en.s.getCached("m1")).not.toBeNull();
    // zh 键仍在,切回 zh 直接命中
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
    const zhDefault = langSvc(undefined, dir); // 缺省 → zh
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
        anthropicModel: null,
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
    // m1:zh + en 双缓存(只应计一次);m2:仅 en;m1 有 recurring 标记
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
        anthropicModel: null,
        wowDirectory: null,
        aiLanguage: "zh",
      }),
      matchesDir: dir,
      emit: () => {},
    });
    const agg = await s.aggregate();
    const survival = agg.find((a) => a.category === "survival")!;
    // m1 取 zh 一份(1 条 survival)+ m2 en 兜底(1 条)= 2
    expect(survival.count).toBe(2);
    expect(survival.recurring).toBe(1);
    // recent 按 createdAt 降序,最新的是 m1(200),meta.json 的真实 id 生效
    expect(survival.recent[0]!.matchId).toBe("m1-real");
    expect(survival.recent[0]!.title).toBe("死亡A");
    expect(agg.find((a) => a.category === "cd")!.count).toBe(1);
  });
});
