import type { CandidateEvent } from "@gladlog/analysis";
import { SELF_REVIEW_PROMPT_VERSION } from "@gladlog/analysis/src/analysis/selfReview";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { analysisCachePath } from "../shared/analysisCache";
import { PROMPT_VERSION } from "./ai";
import { createAnalysisService } from "./analysis";

// AI 自查(用户 2026-10-15,设置项 aiSelfReview,默认关):开 / 关 / 失败回退 /
// 坏 JSON / 违约 / 超时 / 缓存身份 / 问教练会话。

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
  {
    id: "cd-waste:a:1",
    type: "cd-waste",
    t: 12,
    unitNames: ["Me-R"],
    facts: { spell: "Pain Suppression", unit: "Me-R" },
  },
];
const input = {
  matchId: "m1",
  candidates,
  richContext: "ctx",
  spec: "Discipline Priest",
};
const FIRST = JSON.stringify([
  {
    eventIds: ["death:a:30"],
    severity: "high",
    category: "survival",
    title: "Death",
    explanation: "You died at {{t}}s with nobody helping.",
  },
  {
    eventIds: ["cd-waste:a:1"],
    severity: "med",
    category: "cooldown",
    title: "Unused Pain Suppression",
    explanation: "Pain Suppression was never pressed.",
  },
]);
const reviewed = (over: Partial<Record<string, unknown>>[] = []) =>
  JSON.stringify({
    findings: [
      {
        eventIds: ["death:a:30"],
        severity: "high",
        category: "survival",
        title: "Death",
        explanation: "You died at 30s.",
        ...over[0],
      },
      {
        eventIds: ["cd-waste:a:1"],
        severity: "med",
        category: "cooldown",
        title: "Unused Pain Suppression",
        explanation: "Pain Suppression was never pressed.",
        ...over[1],
      },
    ],
    changes: [
      {
        finding: 1,
        action: "weakened",
        old: "with nobody helping",
        new: null,
      },
    ],
  });

type Step = { delta?: string; sessionId?: string } | "throw" | "hang";

function setup(
  replies: Step[][],
  opts: { selfReview?: boolean; dir?: string } = {},
) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "gladlog-sr-"));
  const settings = {
    anthropicApiKey: "k" as string | null,
    wowDirectory: null,
    aiSelfReview: opts.selfReview,
  };
  const prompts: string[] = [];
  const emitted: Array<{ ch: string; p: any }> = [];
  let call = 0;
  const s = createAnalysisService({
    getSettings: () => settings,
    clientFactory: () => ({
      async *stream(params) {
        prompts.push(params.messages[0]!.content);
        const steps = replies[call++] ?? [];
        for (const st of steps) {
          if (st === "throw") throw new Error("stream died");
          if (st === "hang") await new Promise(() => {});
          else yield st;
        }
      },
    }),
    matchesDir: dir,
    emit: (ch, p) => emitted.push({ ch, p }),
  });
  const done = () =>
    emitted.filter((e) => e.ch === "gladlog:analysis:done").at(-1)?.p.result;
  return { s, dir, settings, prompts, emitted, done };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AI 自查:开关", () => {
  it("关(默认):只调一次模型,结果不带 selfReview 字段", async () => {
    const t = setup([[{ delta: FIRST }]]);
    await t.s.run(input);
    expect(t.prompts).toHaveLength(1);
    expect(t.done().selfReview).toBeUndefined();
    expect(t.done().findings[0].explanation).toBe(
      "You died at 30s with nobody helping.",
    );
    expect(
      t.emitted.find((e) => e.ch === "gladlog:analysis:reviewing"),
    ).toBeUndefined();
  });

  it("开:第二次调用带自查说明 + 首轮 prompt + 首轮(已填数字的)结论;显示自查版,原版与改动日志入缓存", async () => {
    const t = setup([[{ delta: FIRST }], [{ delta: reviewed() }]], {
      selfReview: true,
    });
    await t.s.run(input);
    expect(t.prompts).toHaveLength(2);
    const rp = t.prompts[1]!;
    expect(rp).toContain("Self-check of a coaching reply");
    expect(rp).toContain(t.prompts[0]!); // the first round's whole prompt
    expect(rp).toContain("You died at 30s with nobody helping."); // rendered text
    const r = t.done();
    expect(r.findings.map((f: any) => f.explanation)).toEqual([
      "You died at 30s.",
      "Pain Suppression was never pressed.",
    ]);
    expect(r.selfReview).toMatchObject({
      version: SELF_REVIEW_PROMPT_VERSION,
      status: "reviewed",
      changes: [{ finding: 1, action: "weakened" }],
    });
    expect(r.selfReview.original[0].explanation).toBe(
      "You died at 30s with nobody helping.",
    );
    expect(
      t.emitted.filter((e) => e.ch === "gladlog:analysis:reviewing"),
    ).toEqual([{ ch: "gladlog:analysis:reviewing", p: { matchId: "m1" } }]);
    expect(await t.s.getCached("m1")).toMatchObject({
      selfReview: { status: "reviewed" },
    });
  });

  it("自查进行中 getState 的 runningMeta.reviewing=true(重挂载的面板也知道在自查)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        aiSelfReview: true,
      }),
      clientFactory: () => ({
        async *stream() {
          calls++;
          if (calls === 1) {
            yield { delta: FIRST };
            return;
          }
          await gate;
          yield { delta: reviewed() };
        },
      }),
      matchesDir: mkdtempSync(join(tmpdir(), "gladlog-sr-")),
      emit: () => {},
    });
    const p = s.run(input);
    await vi.waitFor(() => expect(calls).toBe(2));
    expect((await s.getState("m1")).runningMeta?.reviewing).toBe(true);
    release();
    await p;
    expect((await s.getState("m1")).runningMeta).toBeNull();
  });

  it("开 + 空回复 / 确定性回退:不调自查,记 skipped", async () => {
    const t = setup([[{ delta: "[]" }]], { selfReview: true });
    await t.s.run(input);
    expect(t.prompts).toHaveLength(1);
    expect(t.done().selfReview).toEqual({
      version: SELF_REVIEW_PROMPT_VERSION,
      status: "skipped",
    });
    const fb = setup([], { selfReview: true });
    await fb.s.run({ ...input, candidates: [] });
    expect(fb.done().fallbackReason).toBe("no-candidates");
    expect(fb.done().selfReview.status).toBe("skipped");
  });
});

