// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  buildAnalysisInput,
  buildAnalysisInputWith,
} from "../src/renderer/src/report/derive/analysisInput";
import { resetIdMemoForTest } from "../src/renderer/src/report/derive/idMemo";
import {
  deriveMistakes,
  deriveMistakesUncached,
} from "../src/renderer/src/report/derive/mistakes";
import {
  createDeriveWorkerCore,
  type DeriveWorkerReply,
  type DeriveWorkerRequest,
  WORKER_DOCS_MAX,
} from "../src/renderer/src/report/derive/offThread/deriveWorkerCore";
import {
  adoptLazyDoc,
  adoptRound,
  canDeriveOffThread,
  peekAnalysisInput,
  prepareAnalysisInput,
  prepareMistakes,
  setDeriveWorkerForTest,
  WORKER_DEADLINE_MS,
} from "../src/renderer/src/report/derive/offThread/offThreadDerive";
import { useAnalysisInput } from "../src/renderer/src/report/derive/offThread/useAnalysisInput";
import {
  resetSourceMemoForTest,
  sourceMemoHas,
} from "../src/renderer/src/report/derive/sourceMemo";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import type { LazyDocPayload } from "../src/shared/parseLazyDoc";
import { parseLazyPayload, parseRoundBytes } from "../src/shared/parseLazyDoc";
import {
  buildSyntheticShuffle,
  loadRealMatchFixture,
} from "./fixtures/loadFixture";

// The two derives that froze a long match's page (mistakes 2.1 s, the AI
// tab's prompt input 6.8 s; Windows field run 2026-11-14) run in a Web Worker
// on the same bytes. These tests pin that the worker's answer IS the page's
// own computation, that the page waits for it where it used to compute, and
// that every failure falls back to computing in place.

const enc = new TextEncoder();
const bytesOf = (v: unknown) => enc.encode(JSON.stringify(v));
const base = loadRealMatchFixture();
const matchDoc = { data: base };
const fullPayload = (): LazyDocPayload => ({
  mode: "full",
  bytes: bytesOf(matchDoc),
});
/** What the page's own parse of the payload gives (a fresh object). */
const pageParse = (p: LazyDocPayload) =>
  parseLazyPayload(p) as { data: ReportSource };

/** The derive worker, in process: messages cross by structured clone (so a
 * value that would not survive postMessage fails here too), replies come back
 * asynchronously, and `gate` holds every answer back until opened. */
class FakeWorker {
  core = createDeriveWorkerCore();
  onmessage: ((e: MessageEvent<DeriveWorkerReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: Array<{ msg: DeriveWorkerRequest; transfer?: Transferable[] }> = [];
  gate: Promise<void> | null = null;
  failAnswers = false;
  postMessage(msg: DeriveWorkerRequest, transfer?: Transferable[]) {
    this.posted.push({ msg, transfer });
    const copy = structuredClone(msg);
    void (async () => {
      const r = await this.core.handle(copy);
      if (this.gate) await this.gate;
      if (!r) return;
      const reply: DeriveWorkerReply = this.failAnswers
        ? { id: r.id, ok: false, error: "boom" }
        : r;
      this.onmessage?.({ data: structuredClone(reply) } as MessageEvent);
    })();
  }
  terminate() {}
}
const asWorker = (f: FakeWorker) => f as unknown as Worker;

beforeAll(async () => {
  await ensureAnalysisData();
});
beforeEach(() => {
  resetSourceMemoForTest(true);
  resetIdMemoForTest();
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: { get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }) },
  };
});
afterEach(() => {
  cleanup();
  setDeriveWorkerForTest(undefined);
});

