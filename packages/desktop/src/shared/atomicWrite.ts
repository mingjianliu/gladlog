import { renameSync, unlinkSync, writeFileSync } from "fs";

/**
 * Node-only (main / worker). tmp-file + rename is the atomic-write idiom every
 * store here uses, but on Windows the final rename is not reliable: Defender,
 * an Explorer preview pane, or any other open handle on the *target* makes
 * `rename` fail with EPERM / EBUSY / EEXIST, and a bare `renameSync` then
 * leaves the fresh data stranded in `.tmp` (for the tail-reader checkpoint
 * registry that means re-reading the whole log next start). The recovery is
 * the one arenacoach-desktop's MetadataStorageService uses: drop the target,
 * wait a beat for the handle to close, retry the rename exactly once; on the
 * second failure clean the tmp file up so it never piles up.
 *
 * One helper, five call sites (matchStore ×2, recordingsStore, settingsStore,
 * worker/checkpoints) -- keep them on it so the retry policy stays single-source.
 */

export const RENAME_RETRY_DELAY_MS = 50;

/** Errno codes Windows raises when the rename target is held open. */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EEXIST", "EACCES"]);

export interface AtomicFsOps {
  writeFileSync: (path: string, data: string | Uint8Array) => void;
  renameSync: (from: string, to: string) => void;
  unlinkSync: (path: string) => void;
  sleep: (ms: number) => void;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const REAL_OPS: AtomicFsOps = {
  writeFileSync,
  renameSync,
  unlinkSync,
  sleep: sleepSync,
};

function isRetryableRenameError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_RENAME_CODES.has(code);
}

/** `rename(from, to)` with the single Windows lock retry described above.
 * Works for directories as well (the unlink of a directory target just fails
 * and is ignored; callers that swap directories already `rmSync` the target). */
export function renameWithRetrySync(
  from: string,
  to: string,
  ops: AtomicFsOps = REAL_OPS,
): void {
  try {
    ops.renameSync(from, to);
    return;
  } catch (err) {
    if (!isRetryableRenameError(err)) throw err;
  }
  try {
    ops.unlinkSync(to);
  } catch {
    // Target may already be gone, or be a directory -- the retry decides.
  }
  ops.sleep(RENAME_RETRY_DELAY_MS);
  ops.renameSync(from, to);
}

/** Write `data` to `${path}.tmp`, then rename it over `path`. On give-up the
 * tmp file is removed and the error rethrown. */
export function atomicWriteFileSync(
  path: string,
  data: string | Uint8Array,
  ops: AtomicFsOps = REAL_OPS,
): void {
  const tmp = `${path}.tmp`;
  ops.writeFileSync(tmp, data);
  try {
    renameWithRetrySync(tmp, path, ops);
  } catch (err) {
    try {
      ops.unlinkSync(tmp);
    } catch {
      // best effort
    }
    throw err;
  }
}
