import { describe, expect, it } from "vitest";

import {
  AI_BACKENDS,
  AI_DEFAULT_MODEL,
  AI_MODELS,
  isKnownModel,
  resolveAiModel,
} from "./aiModels";

describe("aiModels catalog", () => {
  it("每个后端都有非空模型表,且默认值在表内", () => {
    for (const backend of AI_BACKENDS) {
      expect(AI_MODELS[backend].length).toBeGreaterThan(0);
      expect(isKnownModel(backend, AI_DEFAULT_MODEL[backend])).toBe(true);
    }
  });

  it("同一后端内 model id 不重复", () => {
    for (const backend of AI_BACKENDS) {
      const ids = AI_MODELS[backend].map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("resolveAiModel", () => {
  it("无设置时按后端取默认值", () => {
    expect(resolveAiModel({})).toBe("claude-sonnet-5");
    expect(resolveAiModel({ aiBackend: "agy" })).toBe("pro");
    expect(resolveAiModel({ aiBackend: "claudeCli" })).toBe("claude-sonnet-5");
  });

  it("取当前后端那一格,不串用别的后端的选择", () => {
    const aiModels = { anthropic: "claude-opus-4-8", agy: "flash" };
    expect(resolveAiModel({ aiBackend: "anthropic", aiModels })).toBe(
      "claude-opus-4-8",
    );
    expect(resolveAiModel({ aiBackend: "agy", aiModels })).toBe("flash");
    // claudeCli 那格没存 → 默认值,而不是借用 anthropic 的
    expect(resolveAiModel({ aiBackend: "claudeCli", aiModels })).toBe(
      "claude-sonnet-5",
    );
  });

  it("存了跨后端的非法 id 时退回默认值", () => {
    // agy 别名喂给 anthropic 后端 = 无效
    expect(
      resolveAiModel({
        aiBackend: "anthropic",
        aiModels: { anthropic: "pro" },
      }),
    ).toBe("claude-sonnet-5");
    expect(
      resolveAiModel({
        aiBackend: "agy",
        aiModels: { agy: "claude-sonnet-5" },
      }),
    ).toBe("pro");
  });
});
