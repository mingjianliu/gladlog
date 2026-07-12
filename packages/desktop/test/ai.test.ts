import { vi, describe, expect, it } from "vitest";
import { realClientFactory } from "../src/main/ai";

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
});

