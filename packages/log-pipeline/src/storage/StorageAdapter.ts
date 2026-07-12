/**
 * Minimal storage contract shared by the streamer (write side) and the
 * collector (read side). Deliberately tiny — 4 methods, flat keys, no
 * streaming/multipart — so a Google Drive folder (via localDir) is drop-in.
 */
export interface StorageAdapter {
  put(key: string, body: Buffer): Promise<void>;
  /** Returns keys under prefix in lexicographic order. */
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Buffer>;
  /** Idempotent: deleting a missing key resolves silently. */
  delete(key: string): Promise<void>;
}
