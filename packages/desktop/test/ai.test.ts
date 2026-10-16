import { vi, describe, expect, it } from "vitest";
import { realClientFactory } from "../src/main/ai";

const sdkAbortSpy = vi.fn();
const sdkStreamOptions: unknown[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class {
    messages = {
      stream: (_body: unknown, options?: unknown) => (
        sdkStreamOptions.push(options),
        {
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
        }
      ),
    };
  },
}));

describe("ai client factory", () => {
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

  it("realClientFactory:调用方的 signal 交给 SDK 请求本身(codex 50-SR-01 #2:挂住的 next() 期间 finally 跑不到)", async () => {
    sdkStreamOptions.length = 0;
    const ac = new AbortController();
    for await (const _ of realClientFactory("sk-test").stream({
      model: "m",
      max_tokens: 16,
      messages: [{ role: "user", content: "c" }],
      signal: ac.signal,
    }))
      break;
    for await (const _ of realClientFactory("sk-test").stream({
      model: "m",
      max_tokens: 16,
      messages: [{ role: "user", content: "c" }],
    }))
      break;
    expect(sdkStreamOptions).toEqual([{ signal: ac.signal }, undefined]);
  });
});
