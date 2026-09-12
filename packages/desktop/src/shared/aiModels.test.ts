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
    expect(resolveAiModel({})).toBe("claude-opus-5");
    expect(resolveAiModel({ aiBackend: "agy" })).toBe("pro");
    expect(resolveAiModel({ aiBackend: "claudeCli" })).toBe("claude-opus-5");
  });

  it("取当前后端那一格,不串用别的后端的选择", () => {
    const aiModels = { anthropic: "claude-opus-4-8", agy: "flash" };
    expect(resolveAiModel({ aiBackend: "anthropic", aiModels })).toBe(
      "claude-opus-4-8",
    );
    expect(resolveAiModel({ aiBackend: "agy", aiModels })).toBe("flash");
    // Nothing stored in the claudeCli slot -> the default, not a borrowed
    // anthropic value
    expect(resolveAiModel({ aiBackend: "claudeCli", aiModels })).toBe(
      "claude-opus-5",
    );
  });

  it("存了跨后端的非法 id 时退回默认值", () => {
    // An agy alias fed to the anthropic backend is invalid
    expect(
      resolveAiModel({
        aiBackend: "anthropic",
        aiModels: { anthropic: "pro" },
      }),
    ).toBe("claude-opus-5");
    expect(
      resolveAiModel({
        aiBackend: "agy",
        aiModels: { agy: "claude-opus-5" },
      }),
    ).toBe("pro");
  });
});

