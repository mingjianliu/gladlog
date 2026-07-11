import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface GladlogSettings {
  wowDirectory: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string | null;
}
const DEFAULTS: GladlogSettings = {
  wowDirectory: null,
  anthropicApiKey: null,
  anthropicModel: null,
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
  if (partial.anthropicApiKey === API_KEY_REDACTED) {
    const { anthropicApiKey: _redacted, ...rest } = partial;
    return rest;
  }
  return partial;
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
