/** The pure-logic part of archiving the collector's reconstructed own logs to
 * Google Drive. The spawn shell lives in scripts/archiveOwnLogs.ts; only
 * unit-testable selection and manifest handling live here.
 *
 * Two rules this module exists to enforce:
 *  - Nothing on Drive is ever deleted (see the copy-not-sync test in
 *    ownLogArchive.test.ts) — the Drive copy is the permanent one, the local
 *    21GB is not.
 *  - A session archived while the streamer was still appending is a truncated
 *    snapshot; dedup by filename alone would pin that truncation forever, so
 *    the manifest keys on (name, source size) and a grown file is re-archived.
 */

/** A file is considered still-being-written if it changed this recently.
 * The relay flushes every 60s, so a minute of quiet is not enough to conclude
 * a session ended; ten is. Cheap to be wrong in the safe direction — a settled
 * file simply waits for the next run. */
export const OWN_LOG_QUIET_MS = 10 * 60 * 1000;

interface OwnLogFile {
  name: string;
  size: number;
  mtimeMs: number;
}

/** name -> source (uncompressed) byte size at the time it was archived. */
export type OwnLogManifest = Record<string, number>;

/** Collector output names are `<logFileName>.<hostname>.<gen8>.txt`
 * (log-pipeline's outputNameFor). Matching the WoWCombatLog prefix and the
 * .txt suffix keeps out `.DS_Store`, the manifest, and our own `.txt.gz`. */
export function isOwnLogName(name: string): boolean {
  return name.startsWith("WoWCombatLog-") && name.endsWith(".txt");
}

export function gzNameFor(name: string): string {
  return `${name}.gz`;
}

export function parseOwnLogManifest(text: string): OwnLogManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: OwnLogManifest = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function serializeOwnLogManifest(m: OwnLogManifest): string {
  const sorted = Object.keys(m).sort();
  return `${JSON.stringify(Object.fromEntries(sorted.map((k) => [k, m[k]])), null, 2)}\n`;
}

/** Which local logs still need uploading: never archived, or archived at a
 * smaller size (the streamer appended after the snapshot). Files touched
 * within the quiet period are left alone entirely — archiving a session mid-write
 * just guarantees a re-upload next run. */
export function selectOwnLogsToArchive(opts: {
  files: OwnLogFile[];
  manifest: OwnLogManifest;
  nowMs: number;
  quietMs?: number;
}): OwnLogFile[] {
  const quiet = opts.quietMs ?? OWN_LOG_QUIET_MS;
  return opts.files.filter((f) => {
    if (!isOwnLogName(f.name)) return false;
    if (opts.nowMs - f.mtimeMs < quiet) return false;
    const archived = opts.manifest[f.name];
    return archived === undefined || archived !== f.size;
  });
}
