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
