import type { RulesDoc } from "@gladlog/analysis/src/learning/types";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import type { AnthropicLike } from "./ai";
import { createLearningService } from "./learning";

/** Build a matches directory: n matches, where the even-numbered ones carry an
 * analysis cache containing a survival finding. */
function seedMatches(root: string, n: number): string {
  const matchesDir = join(root, "matches");
  for (let i = 0; i < n; i++) {
    const dir = join(matchesDir, `m${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        id: `m${i}`,
        startTime: 1_000_000 + i * 60_000,
        result: i % 3 === 0 ? "win" : "loss",
        zoneId: "1552",
        bracket: "3v3",
        teams: [[], [{ specId: 62, classId: 8 }]],
      }),
    );
    writeFileSync(
      join(dir, "analysis-v2.zh.json"),
      JSON.stringify({
        schemaVersion: 1,
        // deliberately an old version: backfill must ignore promptVersion
        promptVersion: 7,
        language: "zh",
        createdAt: 1_000_000 + i * 60_000,
        result: {
          findings:
            i % 2 === 0
              ? [
                  {
                    eventIds: ["e1"],
                    severity: "high",
                    category: "survival",
                    title: "t",
                    explanation: "死于集火时没开减伤。",
                  },
                ]
              : [],
          dropped: 0,
          hadNarration: true,
        },
      }),
    );
  }
  return matchesDir;
}

const fakeClient = (raw: string): AnthropicLike => ({
  async *stream() {
    yield { delta: raw };
  },
});

const flush = () => new Promise((r) => setTimeout(r, 50));

function mkService(root: string, raw: string) {
  const events: Array<{ ch: string; payload: unknown }> = [];
  const svc = createLearningService({
    getSettings: () => ({
      anthropicApiKey: "k",
      aiModels: null,
      wowDirectory: null,
      aiLanguage: "zh" as const,
    }),
    clientFactory: () => fakeClient(raw),
    matchesDir: join(root, "matches"),
    learningDir: join(root, "learning"),
    emit: (ch, payload) => events.push({ ch, payload }),
  });
  return { svc, events };
}

describe("learning 服务", () => {
  it("回填:全部旧 promptVersion 场也进台账;完成写标记 + 首次整合", async () => {
    const root = mkdtempSync(join(tmpdir(), "gl-learn-"));
    seedMatches(root, 20);
    const good = JSON.stringify([
      {
        patternId: "cat:survival",
        description: "近 {{windowMatches}} 场里 {{hits}} 场有生存问题。",
        advice: "留意减伤时机。",
      },
    ]);
    const { svc } = mkService(root, good);
    svc.init();
    // Backfill and the first consolidation are both async; poll the state
    for (let i = 0; i < 100; i++) {
      await flush();
      const st = await svc.getState();
      if (!st.backfill?.running && !st.consolidating) break;
    }
    const st = await svc.getState();
    expect(st.ledgerMatches).toBe(20);
    const doc = (await svc.getRules()) as RulesDoc;
    expect(doc).not.toBeNull();
    // 10 of 20 matches hit survival (the even ones), so an active rule must be
    // produced
    const r = doc.rules.find((x) => x.ruleId === "cat:survival");
    expect(r?.status).toBe("active");
    expect(r?.stats.hits).toBe(10);
    expect(r?.description.zh).toContain("{{hits}}");
  });

  it("提炼输出裸数字 → 审计丢弃,规则仍在但无文本;stats 照常落盘", async () => {
    const root = mkdtempSync(join(tmpdir(), "gl-learn2-"));
    seedMatches(root, 20);
    const bad = JSON.stringify([
      { patternId: "cat:survival", description: "近 20 场 10 次", advice: "x" },
    ]);
    const { svc } = mkService(root, bad);
    svc.init();
    for (let i = 0; i < 100; i++) {
      await flush();
      const st = await svc.getState();
      if (!st.backfill?.running && !st.consolidating) break;
    }
    const doc = (await svc.getRules()) as RulesDoc;
    const r = doc.rules.find((x) => x.ruleId === "cat:survival")!;
    expect(r.stats.hits).toBe(10);
    expect(r.description.zh).toBeUndefined();
  });

  it("recordAnalysis:append 台账并带候选 type;自动整合按增量 10 场触发", async () => {
    const root = mkdtempSync(join(tmpdir(), "gl-learn3-"));
    const _matchesDir = seedMatches(root, 1);
    const { svc } = mkService(root, "[]");
    // Drop the backfill marker in by hand to skip the backfill path
    mkdirSync(join(root, "learning"), { recursive: true });
    writeFileSync(
      join(root, "learning", "backfill-done.json"),
      JSON.stringify({ at: 1, scanned: 0 }),
    );
    svc.init();
    svc.recordAnalysis({
      matchId: "m0",
      findings: [
        {
          eventIds: ["e1"],
          severity: "high",
          category: "survival",
          title: "t",
          explanation: "x",
        },
      ],
      candidates: [
        { id: "e1", type: "death", t: 30, unitNames: ["A"], facts: {} },
      ],
    });
    await flush();
    const ledger = readFileSync(
      join(root, "learning", "ledger.ndjson"),
      "utf-8",
    );
    expect(ledger).toContain('"eventTypes":["death"]');
    expect(ledger).toContain('"enemySpecs":[62]');
  });

  it("AI 提炼抛错(401/429/超时同类):确定性 stats/status 仍落盘,done 事件带 distillError", async () => {
    const root = mkdtempSync(join(tmpdir(), "gl-learn4-"));
    seedMatches(root, 20);
    const throwingClient: AnthropicLike = {
      stream() {
        throw new Error("simulated 429 rate limit");
      },
    };
    const events: Array<{ ch: string; payload: unknown }> = [];
    const svc = createLearningService({
      getSettings: () => ({
        anthropicApiKey: "k",
        aiModels: null,
        wowDirectory: null,
        aiLanguage: "zh" as const,
      }),
      clientFactory: () => throwingClient,
      matchesDir: join(root, "matches"),
      learningDir: join(root, "learning"),
      emit: (ch, payload) => events.push({ ch, payload }),
    });
    svc.init();
    for (let i = 0; i < 100; i++) {
      await flush();
      const st = await svc.getState();
      if (!st.backfill?.running && !st.consolidating) break;
    }
    const doc = (await svc.getRules()) as RulesDoc;
    expect(doc).not.toBeNull();
    const r = doc.rules.find((x) => x.ruleId === "cat:survival");
    expect(r?.stats.hits).toBe(10);
    expect(r?.status).toBe("active");
    expect(r?.description.zh).toBeUndefined();
    const done = events.find((e) => e.ch === "gladlog:learning:done");
    expect(done).toBeDefined();
    expect((done?.payload as { distillError?: string }).distillError).toContain(
      "simulated 429",
    );
  });

  it("既有 improved 规则缺文本也补(死角回归):曾限定 status==='active' 会让提炼失败后频次降回 improved 的规则永远拿不到文本", async () => {
    const root = mkdtempSync(join(tmpdir(), "gl-learn5-"));
    mkdirSync(join(root, "matches"), { recursive: true });
    mkdirSync(join(root, "learning"), { recursive: true });
    writeFileSync(
      join(root, "learning", "backfill-done.json"),
      JSON.stringify({ at: 1, scanned: 0 }),
    );
    // A 20-match ledger where only 1 match hits survival → hits=1
    // (<= RULE_RETIRE_MAX_HITS=2), so nextRuleStatus decides on / keeps
    // `improved` — reproducing the "frequency dropped, demoted to improved"
    // scenario.
    const runs = Array.from({ length: 20 }, (_, i) => ({
      v: 1,
      matchId: `m${i}`,
      startTime: 1_000_000 + i * 60_000,
      win: true,
      enemySpecs: [],
      promptVersion: 1,
      createdAt: 1_000_000 + i * 60_000,
      findings:
        i === 0
          ? [{ category: "survival", severity: "high", eventTypes: [] }]
          : [],
    }));
    writeFileSync(
      join(root, "learning", "ledger.ndjson"),
      runs.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    // Pre-existing rule: status improved with no text — the blind spot before
    // the fix.
    writeFileSync(
      join(root, "learning", "rules.json"),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        ledgerMatches: 20,
        rules: [
          {
            ruleId: "cat:survival",
            status: "improved",
            category: "survival",
            eventTypes: [],
            condition: null,
            stats: {
              windowMatches: 20,
              hits: 1,
              firstSeen: 1,
              lastSeen: 1,
              trend: [],
            },
            description: {},
            advice: {},
            evidence: [],
            distilledAt: 0,
            distillModel: "",
          },
        ],
      }),
    );
    const good = JSON.stringify([
      {
        patternId: "cat:survival",
        description: "近 {{windowMatches}} 场里 {{hits}} 场有生存问题。",
        advice: "留意减伤时机。",
      },
    ]);
    const { svc } = mkService(root, good);
    await svc.consolidate();
    const doc = (await svc.getRules()) as RulesDoc;
    const r = doc.rules.find((x) => x.ruleId === "cat:survival")!;
    // hits=1 keeps it improved rather than active
    expect(r.status).toBe("improved");
    // blind-spot fix: improved rules get their text filled in too
    expect(r.description.zh).toContain("{{hits}}");
  });
});
