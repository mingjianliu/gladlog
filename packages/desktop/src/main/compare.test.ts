import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createCompareService } from "./compare";
import { COMPARE_PROMPT_VERSION } from "@gladlog/analysis/src/compare/buildExemplarLedPrompt";
import { PROMPT_VERSION } from "./ai";
import type { ReferenceCorpus } from "@gladlog/analysis";

const corpus: ReferenceCorpus = {
  wowPatchVersion: "12.1.0.68629",
  builtAt: "now",
  sourceFloor: 2300,
  buildGroups: {
    "Discipline Priest": {
      keystoneNodeIds: [82585],
      match: "any",
      groupPresent: "offensive",
      groupAbsent: "standard",
    },
  },
  cells: [
    {
      spec: "Discipline Priest",
      bracket: "3v3",
      archetype: "hybrid",
      buildGroup: "offensive",
      sampleN: 40,
      insufficient: false,
      metrics: { offensiveIndex: { p10: 0.2, p50: 0.49, p90: 0.7, n: 40 } },
      exemplarCrises: [],
    },
    {
      // build-agnostic bracket parent — the fallback target when fail-open
      // forces buildGroup="*".
      spec: "Discipline Priest",
      bracket: "3v3",
      archetype: "*",
      buildGroup: "*",
      sampleN: 200,
      insufficient: false,
      metrics: { offensiveIndex: { p10: 0.2, p50: 0.4, p90: 0.6, n: 200 } },
      exemplarCrises: [],
    },
  ],
};

function svc(
  streamText: string,
  opts?: {
    apiKey?: string | null;
    build?: string;
    dir?: string;
    corpus?: ReferenceCorpus;
  },
) {
  const emitted: Array<{ ch: string; p: any }> = [];
  const s = createCompareService({
    getSettings: () => ({
      // respect an explicit null (nullish `??` would coerce it back to "k")
      anthropicApiKey: opts && "apiKey" in opts ? (opts.apiKey ?? null) : "k",
      wowDirectory: null,
    }),
    clientFactory: () => ({
      async *stream() {
        yield { delta: streamText };
      },
    }),
    loadCorpus: () => opts?.corpus ?? corpus,
    gameBuild: () => opts?.build ?? "12.1.0.68629",
    matchesDir: opts?.dir ?? "/tmp/nonexistent-" + Math.random(),
    emit: (ch, p) => emitted.push({ ch, p }),
  });
  return { s, emitted };
}
const input = {
  matchId: "m1",
  healerMetrics: { offensiveIndex: 0.31 },
  spec: "Discipline Priest",
  talents: [82585],
  bracket: "3v3",
  archetype: "hybrid",
  wowBuild: "12.1.0.68629",
};

