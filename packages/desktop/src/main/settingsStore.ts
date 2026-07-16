import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

export type AiBackend = "anthropic" | "claudeCli" | "agy";
const AI_BACKENDS: AiBackend[] = ["anthropic", "claudeCli", "agy"];
export type AiLanguage = "zh" | "en";
const AI_LANGUAGES: AiLanguage[] = ["zh", "en"];

export interface GladlogSettings {
  wowDirectory: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string | null;
  // Debug: route LLM calls to a local CLI instead of the Anthropic API.
  aiBackend: AiBackend;
  aiBackendCommand: string | null;
  /** 教练回复输出语言(backlog #1);默认中文,与 UI 一致。 */
  aiLanguage: AiLanguage;
}
const DEFAULTS: GladlogSettings = {
  wowDirectory: null,
  anthropicApiKey: null,
  anthropicModel: null,
  aiBackend: "anthropic",
  aiBackendCommand: null,
  aiLanguage: "zh",
};

// key 只存在于主进程;IPC 边界一律用哨兵替换真值(renderer 只需真值性)。
export const API_KEY_REDACTED = "__gladlog_api_key_set__";

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
  return out;
}

export class SettingsStore {
  constructor(private filePath: string) {}
  get(): GladlogSettings {
    try {
      return {
        ...DEFAULTS,
        ...(JSON.parse(
          readFileSync(this.filePath, "utf-8"),
        ) as Partial<GladlogSettings>),
      };
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
