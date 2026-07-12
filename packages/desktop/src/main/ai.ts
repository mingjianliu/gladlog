export const PROMPT_VERSION = 2;

export interface AnthropicLike {
  stream(params: {
    model: string;
    max_tokens: number;
    messages: { role: "user"; content: string }[];
  }): AsyncIterable<{ delta?: string }>;
}

export function realClientFactory(key: string): AnthropicLike {
  return {
    async *stream(params: {
      model: string;
      max_tokens: number;
      messages: { role: "user"; content: string }[];
    }): AsyncIterable<{ delta?: string }> {
      const { Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: key });
      const stream = await client.messages.stream({
        model: params.model,
        max_tokens: params.max_tokens,
        messages: params.messages,
      });

      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            yield { delta: event.delta.text };
          }
        }
      } finally {
        // 消费方提前 break(取消)时确保底层 HTTP 流被挂断
        stream.abort();
      }
    },
  };
}
