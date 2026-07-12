import { readFileSync, renameSync, writeFileSync } from "fs";

export interface FileCheckpoint {
  offset: number;
  firstLineChecksum: string;
}

export interface AgentState {
  files: Record<string, FileCheckpoint>;
}

/** Missing or corrupt state file → start fresh (worst case: re-upload, which is idempotent). */
export function loadState(path: string): AgentState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as AgentState;
    return parsed && typeof parsed.files === "object" && parsed.files !== null
      ? parsed
      : { files: {} };
  } catch {
    return { files: {} };
  }
}

/** Registry-file pattern: flush state after every acked upload, atomically. */
export function saveState(path: string, state: AgentState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}
