import { readFileSync, renameSync, writeFileSync } from "fs";
import type { FileCheckpoint } from "../shared/protocol";

export interface CheckpointRegistry {
  files: Record<string, FileCheckpoint>;
}

export function loadCheckpoints(path: string): CheckpointRegistry {
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf-8"),
    ) as CheckpointRegistry;
    return parsed && typeof parsed.files === "object" && parsed.files !== null
      ? parsed
      : { files: {} };
  } catch {
    return { files: {} };
  }
}

export function saveCheckpoints(path: string, reg: CheckpointRegistry): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2));
  renameSync(tmp, path);
}
