/**
 * AI 后端与可选模型的**单一事实源**(跨进程共享)。
 *
 * 消费方三处必须 import 这里,不许各自硬编码:
 *   - main/settingsStore.ts —— 校验 patch 里的模型 id
 *   - main/analysis.ts、main/compare.ts —— 取当前后端的实际模型
 *   - renderer/components/SettingsPanel.tsx —— 渲染下拉选项
 *
 * 放 shared/ 是构建约束不是洁癖:renderer 值引入 main/* 会把 fs/path 卷进
 * renderer 包(v0.0.4 打包事故),只有 electron-vite build 才炸。
 */

export type AiBackend = "anthropic" | "claudeCli" | "agy";
export const AI_BACKENDS: AiBackend[] = ["anthropic", "claudeCli", "agy"];

export interface AiModelOption {
  /** 传给后端的实际值:Anthropic API 的 model、CLI 的 --model 实参。 */
  id: string;
  label: string;
}

/**
 * 各后端可选模型。
 * anthropic/claudeCli 用 Anthropic 官方 model id;agy 用 agy-run.mjs 的
 * `--model <alias>` 别名(见 ~/.claude/skills/agy/scripts/agy-run.mjs 的
 * MODEL_ALIASES),两套命名空间不通用,所以按后端分表。
 */
export const AI_MODELS: Record<AiBackend, AiModelOption[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  claudeCli: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  agy: [
    { id: "pro", label: "Gemini 3.1 Pro (High)" },
    { id: "pro-low", label: "Gemini 3.1 Pro (Low)" },
    { id: "flash-high", label: "Gemini 3.5 Flash (High)" },
    { id: "flash", label: "Gemini 3.5 Flash (Medium)" },
    { id: "flash-low", label: "Gemini 3.5 Flash (Low)" },
    { id: "gpt-oss", label: "GPT-OSS 120B (Medium)" },
    { id: "claude-opus", label: "Claude Opus 4.6 (Thinking)" },
    { id: "claude-sonnet", label: "Claude Sonnet 4.6 (Thinking)" },
  ],
};

/** 未显式选模型时各后端的默认值。 */
export const AI_DEFAULT_MODEL: Record<AiBackend, string> = {
  anthropic: "claude-sonnet-5",
  claudeCli: "claude-sonnet-5",
  agy: "pro",
};

/** 按后端分别记忆的模型选择;切后端不互相冲掉。 */
export type AiModelSelection = Partial<Record<AiBackend, string>>;

export function isKnownModel(backend: AiBackend, id: string): boolean {
  return AI_MODELS[backend].some((m) => m.id === id);
}

/**
 * 当前生效的模型。分析/对比/本地 CLI 三条调用路径都走这里 —— 别再写
 * `settings.anthropicModel ?? "claude-sonnet-5"` 那种散落的默认值。
 * 存了未知 id(手改配置文件、降级回退)时退回该后端默认值。
 */
export function resolveAiModel(settings: {
  aiBackend?: AiBackend | null;
  aiModels?: AiModelSelection | null;
}): string {
  const backend = settings.aiBackend ?? "anthropic";
  const picked = settings.aiModels?.[backend];
  return picked && isKnownModel(backend, picked)
    ? picked
    : AI_DEFAULT_MODEL[backend];
}