describe("deriveWorkerCore: 同样的字节,同样的答案", () => {
  it("3v3 整局:失误清单与分析输入和页面同步算的逐项相同", async () => {
    const core = createDeriveWorkerCore();
    await core.handle({
      op: "load",
      token: 1,
      kind: "lazy",
      payload: fullPayload(),
    });
    const m = await core.handle({
      op: "mistakes",
      id: 1,
      token: 1,
      path: ["data"],
    });
    const inp = await core.handle({
      op: "input",
      id: 2,
      token: 1,
      path: ["data"],
      matchId: "m",
      rawStreams: undefined,
    });
    const page = pageParse(fullPayload()).data;
    expect(m).toMatchObject({ id: 1, ok: true });
    expect(inp).toMatchObject({ id: 2, ok: true });
    const wantMistakes = deriveMistakesUncached(page);
    expect(wantMistakes.length).toBeGreaterThan(0);
    // across postMessage the value is a structured clone
    expect(structuredClone((m as { value: unknown }).value)).toEqual(
      wantMistakes,
    );
    const wantInput = buildAnalysisInputWith(page, "m", undefined);
    expect(wantInput).not.toBeNull();
    expect(structuredClone((inp as { value: unknown }).value)).toEqual(
      wantInput,
    );
  });

  it("单排:按轮拆的首轮与单独加载的一轮,都和页面算的相同", async () => {
    const shuffle = buildSyntheticShuffle(base, 3);
    const shell = { data: { ...shuffle, rounds: [null, null, null] } };
    const per: LazyDocPayload = {
      mode: "perRound",
      shell: bytesOf(shell),
      round0: bytesOf(shuffle.rounds[0]),
      roundCount: 3,
    };
    const core = createDeriveWorkerCore();
    await core.handle({ op: "load", token: 1, kind: "lazy", payload: per });
    await core.handle({
      op: "load",
      token: 2,
      kind: "round",
      bytes: bytesOf(shuffle.rounds[2]),
    });
    const r0 = await core.handle({
      op: "mistakes",
      id: 1,
      token: 1,
      path: ["data", "rounds", 0],
    });
    const r2 = await core.handle({ op: "mistakes", id: 2, token: 2, path: [] });
    const page0 = (
      parseLazyPayload(per) as { data: { rounds: ReportSource[] } }
    ).data.rounds[0]!;
    const page2 = parseRoundBytes(bytesOf(shuffle.rounds[2])) as ReportSource;
    expect((r0 as { value: unknown }).value).toEqual(
      deriveMistakesUncached(page0),
    );
    expect((r2 as { value: unknown }).value).toEqual(
      deriveMistakesUncached(page2),
    );
  });

  it("消息逐个投递(真 worker 的样子):后到的失误请求排在已排队的旧输入前面", async () => {
    const core = createDeriveWorkerCore();
    const order: string[] = [];
    const replies: Array<Promise<unknown>> = [];
    // each message arrives on its own event-loop task, as postMessage does
    const deliver = (msg: DeriveWorkerRequest, tagAs?: string) =>
      new Promise<void>((arrived) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => {
          ch.port1.close();
          const p = core.handle(msg);
          if (tagAs) replies.push(p.then(() => order.push(tagAs)));
          arrived();
        };
        ch.port2.postMessage(0);
      });
    await Promise.all([
      deliver({ op: "load", token: 1, kind: "lazy", payload: fullPayload() }),
      deliver(
        {
          op: "input",
          id: 1,
          token: 1,
          path: ["data"],
          matchId: "a",
          rawStreams: undefined,
        },
        "input-1",
      ),
      deliver({ op: "load", token: 2, kind: "lazy", payload: fullPayload() }),
      deliver(
        { op: "mistakes", id: 2, token: 2, path: ["data"] },
        "mistakes-2",
      ),
    ]);
    await Promise.all(replies);
    expect(order).toEqual(["mistakes-2", "input-1"]);
  });

  it("drop 当场生效:这份文档排队中的请求答失败,不再算", async () => {
    const core = createDeriveWorkerCore();
    const load = core.handle({
      op: "load",
      token: 1,
      kind: "lazy",
      payload: fullPayload(),
    });
    const input = core.handle({
      op: "input",
      id: 1,
      token: 1,
      path: ["data"],
      matchId: "a",
      rawStreams: undefined,
    });
    const mistakes = core.handle({
      op: "mistakes",
      id: 2,
      token: 1,
      path: ["data"],
    });
    await core.handle({ op: "drop", token: 1 });
    expect(await input).toEqual({ id: 1, ok: false, error: "dropped" });
    expect(await mistakes).toEqual({ id: 2, ok: false, error: "dropped" });
    expect(await load).toBeNull();
    expect(core.docCount()).toBe(0);
  });

  it("留住的文档有上限;找不到的文档答失败而不是抛出", async () => {
    const core = createDeriveWorkerCore();
    for (let t = 1; t <= WORKER_DOCS_MAX + 1; t++)
      await core.handle({
        op: "load",
        token: t,
        kind: "round",
        bytes: bytesOf(base),
      });
    expect(core.docCount()).toBe(WORKER_DOCS_MAX);
    const r = await core.handle({ op: "mistakes", id: 9, token: 1, path: [] });
    expect(r).toMatchObject({ id: 9, ok: false });
  });
});

