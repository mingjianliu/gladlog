import { describe, expect, it } from "vitest";
import { createAnalysisService } from "./analysis";
import type { CandidateEvent } from "@gladlog/analysis";

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
        promptVersion: 3,
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
