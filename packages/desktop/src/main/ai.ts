import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export const PROMPT_VERSION = 1;

export interface AnthropicLike {
  stream(params: {
    model: string;
    max_tokens: number;
    messages: { role: "user"; content: string }[];
  }): AsyncIterable<{ delta?: string }>;
}

export type AiService = ReturnType<typeof createAiService>;

export function createAiService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    anthropicModel: string | null;
    wowDirectory: string | null;
  };
  clientFactory?: (key: string) => AnthropicLike;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
}): {
  analyze(matchId: string, context: string): Promise<void>;
  cancel(): Promise<void>;
  getCached(
    matchId: string,
  ): Promise<{ content: string; model: string; createdAt: number } | null>;
} {
  let currentAnalysisId: string | null = null;
  let cancelRequested = false;

  return {
    async analyze(matchId: string, context: string): Promise<void> {
      // Cancel previous analysis
      if (currentAnalysisId !== null) {
        cancelRequested = true;
      }
      currentAnalysisId = matchId;
      cancelRequested = false;

      const settings = deps.getSettings();
      const model = settings.anthropicModel ?? "claude-sonnet-5";

      if (!settings.anthropicApiKey) {
        deps.emit("gladlog:ai:error", {
          matchId,
          message: "NO_API_KEY: Anthropic API key not configured",
        });
        return;
      }

      try {
        const client = deps.clientFactory
          ? deps.clientFactory(settings.anthropicApiKey)
          : realClientFactory(settings.anthropicApiKey);

        let fullContent = "";
        const stream = client.stream({
          model,
          max_tokens: 2048,
          messages: [{ role: "user", content: context }],
        });

        for await (const event of stream) {
          if (cancelRequested || currentAnalysisId !== matchId) {
            break;
          }
          if (event.delta) {
            fullContent += event.delta;
            deps.emit("gladlog:ai:delta", { matchId, text: event.delta });
          }
        }

        if (cancelRequested || currentAnalysisId !== matchId) {
          return;
        }

        // Write to disk atomically
        const matchDir = join(deps.matchesDir, matchId);
        mkdirSync(matchDir, { recursive: true });
        const tmpPath = join(matchDir, "analysis.json.tmp");
        const finalPath = join(matchDir, "analysis.json");

        const doc = {
          schemaVersion: 1,
          model,
          promptVersion: PROMPT_VERSION,
          createdAt: Date.now(),
          content: fullContent,
        };

        writeFileSync(tmpPath, JSON.stringify(doc), "utf-8");
        // Atomic rename
        const fs = require("fs");
        fs.renameSync(tmpPath, finalPath);

        deps.emit("gladlog:ai:done", { matchId, content: fullContent });
      } catch (err) {
        if (cancelRequested || currentAnalysisId !== matchId) {
          return;
        }
        deps.emit("gladlog:ai:error", {
          matchId,
          message: `${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    async cancel(): Promise<void> {
      cancelRequested = true;
      currentAnalysisId = null;
    },

    async getCached(
      matchId: string,
    ): Promise<{ content: string; model: string; createdAt: number } | null> {
      const filepath = join(deps.matchesDir, matchId, "analysis.json");
      if (!existsSync(filepath)) {
        return null;
      }
      try {
        const data = JSON.parse(readFileSync(filepath, "utf-8"));
        return {
          content: data.content,
          model: data.model,
          createdAt: data.createdAt,
        };
      } catch {
        return null;
      }
    },
  };
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

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { delta: event.delta.text };
        }
      }
    },
  };
}