describe("AI 自查:失败一律显示原结果,标「未自查」,不挡结果", () => {
  const original = [
    "You died at 30s with nobody helping.",
    "Pain Suppression was never pressed.",
  ];
  it.each([
    ["调用出错", [{ delta: "{" }, "throw"] as Step[], "error"],
    ["坏 JSON", [{ delta: "sorry, cannot" }] as Step[], "bad-json"],
    [
      "顶层是数组(违约,不救)",
      [{ delta: JSON.stringify(JSON.parse(reviewed()).findings) }] as Step[],
      "bad-json",
    ],
    [
      "新增了一条结论",
      [
        {
          delta: JSON.stringify({
            findings: [
              ...JSON.parse(reviewed()).findings,
              {
                eventIds: ["death:a:30"],
                severity: "low",
                category: "positioning",
                title: "x",
                explanation: "y",
              },
            ],
          }),
        },
      ] as Step[],
      "contract: a finding not in the original",
    ],
    [
      "顺序被打乱",
      [
        {
          delta: JSON.stringify({
            findings: [...JSON.parse(reviewed()).findings].reverse(),
          }),
        },
      ] as Step[],
      "contract: findings reordered or repeated",
    ],
    [
      "一条不剩",
      [{ delta: JSON.stringify({ findings: [], changes: [] }) }] as Step[],
      "empty: every finding dropped",
    ],
  ])("%s", async (_name, steps, failure) => {
    const t = setup([[{ delta: FIRST }], steps], { selfReview: true });
    await t.s.run(input);
    const r = t.done();
    expect(r.findings.map((f: any) => f.explanation)).toEqual(original);
    expect(r.selfReview).toEqual({
      version: SELF_REVIEW_PROMPT_VERSION,
      status: "failed",
      failure,
    });
    expect(r.hadNarration).toBe(true);
    expect(
      t.emitted.find((e) => e.ch === "gladlog:analysis:error"),
    ).toBeUndefined();
  });

  it("后端在创建流时就同步抛错:同样是未自查,不是分析错误", async () => {
    let calls = 0;
    const emitted: Array<{ ch: string; p: any }> = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        aiSelfReview: true,
      }),
      clientFactory: () => ({
        stream() {
          if (++calls === 2) throw new Error("spawn failed");
          return (async function* () {
            yield { delta: FIRST };
          })();
        },
      }),
      matchesDir: mkdtempSync(join(tmpdir(), "gladlog-sr-")),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.selfReview).toMatchObject({
      status: "failed",
      failure: "error",
    });
    expect(done.p.result.findings).toHaveLength(2);
    expect(
      emitted.find((e) => e.ch === "gladlog:analysis:error"),
    ).toBeUndefined();
  });

  it("超时(API 后端不理 signal 也照样收口)", async () => {
    vi.useFakeTimers();
    const t = setup([[{ delta: FIRST }], ["hang"]], { selfReview: true });
    const p = t.s.run(input);
    await vi.advanceTimersByTimeAsync(300_000);
    await p;
    expect(t.done().selfReview).toMatchObject({
      status: "failed",
      failure: "timeout",
    });
    expect(t.done().findings[0].explanation).toBe(original[0]);
  });

  it("单条校验不过:只把那一条退回原版,其余照用自查版", async () => {
    const t = setup(
      [
        [{ delta: FIRST }],
        [
          {
            delta: reviewed([
              { explanation: "You died at 45s." }, // 45 is no fact of the cited event
              {
                explanation: "Pain Suppression stayed unused.",
                severity: "high",
              }, // raise ignored
            ]),
          },
        ],
      ],
      { selfReview: true },
    );
    await t.s.run(input);
    const r = t.done();
    expect(r.findings.map((f: any) => [f.explanation, f.severity])).toEqual([
      [original[0], "high"],
      ["Pain Suppression stayed unused.", "med"],
    ]);
    expect(r.selfReview.status).toBe("reviewed");
    expect(r.selfReview.reverted).toEqual([
      { index: 0, reason: "numeric: 45 not in the cited facts" },
    ]);
  });

  it("自查中途被取消(换场 / 重跑):不写缓存、不发 done", async () => {
    let calls = 0;
    const emitted: string[] = [];
    const s: ReturnType<typeof createAnalysisService> = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        aiSelfReview: true,
      }),
      clientFactory: () => ({
        async *stream() {
          calls++;
          if (calls === 1) {
            yield { delta: FIRST };
            return;
          }
          await s.cancel("m1");
          yield { delta: reviewed() };
        },
      }),
      matchesDir: mkdtempSync(join(tmpdir(), "gladlog-sr-")),
      emit: (ch) => emitted.push(ch),
    });
    await s.run(input);
    expect(emitted).not.toContain("gladlog:analysis:done");
    expect(await s.getCached("m1")).toBeNull();
  });
});

