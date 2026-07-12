import { readFileSync } from "fs";

export type StorageConfig = { provider: "localDir"; directory: string };

export interface AgentConfig {
  wowDirectory: string;
  hostname: string;
  flushIntervalMs: number;
  quietPeriodMs: number;
  ignoreOlderDays: number;
  storage: StorageConfig;
}

const DEFAULTS = {
  flushIntervalMs: 60000,
  quietPeriodMs: 30000,
  ignoreOlderDays: 7,
};

export function loadAgentConfig(path: string): AgentConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Config file not found or unreadable: ${path}`);
  }
  let json: Partial<AgentConfig>;
  try {
    json = JSON.parse(raw) as Partial<AgentConfig>;
  } catch {
    throw new Error(`Config error: invalid JSON in ${path}`);
  }
  if (!json.wowDirectory || typeof json.wowDirectory !== "string") {
    throw new Error(
      `Config error: "wowDirectory" (string) is required in ${path}`,
    );
  }
  if (!json.hostname || typeof json.hostname !== "string") {
    throw new Error(`Config error: "hostname" (string) is required in ${path}`);
  }
  const storage = json.storage as StorageConfig | undefined;
  if (!storage || storage.provider !== "localDir") {
    throw new Error(
      `Config error: "storage.provider" must be "localDir" in ${path}`,
    );
  }
  if (!storage.directory) {
    throw new Error(
      `Config error: "storage.directory" is required for provider localDir in ${path}`,
    );
  }
  return {
    wowDirectory: json.wowDirectory,
    hostname: json.hostname,
    flushIntervalMs: json.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
    quietPeriodMs: json.quietPeriodMs ?? DEFAULTS.quietPeriodMs,
    ignoreOlderDays: json.ignoreOlderDays ?? DEFAULTS.ignoreOlderDays,
    storage,
  };
}