describe("createCompareService", () => {
  it("getCached returns null when the stored corpusVersion or promptVersion is stale", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-"));
    const mk = (corpusVer: string) =>
      createCompareService({
        getSettings: () => ({
          anthropicApiKey: "k",
          wowDirectory: null,
        }),
        clientFactory: () => ({
          async *stream() {
            yield { delta: "" };
          },
        }),
        loadCorpus: () => ({ ...corpus, wowPatchVersion: corpusVer }),
        gameBuild: () => corpusVer,
        matchesDir: dir,
        emit: () => {},
      });
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "compare.json"),
      JSON.stringify({
        corpusVersion: "12.1.0.68629",
        promptVersion: COMPARE_PROMPT_VERSION,
        language: "zh", // 语言分键:缺失/不匹配 → 缓存失效
        result: {
          verifiedComparison: { dims: [], facts: {} },
          report: "cached",
          droppedReason: null,
          cellMeta: null,
        },
      }),
    );
    expect((await mk("12.1.0.68629").getCached("m1"))?.report).toBe("cached"); // versions match
    expect(await mk("99.9.9.9").getCached("m1")).toBeNull(); // corpus version changed → stale
  });

  // Single-source predicate (2026-08-02): the compare cache's invalidation key
  // must be the cohort comparison's own prompt version, not the findings
  // PROMPT_VERSION — the latter was bumped twice within two days (13→14→15) and
  // each bump voided every stored cohort comparison in the library by
  // association, blanking the panel out of nowhere. This assertion pins the
  // decoupling down: writing the analysis version into the cache is no longer
  // accepted.
  it("缓存失效键与分析 PROMPT_VERSION 解耦", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-ver-"));
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: "" };
        },
      }),
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: dir,
      emit: () => {},
    });
    const write = (promptVersion: number) => {
      mkdirSync(join(dir, "m1"), { recursive: true });
      writeFileSync(
        join(dir, "m1", "compare.json"),
        JSON.stringify({
          corpusVersion: "12.1.0.68629",
          promptVersion,
          language: "zh",
          result: {
            verifiedComparison: { dims: [], facts: {} },
            report: "cached",
            droppedReason: null,
            cellMeta: null,
          },
        }),
      );
    };
    write(COMPARE_PROMPT_VERSION);
    expect((await s.getCached("m1"))?.report).toBe("cached");
    // The analysis prompt version (currently 15) is no longer compare's key
    expect(PROMPT_VERSION).not.toBe(COMPARE_PROMPT_VERSION);
    write(PROMPT_VERSION);
    expect(await s.getCached("m1")).toBeNull();
  });
  it("interpolates placeholders and returns a verified report for the offensive build", async () => {
    const { s, emitted } = svc(
      "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
    );
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBe("You hit 0.31 vs 0.49.");
    expect(done.p.result.droppedReason).toBeNull();
    expect(done.p.result.cellMeta.buildGroup).toBe("offensive");
  });

  // 用户裁定 2026-09-11: hero tree outranks the keystone gate. The corpus on
  // disk decides which of the two it can actually answer, so the candidates are
  // tried in ruling order against the cells that exist.
  it("hero group wins when the corpus carries it", async () => {
    const heroCorpus: ReferenceCorpus = {
      ...corpus,
      cells: [
        {
          spec: "Discipline Priest",
          bracket: "3v3",
          archetype: "hybrid",
          buildGroup: "Oracle",
          sampleN: 40,
          insufficient: false,
          metrics: { offensiveIndex: { p10: 0.2, p50: 0.55, p90: 0.7, n: 40 } },
          exemplarCrises: [],
        },
        ...corpus.cells,
      ],
    };
    const { s, emitted } = svc("{{offensiveIndex.cohortMedian}}", {
      corpus: heroCorpus,
    });
    await s.run({ ...input, heroGroup: "Oracle" });
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.cellMeta.buildGroup).toBe("Oracle");
  });

  it("a corpus built before the ruling keeps its gate group instead of degrading", async () => {
    // The live reference_vectors still keys Discipline as offensive/standard.
    // Asking it for "Oracle" would find nothing; falling straight through to
    // "*" would answer with LESS than that corpus actually knows.
    const { s, emitted } = svc("{{offensiveIndex.cohortMedian}}");
    await s.run({ ...input, heroGroup: "Oracle" });
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.cellMeta.buildGroup).toBe("offensive");
  });
  it("drops prose and returns numbers-only when BOTH attempts violate claimChecker", async () => {
    // svc 的 stream 每次都吐同一段违规文本 → 首次失败、重试同样失败
    const { s, emitted } = svc("Your index of 0.85 is great.");
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBeNull();
    expect(done.p.result.droppedReason).toMatch(/claim/i);
    expect(done.p.result.verifiedComparison.dims.length).toBeGreaterThan(0);
  });
  it("claimChecker 违规后带清单重试一次:第二稿干净则采纳,重试不外发 delta", async () => {
    const emitted: Array<{ ch: string; p: any }> = [];
    let calls = 0;
    const prompts: string[] = [];
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream(p: { messages: { content: string }[] }) {
          calls++;
          prompts.push(p.messages[0]!.content);
          yield {
            delta:
              calls === 1
                ? "Your index of 0.85 is great."
                : "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
          };
        },
      }),
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: "/tmp/nonexistent-" + Math.random(),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    await s.run(input);
    expect(calls).toBe(2);
    // 重试 prompt = 单源 buildRetryPrompt:带违规清单与被拒草稿
    expect(prompts[1]).toMatch(/REJECTED/);
    expect(prompts[1]).toMatch(/0\.85/);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBe("You hit 0.31 vs 0.49.");
    expect(done.p.result.droppedReason).toBeNull();
    // 第二稿不外发 delta(renderer 已显示首稿,done 整体替换)
    const deltas = emitted.filter((e) => e.ch === "gladlog:compare:delta");
    expect(deltas.every((d) => !/\{\{|0\.31/.test(d.p.text))).toBe(true);
  });
  it("fail-open: a stale corpus major version forces buildGroup='*'", async () => {
    const { s, emitted } = svc("ok {{offensiveIndex}}", {
      build: "13.0.0.99999",
    });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.cellMeta.buildGroup).toBe("*");
  });
  it("no API key: returns numbers-only without error", async () => {
    const { s, emitted } = svc("unused", { apiKey: null });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBeNull();
    expect(
      emitted.find((e) => e.ch === "gladlog:compare:error"),
    ).toBeUndefined();
  });

  // One cause behind the 2026-08-02 report "the cohort panel sometimes doesn't
  // show up": the generation counter used to be **one per service**, so any new
  // run() made the in-flight one hit `myGen !== generation` and bail with a bare
  // return — no done, no error, no compare.json — leaving that match's panel
  // blank forever. A local CLI backend takes minutes per call (TIMEOUT_MS=300s),
  // and "hit analyze on match A, then switch to B and hit it again before A
  // comes back" is entirely normal, so the window is wide. Generations have to
  // be bucketed per matchId: a re-run of the same match should supersede the
  // previous one (the new result overwrites it), different matches must not
  // interfere.
  it("跨 matchId 不互相腰斩:A 在飞时 B 起跑,A 仍会 emit done", async () => {
    const emitted: Array<{ ch: string; p: any }> = [];
    let releaseA: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      releaseA = r;
    });
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream(p: { messages: { content: string }[] }) {
          // A (started first) blocks on the gate, standing in for a CLI child
          // process that has not returned yet
          if (p.messages[0].content.includes("__A__")) await gate;
          yield { delta: "ok {{offensiveIndex}}" };
        },
      }),
      // A recognisable marker in the prompt tells the two matches' calls apart
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: mkdtempSync(join(tmpdir(), "cmp-gen-")),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    const runA = s.run({ ...input, matchId: "__A__" });
    const runB = s.run({ ...input, matchId: "mB" });
    await runB;
    releaseA!();
    await runA;
    const dones = emitted
      .filter((e) => e.ch === "gladlog:compare:done")
      .map((e) => e.p.matchId);
    expect(dones).toContain("mB");
    expect(dones).toContain("__A__");
  });

  it("同一 matchId 重跑:旧的那次被腰斩,新的照常 emit done(只有一条)", async () => {
    const emitted: Array<{ ch: string; p: any }> = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          if (first) {
            first = false;
            await gate;
          }
          yield { delta: "ok {{offensiveIndex}}" };
        },
      }),
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: mkdtempSync(join(tmpdir(), "cmp-same-")),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    const r1 = s.run(input);
    const r2 = s.run(input);
    await r2;
    release!();
    await r1;
    expect(emitted.filter((e) => e.ch === "gladlog:compare:done")).toHaveLength(
      1,
    );
  });

  // The **root cause** of "the cohort panel sometimes doesn't show up" (the one
  // that survived adversarial verification on 2026-08-02): compare only had push
  // events plus a file cache, with no pullable state. Unmounting the AI tab
  // (switching to report / replay / events / video, or changing shuffle rounds)
  // leaves nobody listening for gladlog:compare:done — IPC events are not queued
  // or replayed, so the result is gone for good; and after a remount lastSignal
  // is initialised to the current nonce, so the auto re-run branch never fires
  // either. NO_COHORT in particular is **never written to compare.json** (it only
  // emits done), so the "not enough cohort data yet" line never comes back after
  // a single tab switch — no timing race required, which is exactly the
  // "sometimes". The fix mirrors the neighbouring analysis.getState: main keeps
  // the terminal state, the renderer pulls it on mount and falls back to the
  // cache.
  it("getState:NO_COHORT 这种不写盘的终态,卸载重挂后仍拉得回来", async () => {
    const { s } = svc("unused");
    // The corpus has no cell for this spec → NO_COHORT
    await s.run({ ...input, spec: "Frost Mage" });
    const st = await s.getState(input.matchId);
    expect(st.phase).toBe("done");
    expect(st.phase === "done" && st.result.droppedReason).toBe("NO_COHORT");
  });

  it("getState:错误终态同样可拉取(而不是只发一次 error 事件)", async () => {
    const emitted: Array<{ ch: string; p: any }> = [];
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: "" };
        },
      }),
      loadCorpus: () => null,
      gameBuild: () => "12.1.0.68629",
      matchesDir: mkdtempSync(join(tmpdir(), "cmp-state-")),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    await s.run(input);
    const st = await s.getState(input.matchId);
    expect(st.phase).toBe("error");
    expect(st.phase === "error" && st.message).toBe("NO_CORPUS");
  });

  it("getState:在跑时带 startedAt(2026-08-05:CLI 后端假流式分钟级,重挂载后计时不归零的数据源)", async () => {
    let release!: () => void;
    const inFlight = new Promise<void>((r) => (release = r));
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          await inFlight;
          yield { delta: "" };
        },
      }),
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: mkdtempSync(join(tmpdir(), "cmp-running-")),
      emit: () => {},
    });
    const before = Date.now();
    const p = s.run({ ...input, autoTriggered: true });
    const st = await s.getState(input.matchId);
    expect(st.phase).toBe("running");
    if (st.phase === "running") {
      expect(st.startedAt).toBeGreaterThanOrEqual(before);
      expect(st.startedAt).toBeLessThanOrEqual(Date.now());
      // 自动补跑标注也从 main 拉回(agy review #2:重挂载不丢「为什么自己跑」)
      expect(st.autoTriggered).toBe(true);
    }
    release();
    await p;
  });

  it("getState:没跑过的场次是 idle;跑过并写了盘的场次回退读缓存", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-state2-"));
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: null, wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: "" };
        },
      }),
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: dir,
      emit: () => {},
    });
    expect((await s.getState("never-run")).phase).toBe("idle");
    // NO_COHORT:结论只取决于(语料 + 本场输入)→ 可缓存,会落盘。
    // (这里原本用 NO_API_KEY,那类结论 2026-08-22 起不再落盘,见下方 GH #27 三条)
    await s.run({ ...input, spec: "Frost Mage" });
    // A fresh service instance (stands in for restarting the app: the
    // in-memory state is gone, only disk remains)
    const s2 = createCompareService({
      getSettings: () => ({ anthropicApiKey: null, wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: "" };
        },
      }),
      loadCorpus: () => corpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: dir,
      emit: () => {},
    });
    expect((await s2.getState(input.matchId)).phase).toBe("done");
  });

  // The first half of compare.run (loadCorpus→lookupCell→verifiedComparison→
  // resolveAiClient) used to sit entirely outside the try: anything thrown there
  // rejected the IPC invoke, the renderer got nothing but an unhandled rejection,
  // and the panel stayed on "running" with no error copy — the same presentation
  // as "the panel didn't show up". Every throw has to become a compare:error
  // event.
  it("前半段抛出也 emit compare:error(不是让 invoke reject)", async () => {
    const emitted: Array<{ ch: string; p: any }> = [];
    const s = createCompareService({
      getSettings: () => ({ anthropicApiKey: "k", wowDirectory: null }),
      clientFactory: () => ({
        async *stream() {
          yield { delta: "" };
        },
      }),
      // Missing buildGroups → `corpus.buildGroups[input.spec]` throws in compare.ts
      loadCorpus: () =>
        ({ ...corpus, buildGroups: undefined }) as unknown as ReferenceCorpus,
      gameBuild: () => "12.1.0.68629",
      matchesDir: mkdtempSync(join(tmpdir(), "cmp-throw-")),
      emit: (ch, p) => emitted.push({ ch, p }),
    });
    await expect(s.run(input)).resolves.toBeUndefined();
    expect(emitted.find((e) => e.ch === "gladlog:compare:error")).toBeTruthy();
  });

  // ── 生产反馈 GH #27(2026-08-22):升级 0.1.27→0.1.28 后,已分析对局的
  // 「同水平对比」一打开又跑了一遍。缓存键三项(corpusVersion /
  // COMPARE_PROMPT_VERSION / language)在两个 tag 之间一项都没动(语料文件是
  // 同一个 git blob),所以不是数据失效。真正的原因是**跑完了却没落盘的终态
  // 只活在进程内存的 states Map 里**:升级 = 重启 = Map 清空,而 renderer 的
  // 自动补跑(打开「有分析、无对比」的对局就自动跑一次)于是每次重启后都再
  // 跑一遍。落盘判据从此单源:**结论只取决于(语料 + 本场输入)的才可缓存,
  // 取决于设置/环境的一律不缓存**(isCacheableCompareResult)。
  it("NO_COHORT 落盘:重启(新服务实例)后仍是 done,不再触发自动补跑", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-nocohort-"));
    // 语料里没有这个专精的格子 → NO_COHORT
    await svc("unused", { dir }).s.run({ ...input, spec: "Frost Mage" });
    expect(existsSync(join(dir, input.matchId, "compare.json"))).toBe(true);
    // 新实例 = 重启后的 app:内存里什么都没有,只剩磁盘
    const st = await svc("unused", { dir }).s.getState(input.matchId);
    expect(st.phase).toBe("done");
    expect(st.phase === "done" && st.result.droppedReason).toBe("NO_COHORT");
  });

  // 反向的同族 bug(同一次排查发现):NO_API_KEY 反而**会**落盘,于是没配 key
  // 时打开一次,那份「没有 key」的结论就永久命中 —— 之后把 key 配好了,
  // getCached 照样返回它,面板永远停在这句话上,自动补跑也不触发
  // (renderer 的判据是 result !== null)。缓存键里没有任何一项与 key/后端有关,
  // 所以它只能靠「不进缓存」来修。
  it("NO_API_KEY 不落盘:配好 key 后同一场能重新跑出解说", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-nokey-"));
    const a = svc("unused", { apiKey: null, dir });
    await a.s.run(input);
    expect(
      a.emitted.find((e) => e.ch === "gladlog:compare:done")!.p.result
        .droppedReason,
    ).toBe("NO_API_KEY");
    expect(existsSync(join(dir, input.matchId, "compare.json"))).toBe(false);
    // 用户把 key 配好、重启 app:必须回到 idle,自动补跑才有机会跑
    const b = svc(
      "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
      {
        dir,
      },
    );
    expect((await b.s.getState(input.matchId)).phase).toBe("idle");
    await b.s.run(input);
    expect(
      b.emitted.find((e) => e.ch === "gladlog:compare:done")!.p.result.report,
    ).toBe("You hit 0.31 vs 0.49.");
  });

  // 自愈:旧版本已经写在用户盘上的那份 NO_API_KEY 缓存,读侧也必须判为未命中,
  // 否则修了写侧,存量用户的面板照样被钉死。读写两侧共用同一个谓词。
  it("历史遗留的 NO_API_KEY 缓存判为未命中(读侧自愈)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-legacy-nokey-"));
    mkdirSync(join(dir, input.matchId), { recursive: true });
    writeFileSync(
      join(dir, input.matchId, "compare.json"),
      JSON.stringify({
        schemaVersion: 1,
        corpusVersion: corpus.wowPatchVersion,
        promptVersion: COMPARE_PROMPT_VERSION,
        language: "zh",
        createdAt: 1,
        result: {
          verifiedComparison: { dims: [], facts: {} },
          report: null,
          droppedReason: "NO_API_KEY",
          cellMeta: null,
        },
      }),
    );
    const { s } = svc("unused", { dir });
    expect(await s.getCached(input.matchId)).toBeNull();
    expect((await s.getState(input.matchId)).phase).toBe("idle");
  });
});
