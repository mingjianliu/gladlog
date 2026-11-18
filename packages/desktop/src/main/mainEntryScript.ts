import { existsSync } from "fs";
import { join } from "path";

/**
 * The path of a main-process build entry (`slimWorker.js`,
 * `roundsIdxWorker.js` — electron-vite inputs written to `out/main/`) as seen
 * from the module that spawns it, given that module's own directory
 * (`import.meta.dirname`).
 *
 * The spawning module is not always in `out/main/`: a module two entries
 * import (matchStore: the main entry and the pipeline worker) is emitted as a
 * shared chunk in `out/main/chunks/`, and there `join(import.meta.dirname,
 * "slimWorker.js")` names a file that does not exist. The Worker then fails
 * to start, the caller's best-effort `catch` answers `ok: false`, and nothing
 * says so — measured on the built app (pipeline T220, 2026-11-18): a shuffle
 * whose rounds.idx.json was removed was opened and no sidecar came back, and
 * no document without the slimmed mark was healed.
 *
 * So: beside the module when it is there, else one level up; the first
 * candidate (what vitest on `src` gets, where neither exists) otherwise.
 */
export function mainEntryScript(
  moduleDir: string,
  name: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const beside = join(moduleDir, name);
  if (exists(beside)) return beside;
  const above = join(moduleDir, "..", name);
  return exists(above) ? above : beside;
}
