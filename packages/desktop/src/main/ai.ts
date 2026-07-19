import { agyClientFactory, claudeCliClientFactory } from "./localAiBackends";

// v3: candidate menu expanded — deaths tagged friendly/enemy (side fact) and
// cd-waste events (never-used defensive cooldowns) added; prompt gained an event
// legend and whole-round time display.
// v4(D2): 视角改为日志记录者(owner)—— DPS 记录者从治疗视角切到本人视角,
// 旧缓存(同 matchId 的治疗视角结果)必须失效;DPS owner 菜单新增四类事件
// (burst-into-immunity / off-target-in-window / juked-kick / dr-clipped-cc)
// 与 <burst_ledger> 块。治疗记录者 prompt 字节不变,缓存键随版本一并轮换。
export const PROMPT_VERSION = 7; // v6: death-setup 链条;v7: 深挖轮(deepDive)结果字段

export interface AnthropicLike {
  stream(params: {
    model: string;
    max_tokens: number;
    /** 教练角色 + 输出语言指令(backlog #1);本地后端拼接到 prompt 前。 */
    system?: string;
    messages: { role: "user"; content: string }[];
  }): AsyncIterable<{ delta?: string }>;
}

export type AiLanguage = "zh" | "en";

/**
 * 教练系统提示(backlog #1):角色设定 + 输出语言。语言是请求参数而非
 * prompt 构建器改动 —— PROMPT_VERSION 不 bump;时间轴 prompt 本体保持英文。
 */
export function buildCoachSystemPrompt(lang: AiLanguage): string {
  const language =
    lang === "zh"
      ? "Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English."
      : "Respond in English.";
  return `You are a World of Warcraft arena coach reviewing a player's match. Be direct, specific, and grounded strictly in the provided events. ${language}`;
}

export type AiBackend = "anthropic" | "claudeCli" | "agy";

export interface AiClientSettings {
  anthropicApiKey: string | null;
  aiBackend?: AiBackend | null;
  aiBackendCommand?: string | null;
}

/**
 * Pick the LLM client for the configured backend. Local backends (claudeCli,
 * agy) need no API key; the Anthropic backend returns null without one so the
 * service falls back to deterministic output.
 */
export function resolveAiClient(
  settings: AiClientSettings,
  anthropicFactory?: (key: string) => AnthropicLike,
): AnthropicLike | null {
  const backend = settings.aiBackend ?? "anthropic";
  const cmd = settings.aiBackendCommand || undefined;
  if (backend === "claudeCli") return claudeCliClientFactory({ cmd });
  if (backend === "agy") return agyClientFactory({ script: cmd });
  if (!settings.anthropicApiKey) return null;
  return (anthropicFactory ?? realClientFactory)(settings.anthropicApiKey);
}

export function realClientFactory(key: string): AnthropicLike {
  return {
    async *stream(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: { role: "user"; content: string }[];
    }): AsyncIterable<{ delta?: string }> {
      const { Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: key });
      const stream = await client.messages.stream({
        model: params.model,
        max_tokens: params.max_tokens,
        ...(params.system ? { system: params.system } : {}),
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
