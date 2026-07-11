import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { vi } from "vitest";
import {
  createAiService,
  realClientFactory,
  type AnthropicLike,
} from "../src/main/ai";

const sdkAbortSpy = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class {
    messages = {
      stream: () => ({
        abort: sdkAbortSpy,
        async *[Symbol.asyncIterator]() {
          yield {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hi" },
          };
          yield {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "more" },
          };
        },
      }),
    };
  },
}));

type Emitted = { channel: string; payload: unknown }[];

function fakeClient(script: {
  deltas?: string[];
  failWith?: string;
  hang?: boolean;
}): AnthropicLike {
  return {
    stream() {
      const deltas = script.deltas ?? [];
      return {
        async *[Symbol.asyncIterator]() {
          if (script.failWith) throw new Error(script.failWith);
          for (const d of deltas) {
            yield { delta: d };
          }
          if (script.hang) await new Promise(() => {});
        },
      };
    },
  };
}

function makeService(opts: { key?: string | null; client?: AnthropicLike }): {
  svc: ReturnType<typeof createAiService>;
  emitted: Emitted;
  dir: string;
} {
  const emitted: Emitted = [];
  const dir = mkdtempSync(join(tmpdir(), "gl-ai-"));
  const svc = createAiService({
    getSettings: () => ({
      wowDirectory: null,
      anthropicApiKey: opts.key === undefined ? "sk-test" : opts.key,
      anthropicModel: null,
    }),
    clientFactory: () => opts.client ?? fakeClient({ deltas: [] }),
    matchesDir: dir,
    emit: (channel, payload) => emitted.push({ channel, payload }),
  });
  return { svc, emitted, dir };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("ai service", () => {
  it("无 key → NO_API_KEY 错误事件", async () => {
    const { svc, emitted } = makeService({ key: null });
    await svc.analyze("m1", "ctx");
    await flush();
    const err = emitted.find((e) => e.channel === "gladlog:ai:error");
    expect(err).toBeDefined();
    expect((err!.payload as { message: string }).message).toContain(
      "NO_API_KEY",
    );
  });

  it("delta 顺序转发 + done 落盘信封", async () => {
    const { svc, emitted, dir } = makeService({
      client: fakeClient({ deltas: ["分析", "第二段"] }),
    });
    mkdirSync(join(dir, "m2"), { recursive: true });
    await svc.analyze("m2", "ctx");
    await flush();
    const deltas = emitted
      .filter((e) => e.channel === "gladlog:ai:delta")
      .map((e) => (e.payload as { text: string }).text);
    expect(deltas).toEqual(["分析", "第二段"]);
    const done = emitted.find((e) => e.channel === "gladlog:ai:done");
    expect((done!.payload as { content: string }).content).toBe("分析第二段");
    const doc = JSON.parse(
      readFileSync(join(dir, "m2", "analysis.json"), "utf-8"),
    );
    expect(doc.schemaVersion).toBe(1);
    expect(doc.content).toBe("分析第二段");
    expect(typeof doc.model).toBe("string");
    expect(typeof doc.promptVersion).toBe("number");
  });

  it("流错误 → error 事件且不落盘", async () => {
    const { svc, emitted, dir } = makeService({
      client: fakeClient({ failWith: "boom" }),
    });
    mkdirSync(join(dir, "m3"), { recursive: true });
    await svc.analyze("m3", "ctx");
    await flush();
    expect(emitted.some((e) => e.channel === "gladlog:ai:error")).toBe(true);
    expect(existsSync(join(dir, "m3", "analysis.json"))).toBe(false);
  });

  it("cancel 后不再发事件;getCached 命中缓存", async () => {
    const { svc, emitted, dir } = makeService({
      client: fakeClient({ deltas: ["a"], hang: true }),
    });
    mkdirSync(join(dir, "m4"), { recursive: true });
    void svc.analyze("m4", "ctx");
    await flush();
    await svc.cancel();
    const before = emitted.length;
    await flush();
    expect(emitted.length).toBe(before);

    const { svc: svc2, dir: dir2 } = makeService({
      client: fakeClient({ deltas: ["cached!"] }),
    });
    mkdirSync(join(dir2, "m5"), { recursive: true });
    await svc2.analyze("m5", "ctx");
    await flush();
    const cached = await svc2.getCached("m5");
    expect(cached?.content).toBe("cached!");
    expect(await svc2.getCached("nope")).toBeNull();
  });

  it("同一 match 快速二次 analyze:旧流终止,delta 不交错,done 只发一次", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const client: AnthropicLike = {
      stream: () => {
        const n = ++calls;
        return {
          async *[Symbol.asyncIterator]() {
            if (n === 1) {
              yield { delta: "a" };
              await gate;
              yield { delta: "b" };
            } else {
              yield { delta: "x" };
            }
          },
        };
      },
    };
    const { svc, emitted, dir } = makeService({ client });
    mkdirSync(join(dir, "m6"), { recursive: true });
    const first = svc.analyze("m6", "ctx");
    await flush();
    const second = svc.analyze("m6", "ctx");
    await flush();
    release();
    await Promise.all([first, second]);
    await flush();
    const deltas = emitted
      .filter((e) => e.channel === "gladlog:ai:delta")
      .map((e) => (e.payload as { text: string }).text);
    expect(deltas).toEqual(["a", "x"]);
    const dones = emitted.filter((e) => e.channel === "gladlog:ai:done");
    expect(dones).toHaveLength(1);
    expect((dones[0]!.payload as { content: string }).content).toBe("x");
    const doc = JSON.parse(
      readFileSync(join(dir, "m6", "analysis.json"), "utf-8"),
    );
    expect(doc.content).toBe("x");
  });

  it("realClientFactory:消费方提前 break → 底层 SDK 流被 abort", async () => {
    sdkAbortSpy.mockClear();
    const stream = realClientFactory("sk-test").stream({
      model: "m",
      max_tokens: 16,
      messages: [{ role: "user", content: "c" }],
    });
    for await (const event of stream) {
      expect(event.delta).toBe("hi");
      break;
    }
    expect(sdkAbortSpy).toHaveBeenCalled();
  });
});