describe("offThreadDerive: 页面一侧", () => {
  it("收养后 prepareMistakes 把 worker 的答案放进缓存,页面再取是命中", async () => {
    const fw = new FakeWorker();
    setDeriveWorkerForTest(asWorker(fw));
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    // the page's own copy of the bytes is handed over, not cloned
    expect(fw.posted[0]!.transfer).toContain(
      (payload as { bytes: Uint8Array }).bytes.buffer,
    );
    expect(canDeriveOffThread(doc.data)).toBe(true);
    expect(sourceMemoHas(doc.data, "deriveMistakes")).toBe(false);
    await prepareMistakes(doc.data);
    expect(sourceMemoHas(doc.data, "deriveMistakes")).toBe(true);
    expect(deriveMistakes(doc.data)).toEqual(
      deriveMistakesUncached(pageParse(fullPayload()).data),
    );
  });

  it("没有 worker:prepare* 返回 null,钩子当场同步算", () => {
    setDeriveWorkerForTest(null);
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    expect(canDeriveOffThread(doc.data)).toBe(false);
    expect(prepareMistakes(doc.data)).toBeNull();
    expect(prepareAnalysisInput(doc.data, "m")).toBeNull();
    const { result } = renderHook(() => useAnalysisInput(doc.data, "m"));
    expect(result.current.pending).toBe(false);
    expect(result.current.input).toEqual(
      buildAnalysisInputWith(pageParse(fullPayload()).data, "m", undefined),
    );
  });

  it("钩子:worker 答之前 pending,答了以后是同一个值,且之后同步取命中", async () => {
    const fw = new FakeWorker();
    let open!: () => void;
    fw.gate = new Promise((r) => (open = r));
    setDeriveWorkerForTest(asWorker(fw));
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    const { result } = renderHook(() => useAnalysisInput(doc.data, "m"));
    expect(result.current).toEqual({ input: null, pending: true });
    open();
    await waitFor(() => expect(result.current.pending).toBe(false));
    const want = buildAnalysisInputWith(
      pageParse(fullPayload()).data,
      "m",
      undefined,
    );
    expect(result.current.input).toEqual(want);
    expect(peekAnalysisInput(doc.data, "m")).toBe(result.current.input);
    expect(buildAnalysisInput(doc.data, "m")).toBe(result.current.input);
  });

  it("worker 答失败:prepareMistakes 拒绝,钩子退回当场算出同样的值", async () => {
    const fw = new FakeWorker();
    fw.failAnswers = true;
    setDeriveWorkerForTest(asWorker(fw));
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    await expect(prepareMistakes(doc.data)).rejects.toThrow("boom");
    expect(sourceMemoHas(doc.data, "deriveMistakes")).toBe(false);
    const { result } = renderHook(() => useAnalysisInput(doc.data, "m"));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.input).toEqual(
      buildAnalysisInputWith(pageParse(fullPayload()).data, "m", undefined),
    );
  });

  it("两个结果都到手(raw 已落定,哪怕没有 raw)后,worker 放掉这份文档", async () => {
    const fw = new FakeWorker();
    setDeriveWorkerForTest(asWorker(fw));
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    const drops = () => fw.posted.filter((p) => p.msg.op === "drop").length;
    await prepareMistakes(doc.data);
    // built before the raw streams settled: rebuilt later, the doc stays
    await prepareAnalysisInput(doc.data, "m");
    expect(drops()).toBe(0);
    await prepareAnalysisInput(doc.data, "m", true);
    expect(drops()).toBe(1);
    await waitFor(() => expect(fw.core.docCount()).toBe(0));
  });

  it("打开了但没看的对局不被一直留住:只留最近 WORKER_DOCS_MAX 份", () => {
    setDeriveWorkerForTest(asWorker(new FakeWorker()));
    const docs = Array.from({ length: WORKER_DOCS_MAX + 3 }, () => {
      const payload = fullPayload();
      const doc = pageParse(payload);
      adoptLazyDoc(doc, payload);
      return doc.data;
    });
    expect(docs.map(canDeriveOffThread)).toEqual(
      docs.map((_, i) => i >= docs.length - WORKER_DOCS_MAX),
    );
    // let go of here = derived in place, not asked of the worker
    expect(prepareMistakes(docs[0]!)).toBeNull();
  });

  it("worker 不答也不报错:到时限就停掉它,等着的都退回当场算", async () => {
    vi.useFakeTimers();
    try {
      const fw = new FakeWorker();
      fw.gate = new Promise(() => {}); // never answers
      const terminate = vi.spyOn(fw, "terminate");
      setDeriveWorkerForTest(asWorker(fw));
      const payload = fullPayload();
      const doc = pageParse(payload);
      adoptLazyDoc(doc, payload);
      const p = prepareMistakes(doc.data)!;
      const settled = vi.fn();
      p.catch(settled);
      await vi.advanceTimersByTimeAsync(WORKER_DEADLINE_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(p).rejects.toThrow("timed out");
      expect(terminate).toHaveBeenCalled();
      expect(canDeriveOffThread(doc.data)).toBe(false);
      expect(prepareMistakes(doc.data)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("排队长不算卡死:只要 worker 隔一阵就答一个,时限从上一次回答算起", async () => {
    vi.useFakeTimers();
    try {
      const posted: DeriveWorkerRequest[] = [];
      const stub = {
        onmessage: null as
          ((e: MessageEvent<DeriveWorkerReply>) => void) | null,
        onerror: null,
        postMessage: (m: DeriveWorkerRequest) => posted.push(m),
        terminate: vi.fn(),
      };
      setDeriveWorkerForTest(stub as unknown as Worker);
      const payload = fullPayload();
      const doc = pageParse(payload);
      adoptLazyDoc(doc, payload);
      const asks = ["m1", "m2", "m3", "m4", "m5"].map((id) =>
        prepareAnalysisInput(doc.data, id)!,
      );
      const ids = posted
        .filter((m) => m.op === "input")
        .map((m) => (m as { id: number }).id);
      expect(ids).toHaveLength(5);
      // one answer every 20 s: 100 s in all, never 30 s of silence
      for (const id of ids) {
        await vi.advanceTimersByTimeAsync(20_000);
        stub.onmessage!({
          data: { id, ok: true, value: null },
        } as MessageEvent<DeriveWorkerReply>);
      }
      await expect(Promise.all(asks)).resolves.toHaveLength(5);
      expect(stub.terminate).not.toHaveBeenCalled();
      expect(canDeriveOffThread(doc.data)).toBe(true);
      // and then a request nobody answers for WORKER_DEADLINE_MS does fail it
      const last = prepareMistakes(doc.data)!;
      const caught = last.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(WORKER_DEADLINE_MS);
      expect(await caught).toContain("timed out");
      expect(stub.terminate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("被挤出的文档也告诉 worker 放掉(带走它排队中的活)", () => {
    const fw = new FakeWorker();
    setDeriveWorkerForTest(asWorker(fw));
    for (let i = 0; i < WORKER_DOCS_MAX + 1; i++) {
      const payload = fullPayload();
      adoptLazyDoc(pageParse(payload), payload);
    }
    const loads = fw.posted
      .filter((p) => p.msg.op === "load")
      .map((p) => (p.msg as { token: number }).token);
    const drops = fw.posted
      .filter((p) => p.msg.op === "drop")
      .map((p) => (p.msg as { token: number }).token);
    expect(drops).toEqual([loads[0]]);
  });

  it("懒加载的一轮也收养(路径为空)", async () => {
    const fw = new FakeWorker();
    setDeriveWorkerForTest(asWorker(fw));
    const bytes = bytesOf(base);
    const round = parseRoundBytes(bytes) as ReportSource;
    adoptRound(round, bytes);
    await prepareMistakes(round);
    expect(deriveMistakes(round)).toEqual(
      deriveMistakesUncached(parseRoundBytes(bytesOf(base)) as ReportSource),
    );
  });
});

describe("MatchReport 分段填充等 worker", () => {
  const root = (c: HTMLElement) => c.querySelector(".rpt-match") as HTMLElement;

  it("失误一步等 worker 答完才走;走完与一次渲染逐字节相同", async () => {
    setDeriveWorkerForTest(null);
    const onePass = render(
      <MatchReport source={pageParse(fullPayload()).data} matchId="m" />,
    );
    const want = root(onePass.container).innerHTML;
    onePass.unmount();
    resetSourceMemoForTest(true);
    resetIdMemoForTest();

    const fw = new FakeWorker();
    let open!: () => void;
    fw.gate = new Promise((r) => (open = r));
    setDeriveWorkerForTest(asWorker(fw));
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    const { container } = render(
      <MatchReport source={doc.data} matchId="m" staged />,
    );
    const el = root(container);
    await waitFor(() => expect(el.dataset["fill"]).toBe("2"), {
      timeout: 20_000,
      interval: 1,
    });
    // held at the mistake step while the worker has not answered
    await new Promise((r) => setTimeout(r, 300));
    expect(el.dataset["fill"]).toBe("2");
    expect(sourceMemoHas(doc.data, "deriveMistakes")).toBe(false);
    open();
    await waitFor(() => expect(el.dataset["fill"]).toBe("done"), {
      timeout: 20_000,
      interval: 1,
    });
    expect(el.innerHTML).toBe(want);
  });

  it("worker 失败时失误一步照常当场算完", async () => {
    const fw = new FakeWorker();
    fw.failAnswers = true;
    setDeriveWorkerForTest(asWorker(fw));
    const payload = fullPayload();
    const doc = pageParse(payload);
    adoptLazyDoc(doc, payload);
    const { container } = render(
      <MatchReport source={doc.data} matchId="m" staged />,
    );
    const el = root(container);
    await waitFor(() => expect(el.dataset["fill"]).toBe("done"), {
      timeout: 20_000,
      interval: 1,
    });
    expect(sourceMemoHas(doc.data, "deriveMistakes")).toBe(true);
  });
});