describe("AI 自查:问教练续接哪个会话", () => {
  it("自查成功 → 自查那次的会话;自查失败 → 首轮会话", async () => {
    const ok = setup(
      [
        [{ delta: FIRST }, { sessionId: "s-first" }],
        [{ delta: reviewed() }, { sessionId: "s-review" }],
      ],
      { selfReview: true },
    );
    await ok.s.run(input);
    expect(ok.done().sessionId).toBe("s-review");

    const bad = setup(
      [
        [{ delta: FIRST }, { sessionId: "s-first" }],
        [{ delta: "nope" }, { sessionId: "s-review" }],
      ],
      { selfReview: true },
    );
    await bad.s.run(input);
    expect(bad.done().sessionId).toBe("s-first");
  });
});

describe("AI 自查:缓存身份", () => {
  const cacheOf = (dir: string) =>
    JSON.parse(readFileSync(analysisCachePath(dir, "m1", "zh"), "utf-8"));

  it("开着写的结果,关掉后读不到(反之亦然);槽标 stale;批量「已分析」跟着走", async () => {
    const t = setup([[{ delta: FIRST }], [{ delta: reviewed() }]], {
      selfReview: true,
    });
    await t.s.run(input);
    expect(await t.s.getCached("m1")).not.toBeNull();
    expect(await t.s.listAnalyzed()).toEqual(["m1"]);
    expect((await t.s.getState("m1")).slots[0]!.stale).toBe(false);

    t.settings.aiSelfReview = false;
    expect(await t.s.getCached("m1")).toBeNull();
    expect(await t.s.listAnalyzed()).toEqual([]);
    expect((await t.s.getState("m1")).slots[0]!.stale).toBe(true);

    t.settings.aiSelfReview = undefined; // absent = off
    expect(await t.s.getCached("m1")).toBeNull();
  });

  it("功能上线前的老缓存(无 selfReview 字段):关时照常命中,开时视为未分析", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gladlog-sr-"));
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      analysisCachePath(dir, "m1", "zh"),
      JSON.stringify({
        schemaVersion: 2,
        language: "zh",
        slots: {
          "anthropic:claude-opus-5-5": {
            promptVersion: PROMPT_VERSION,
            createdAt: 1,
            result: { findings: [], dropped: 0, hadNarration: false },
          },
        },
        lastSlotKey: "anthropic:claude-opus-5-5",
      }),
    );
    const t = setup([], { dir });
    expect(await t.s.getCached("m1")).not.toBeNull();
    t.settings.aiSelfReview = true;
    expect(await t.s.getCached("m1")).toBeNull();
  });

  it("自查提示词版本不同的结果,开着时也视为未分析", async () => {
    const t = setup([[{ delta: FIRST }], [{ delta: reviewed() }]], {
      selfReview: true,
    });
    await t.s.run(input);
    const doc = cacheOf(t.dir);
    doc.slots[doc.lastSlotKey].result.selfReview.version =
      SELF_REVIEW_PROMPT_VERSION - 1;
    writeFileSync(analysisCachePath(t.dir, "m1", "zh"), JSON.stringify(doc));
    expect(await t.s.getCached("m1")).toBeNull();
  });

  it("跨场视图(汇总 / 错题本)不受开关影响", async () => {
    const t = setup([[{ delta: FIRST }], [{ delta: reviewed() }]], {
      selfReview: true,
    });
    await t.s.run(input);
    t.settings.aiSelfReview = false;
    expect((await t.s.aggregate()).map((a) => a.count)).toEqual([1, 1]);
    expect(await t.s.notebook()).toHaveLength(2);
  });
});
