import { readFileSync } from "node:fs";

import { StorageConfig } from "../config";

export interface CollectorConfig {
  storage: StorageConfig;
  outputDir: string;
  pollIntervalMs: number;
  cleanup: boolean;
}

export function loadCollectorConfig(path: string): CollectorConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Collector config not found or unreadable: ${path}`);
  }
  let json: Partial<CollectorConfig>;
  try {
    json = JSON.parse(raw) as Partial<CollectorConfig>;
  } catch {
    throw new Error(`Collector config error: invalid JSON in ${path}`);
  }
  if (
    !json.storage ||
    json.storage.provider !== "localDir" ||
    !json.storage.directory
  ) {
    throw new Error(
      `Collector config error: "storage" must be { provider:"localDir", directory } in ${path}`,
    );
  }
  if (!json.outputDir || typeof json.outputDir !== "string") {
    throw new Error(
      `Collector config error: "outputDir" (string) is required in ${path}`,
    );
  }
  return {
    storage: json.storage,
    outputDir: json.outputDir,
    pollIntervalMs: json.pollIntervalMs ?? 15000,
    cleanup: json.cleanup ?? false,
  };
}
