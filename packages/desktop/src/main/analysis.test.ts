import type { CandidateEvent } from "@gladlog/analysis";
import { describe, expect, it } from "vitest";

import { PROMPT_VERSION } from "./ai";
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

describe("isRunning 追踪(切页防丢 + 泄漏回归)", () => {
  it("完成后清除 running", async () => {
    const { s } = svc(JSON.stringify([]));
    await s.run(input);
    expect(await s.isRunning("m1")).toBe(false);
  });

  // 复审发现的泄漏:run 被 deepen(++同一 matchId 代际)取代时,旧实现的 abort
  // 路径不清 running(且清理判据是「代际是否最新」,deepen 后必假)→ running 永久
  // 残留 → 换到无缓存语言时卡「分析中…」。修:running 存代际、按主人身份清、abort 也清。
  it("run 被 deepen 取代后 running 不泄漏", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        anthropicModel: "m",
        wowDirectory: null,
      }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: JSON.stringify([]) };
          await gate; // 挂住:模拟首轮还在跑
        },
      }),
      matchesDir: "/tmp/nope-" + Math.random(),
      emit: () => {},
    });
    const runP = s.run(input); // 加 running,产首 delta 后停在 gate
    await new Promise((r) => setTimeout(r, 0)); // 让 for-await 停到 gate
    expect(await s.isRunning("m1")).toBe(true);
    // packs 空 → deepen 只 ++代际即返回(不流式),恰好模拟「深挖取代在跑的 run」
    await s.deepen({ matchId: "m1", findings: [], packs: [], spec: "x" });
    release(); // run 恢复 → isCurrent 假 → abort → clearRunning
    await runP;
    expect(await s.isRunning("m1")).toBe(false); // 旧实现此处残留 true
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
    expect(nb.map((g) => g.category)).toEqual(["生存", "打断"]); // 按 count 降序
    const surv = nb[0]!;
    expect(surv.count).toBe(2);
    expect(surv.recurring).toBe(1);
    expect(surv.entries.map((e) => e.title)).toEqual(["晚的", "早的"]); // 时间倒序
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
        deepDive: "The Fear caused your death at {{p1.t}}s.", // 因果断言
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
});

describe("deepen 幂等守卫(周度复核 P2#4)", () => {
  // 病根:renderer 的触发条件是缓存里 deepened 仍为 false,而该标志要等本轮
  // writeMerged 才落盘。深挖在飞的几十秒里切走再切回 → 面板重挂 → 再触发一次,
  // 白烧一轮 token(旧 gen 会被 nextGen 判过期 abort,但请求已经发出去了)。
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
              await inFlight; // 卡住 = 深挖在飞
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
    expect(streamCalls).toBe(1); // 首轮已进流式
    await s.deepen(args); // 切页回来的重复触发
    expect(streamCalls).toBe(1); // 没有第二次模型调用
    release();
    await first;
    expect(streamCalls).toBe(1);

    // 守卫是「在飞期间」而非「永久」:本轮结束后仍可再深挖(用户手动重跑)
    release = () => {};
    await s.deepen(args);
    expect(streamCalls).toBe(2);
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

  it("未跑过 → {cached:null, running:false}", async () => {
    const s = await mk();
    expect(await s.getState("m1")).toEqual({ cached: null, running: false });
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
    expect(mid).toEqual({ cached: null, running: true });
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
    expect(after.cached).not.toBeNull(); // 结果拿得到,不会停在空闲态
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
    // 三场都跑完 → 三条代际都该回收(经 getState 侧信道观察:全部回到初始态)
    for (const id of ["m1", "m2", "m3"])
      expect((await s.getState(id)).running).toBe(false);
    expect(s.__generationCount()).toBe(0);
  });

  it("deepen 收尾时不得回收同场在飞的 run —— 否则 run 把自己判成过期,分析凭空丢", async () => {
    // 这是守卫真正吃劲的场景:deepen 在飞 → 用户手点「AI 分析」→ 新 run 接管
    // (代际 ++,deepen 随即判过期退出)→ deepen 的 finally 回收代际条目。
    // 若无「无 run 在飞才回收」的判据,新 run 下一拍 isCurrent 就读到 undefined,
    // 把自己当成过期的中途 abort,缓存永不落盘。
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
    const run = s.run(input("m1")); // 新 run 接管,deepen 就此过期
    releaseDeep();
    await deep; // deepen 收尾 → finally → reapGeneration
    releaseRun();
    await run;
    // run 没被误 abort:结果落了盘
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
    expect(s.__generationCount()).toBe(1); // 在飞,必须留着
    release();
    await p;
    expect(s.__generationCount()).toBe(0); // 落地后回收
    expect((await s.getState("m1")).cached).not.toBeNull(); // 没被误 abort
  });
});
