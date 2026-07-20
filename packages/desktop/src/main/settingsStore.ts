import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

import {
  AI_BACKENDS,
  isKnownModel,
  type AiBackend,
  type AiModelSelection,
} from "../shared/aiModels";

export type { AiBackend, AiModelSelection };
export type AiLanguage = "zh" | "en";
const AI_LANGUAGES: AiLanguage[] = ["zh", "en"];

export interface GladlogSettings {
  wowDirectory: string | null;
  anthropicApiKey: string | null;
  /** 按后端分别记忆的模型;取当前生效值一律用 resolveAiModel。 */
  aiModels: AiModelSelection;
  // Debug: route LLM calls to a local CLI instead of the Anthropic API.
  aiBackend: AiBackend;
  aiBackendCommand: string | null;
  /** 教练回复输出语言(backlog #1);默认中文,与 UI 一致。 */
  aiLanguage: AiLanguage;
}
const DEFAULTS: GladlogSettings = {
  wowDirectory: null,
  anthropicApiKey: null,
  aiModels: {},
  aiBackend: "anthropic",
  aiBackendCommand: null,
  aiLanguage: "zh",
};

/** v0.0.15 及以前存的是单字段 anthropicModel;读盘时迁进 aiModels.anthropic。 */
interface LegacySettings {
  anthropicModel?: string | null;
}
function migrateLegacyModel(raw: Partial<GladlogSettings> & LegacySettings): {
  aiModels?: AiModelSelection;
} {
  const legacy = raw.anthropicModel;
  if (!legacy || raw.aiModels?.anthropic) return {};
  // 老字段是自由文本,可能是任意串 —— 只有落在白名单里才迁,否则丢弃走默认。
  return isKnownModel("anthropic", legacy)
    ? { aiModels: { ...raw.aiModels, anthropic: legacy } }
    : {};
}

// key 只存在于主进程;IPC 边界一律用哨兵替换真值(renderer 只需真值性)。
export { API_KEY_REDACTED } from "../shared/protocol";
import { API_KEY_REDACTED } from "../shared/protocol";

export function redactSettings(s: GladlogSettings): GladlogSettings {
  return {
    ...s,
    anthropicApiKey: s.anthropicApiKey ? API_KEY_REDACTED : null,
  };
}

export function sanitizeSettingsPatch(
  partial: Partial<GladlogSettings>,
): Partial<GladlogSettings> {
  let out = partial;
  if (out.anthropicApiKey === API_KEY_REDACTED) {
    const { anthropicApiKey: _redacted, ...rest } = out;
    out = rest;
  }
  // Reject an unknown aiBackend value rather than persisting garbage.
  if (out.aiBackend !== undefined && !AI_BACKENDS.includes(out.aiBackend)) {
    const { aiBackend: _bad, ...rest } = out;
    out = rest;
  }
  if (out.aiLanguage !== undefined && !AI_LANGUAGES.includes(out.aiLanguage)) {
    const { aiLanguage: _bad, ...rest } = out;
    out = rest;
  }
  // 模型:逐格按后端白名单校验,丢掉未知 id 而不是整块拒绝 —— 下拉只可能
  // 产出合法值,能走到这里的非法值来自手改配置或旧版残留。
  if (out.aiModels !== undefined) {
    const clean: AiModelSelection = {};
    for (const backend of AI_BACKENDS) {
      const id = out.aiModels?.[backend];
      if (id && isKnownModel(backend, id)) clean[backend] = id;
    }
    out = { ...out, aiModels: clean };
  }
  return out;
}

export class SettingsStore {
  constructor(private filePath: string) {}
  get(): GladlogSettings {
    try {
      const raw = JSON.parse(
        readFileSync(this.filePath, "utf-8"),
      ) as Partial<GladlogSettings> & LegacySettings;
      return { ...DEFAULTS, ...raw, ...migrateLegacyModel(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }
  save(partial: Partial<GladlogSettings>): GladlogSettings {
    const next = { ...this.get(), ...partial };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, this.filePath);
    return next;
  }
}
