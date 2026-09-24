import {
  abortAllDeepSeekStreams,
  deepseekClientFactory,
} from "./deepseekClient";
import {
  agyClientFactory,
  claudeCliClientFactory,
  codebuddyClientFactory,
  codexClientFactory,
  killAllCliChildren,
} from "./localAiBackends";

/**
 * Called from the quitLifecycle exit hook (#21 item9, a completeness fix rather
 * than a bug -- once the host process exits these connections/child processes
 * would die or be orphaned and reaped by the OS anyway): tears down the
 * in-flight local CLI child processes (claude/agy/codex) together with the
 * DeepSeek fetches instead of each side remembering its own list. Each
 * backend's own tracking set (activeChildren/activeControllers) stays in its
 * own module -- this is only the aggregate entry point.
 */
export function stopAllAiActivity(): void {
  killAllCliChildren();
  abortAllDeepSeekStreams();
}

export { PROMPT_VERSION } from "../shared/promptVersion";

export interface AnthropicLike {
  stream(params: {
    model: string;
    max_tokens: number;
    /** Coach persona + output-language instruction (backlog #1); local backends
     * prepend it to the prompt. */
    system?: string;
    messages: { role: "user"; content: string }[];
    /** coach chat (2026-08-02 spec): claudeCli only -- the caller generates a
     * UUID, the factory appends `--session-id <hint>` and yields
     * {sessionId: hint} after the text. */
    sessionIdHint?: string;
    /** coach chat: agy/codex only -- switches to an output format from which
     * the session id can be captured and yields {sessionId}. A failed capture
     * does not throw, it just means no sessionId event. */
    captureSession?: boolean;
    /** Seed-phase stop fix (final review F1): coach chat's new-session seeding
     * (seedNewSession in coachChat.ts) used to accept an AbortSignal but never
     * pass it down, so pressing "stop" could not kill the local CLI child
     * process that was seeding. The three local CLI factories
     * (claudeCliClientFactory/agyClientFactory/codexClientFactory) forward it
     * to defaultRun via the Runner's 4th parameter for a real SIGKILL;
     * realClientFactory (the Anthropic API) and deepseek may ignore this
     * parameter -- they each have their own cancellation path and are out of
     * scope for this fix. */
    signal?: AbortSignal;
  }): AsyncIterable<{ delta?: string; sessionId?: string }>;
}

export type AiLanguage = "zh" | "en";

/**
 * Coach system prompt (backlog #1): persona plus output language. The language
 * is a request parameter, not a prompt-builder change -- PROMPT_VERSION is not
 * bumped, and the timeline prompt itself stays in English.
 */
export function buildCoachSystemPrompt(lang: AiLanguage): string {
  const language =
    lang === "zh"
      ? "Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English exactly as written in the data — never translate them into Chinese, even inline; you may explain them in Chinese, but the name token itself must stay English."
      : "Respond in English.";
  return `You are a World of Warcraft arena coach reviewing a player's match. Be direct, specific, and grounded strictly in the provided events. ${language}`;
}

export type { AiBackend } from "../shared/aiModels";
import type { AiBackend, AiModelSelection } from "../shared/aiModels";

interface AiClientSettings {
  anthropicApiKey: string | null;
  deepseekApiKey?: string | null;
  aiBackend?: AiBackend | null;
  aiBackendCommand?: string | null;
  /**
   * resolveAiClient never reads this field itself (backend alone is enough to
   * pick the factory) -- it is listed only so that the merged backendOverride
   * snapshot run() passes in as {...settings, aiBackend, aiModels} does not
   * trip TS's excess-property check (the caller and resolveAiModel share one
   * settings snapshot, so the field shapes should match).
   */
  aiModels?: AiModelSelection | null;
}

/**
 * Pick the LLM client for the configured backend. Local backends (claudeCli,
 * agy, codex) need no API key; the Anthropic backend returns null without one
 * so the service falls back to deterministic output.
 */
export function resolveAiClient(
  settings: AiClientSettings,
  anthropicFactory?: (key: string) => AnthropicLike,
): AnthropicLike | null {
  const backend = settings.aiBackend ?? "anthropic";
  const cmd = settings.aiBackendCommand || undefined;
  if (backend === "claudeCli") return claudeCliClientFactory({ cmd });
  // When cmd ends in .mjs, agyClientFactory internally uses the legacy wrapper-
  // script compatibility mode
  if (backend === "agy") return agyClientFactory({ cmd });
  if (backend === "codex") return codexClientFactory({ cmd });
  if (backend === "codebuddy") return codebuddyClientFactory({ cmd });
  // Official DeepSeek API: same semantics as anthropic -- no key -> null ->
  // deterministic fallback
  if (backend === "deepseek")
    return settings.deepseekApiKey
      ? deepseekClientFactory(settings.deepseekApiKey)
      : null;
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
        // Ensure the underlying HTTP stream is torn down when the consumer
        // breaks early (cancellation)
        stream.abort();
      }
    },
  };
}
