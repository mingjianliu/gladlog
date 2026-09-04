import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "fs";
import { join, resolve } from "path";

import { atomicWriteFileSync } from "../shared/atomicWrite";

/**
 * Time-window association tolerance: a recording starting later than the match
 * opening is normal (log lag), so the criterion is overlap, not containment.
 */
export const TOLERANCE_MS = 60_000;

/** I2 fix: retention cap for orphan (unassociated) recordings, computed
 * completely independently of the matched recordings' keepCount — otherwise
 * orphans squeeze out keepCount slots and evict recordings that really are
 * associated with a match (audit Important #2: prune used to sort ALL entries
 * by startedAt together, regardless of matchId).
 * 2 is chosen to cover the two in-flight candidates: "the segment currently
 * recording" plus "the segment that just ended and is still waiting for its
 * associate() message". More than that just burns disk for no benefit. */
const ORPHAN_KEEP_CAP = 2;

/** task-5 brief 复核 B4: managed mode cuts a fresh chunk every match AND every
 * idle 10 minutes, so orphans (chunks not yet claimed by an associate())
 * accumulate far faster than in bypass mode -- a chunk that just finished and
 * is still waiting for its match's meta to arrive would otherwise blow past
 * ORPHAN_KEEP_CAP=2 and get pruned before associate() ever gets to it. Any
 * orphan whose stoppedAt is within this grace window is ALWAYS kept and does
 * NOT consume an ORPHAN_KEEP_CAP slot -- only orphans that have been sitting
 * unclaimed longer than this compete for the fixed cap. 10 minutes mirrors
 * the managed idle-split cadence (recorder.ts's IDLE_SPLIT_MS) -- long enough
 * to comfortably outlast normal associate() latency, short enough that a
 * truly abandoned orphan still ages out and falls under the cap eventually. */
export const ORPHAN_GRACE_MS = 10 * 60_000;

/** Current on-disk schema version for a recordings.ndjson line. */
export const RECORDING_SCHEMA = 2 as const;

export interface RecordingEntry {
  schema: typeof RECORDING_SCHEMA;
  videoPath: string;
  /** Wall-clock epoch ms of this chunk's FIRST FRAME -- the replay side's
   * alignment anchor (shared/videoTime.ts consumes it). */
  startedAt: number;
  /** null while the chunk is still being written. */
  stoppedAt: number | null;
  /**
   * Every match carried by this chunk. Schema 1 had a scalar matchId, so a
   * chunk could only ever be claimed once -- back-to-back matches sharing one
   * recording left the second with nothing. Phase 2 records continuously and
   * splits on match boundaries, so one chunk legitimately carries several
   * matches (design doc 4.3).
   */
  matchIds: string[];
}

/** Schema 1 shape, kept only so migration can read it. */
interface LegacyEntryV1 {
  videoPath: string;
  startedAt: number;
  stoppedAt: number;
  matchId: string | null;
}

function upgrade(raw: unknown): RecordingEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Partial<RecordingEntry> & Partial<LegacyEntryV1>;
  if (typeof o.videoPath !== "string" || typeof o.startedAt !== "number") {
    return null;
  }
  const stoppedAt = typeof o.stoppedAt === "number" ? o.stoppedAt : null;
  const matchIds = Array.isArray(o.matchIds)
    ? o.matchIds.filter((m): m is string => typeof m === "string")
    : typeof o.matchId === "string"
      ? [o.matchId]
      : [];
  return {
    schema: RECORDING_SCHEMA,
    videoPath: o.videoPath,
    startedAt: o.startedAt,
    stoppedAt,
    matchIds,
  };
}

/** Overlap in milliseconds between [e.startedAt, e.stoppedAt] and
 * [meta.startTime, meta.endTime].
 * The field has been mandatory since the store was created, so in theory it is
 * never missing; this still defensively handles legacy data / hand-edited bad
 * lines without stoppedAt, returning null so the caller falls back to the old
 * "closest startedAt" criterion instead of treating it as 0 overlap and wrongly
 * sorting it last (0 overlap is a LEGITIMATE value — two segments touching but
 * not intersecting — and must not be conflated with "unknown"). */
function overlapMs(
  e: RecordingEntry,
  meta: { startTime: number; endTime: number },
): number | null {
  if (e.stoppedAt === null) return null;
  const start = Math.max(e.startedAt, meta.startTime);
  const end = Math.min(e.stoppedAt, meta.endTime);
  return Math.max(0, end - start);
}

/** Recording index (kept separate from matchStore — its self-healing path
 * rmSync's a whole match directory, so recordings must never live there).
 * One ndjson line per entry; writes back (association/pruning) rewrite the
 * whole file atomically (tmp + rename). */
export class RecordingsStore {
  constructor(
    private dir: string,
    /** I3: unindexed files (OBS crash orphans / the user's own manual
     * recordings) are only REPORTED for visibility, never deleted — this is
     * OBS's own output directory and may contain the user's manual recordings,
     * so scanning and deleting the whole directory would repeat the same class
     * of destructive act as "blindly stopping the user's recording during
     * cleanup" (see the recorder.ts weStartedRecording lesson). No-op by
     * default; in production main/index.ts wires electron-log in here. */
    private log: (msg: string) => void = () => {},
    /** Where OBS actually writes chunks (managed-OBS prefs, 2026-09-04: the
     * user may point recording at another drive). The INDEX stays in `dir`
     * regardless — entries carry absolute videoPaths, so moving the video
     * folder never orphans earlier recordings. A getter (not a value) so a
     * settings change takes effect on the next prune without rebuilding
     * the store. Defaults to `dir`, the pre-feature layout. */
    private getVideoDir: () => string = () => dir,
  ) {}
  private indexPath(): string {
    return join(this.dir, "recordings.ndjson");
  }

  list(): RecordingEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.indexPath(), "utf-8");
    } catch {
      return [];
    }
    // Per-line tolerance: one corrupt line (power-loss truncation) loses only
    // that line — a whole-file catch would let the next rewrite wipe all valid
    // history (agy flash review #2).
    const out: RecordingEntry[] = [];
    for (const l of raw.split("\n")) {
      if (l.trim() === "") continue;
      try {
        const up = upgrade(JSON.parse(l));
        if (up) out.push(up);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  private rewrite(entries: RecordingEntry[]): void {
    mkdirSync(this.dir, { recursive: true });
    atomicWriteFileSync(
      this.indexPath(),
      entries.map((e) => JSON.stringify(e)).join("\n") +
        (entries.length ? "\n" : ""),
    );
  }

  add(entry: RecordingEntry): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.indexPath(), JSON.stringify(entry) + "\n");
  }

  /** Upsert by videoPath (task-5 brief 5a, 复核 B3): `add()` is a bare
   * append with no dedup, so calling it twice for the same chunk (e.g. a
   * retried/duplicate chunk-open event from the managed backend) would
   * produce two rows pointing at the same file -- prune would then
   * double-count that file's bytes against the byte fuse, and evicting
   * either row would unlink a file the OTHER row still references. This
   * REPLACES any existing row for videoPath wholesale (fresh matchIds too --
   * open always means "a brand-new chunk just started"), never duplicates. */
  openChunk(videoPath: string, startedAt: number): void {
    const entries = this.list().filter((e) => e.videoPath !== videoPath);
    entries.push({
      schema: RECORDING_SCHEMA,
      videoPath,
      startedAt,
      stoppedAt: null,
      matchIds: [],
    });
    this.rewrite(entries);
  }

  /** Sets stoppedAt on the row matching videoPath. Missing row -> creates a
   * closed row (crash-recovery path: an openChunk that should have landed on
   * disk never made it there in this process's lifetime -- e.g. an app crash
   * between the chunk-open event and its write). startedAt is unknown in that
   * case, so it is set equal to stoppedAt rather than invented -- a reader
   * can tell startedAt===stoppedAt apart from a real (however short)
   * measurement, which is the "如实记录不许静默" standard applied to the data
   * itself, not just to logging. */
  closeChunk(videoPath: string, stoppedAt: number): void {
    const entries = this.list();
    const row = entries.find((e) => e.videoPath === videoPath);
    if (row) {
      row.stoppedAt = stoppedAt;
    } else {
      entries.push({
        schema: RECORDING_SCHEMA,
        videoPath,
        startedAt: stoppedAt,
        stoppedAt,
        matchIds: [],
      });
    }
    this.rewrite(entries);
  }

  /** Time-window overlap association; writes back on a hit. With multiple
   * candidates, the one COVERING MORE of the match's time window wins (I1 fix,
   * audit Important #1) — in a quit-and-relaunch scenario, the truncated
   * pre-quit recording A may have a startedAt right next to meta.startTime
   * (the "closest" one) yet only captured a sliver of the match opening before
   * quit cut it off, while the reconnect recording B starts later but actually
   * covers the match's ending. The old "closest startedAt to meta.startTime"
   * criterion reliably picked the useless A and left the useful B in the orphan
   * pile. Only when overlap durations tie (including both 0, or both missing
   * stoppedAt so overlapMs returns null) does it fall back to the old
   * "closest startedAt" criterion. */
  associate(meta: {
    id: string;
    startTime: number;
    endTime: number;
  }): RecordingEntry | null {
    const entries = this.list();
    // Idempotent: a chunk already carrying this match needs no write.
    const already = entries.find((e) => e.matchIds.includes(meta.id));
    if (already) return already;
    const candidates = entries.filter((e) => {
      if (!(
        e.startedAt <= meta.endTime + TOLERANCE_MS &&
        (e.stoppedAt === null || e.stoppedAt >= meta.startTime - TOLERANCE_MS)
      )) {
        return false;
      }
      // Guard against premature zero-overlap claims of an ALREADY-CLAIMED
      // neighbour (task-3 review, Important finding): the ±TOLERANCE_MS
      // window above exists to absorb log lag for a chunk that has no match
      // yet. But once a chunk already carries a match, a zero-overlap "hit"
      // almost always means meta's own chunk (recorder.ts splits a new one at
      // the match boundary) just hasn't been added to the index yet --
      // segmentClose can race behind the match meta arriving (recorder.ts
      // ~:305-306) -- and this NEIGHBOURING already-claimed chunk merely sits
      // within TOLERANCE_MS of meta's edge. Appending here would permanently
      // misattribute meta to the WRONG video and starve the real,
      // not-yet-added chunk down to orphan status, where ORPHAN_KEEP_CAP
      // deletes it shortly after. So an already-claimed chunk is only
      // eligible for a SECOND match on genuine overlap (> 0ms); a chunk with
      // matchIds.length === 0 keeps the lenient behavior above unchanged, since
      // back-to-back matches sharing one still-unclaimed chunk (the whole
      // point of schema 2) really do overlap it.
      // Do NOT simplify this away: overlapMs returns null while the chunk is
      // still recording (stoppedAt === null) -- "unknown", not "zero" -- so a
      // growing chunk that already carries a match stays eligible; only a
      // MEASURED overlap <= 0 disqualifies it.
      if (e.matchIds.length > 0) {
        const overlap = overlapMs(e, meta);
        if (overlap !== null && overlap <= 0) return false;
      }
      return true;
    });
    if (candidates.length === 0) return null;
    const hit = candidates
      .map((e) => ({ e, overlap: overlapMs(e, meta) }))
      .sort((a, b) => {
        const ao = a.overlap ?? -1;
        const bo = b.overlap ?? -1;
        if (bo !== ao) return bo - ao;
        return (
          Math.abs(a.e.startedAt - meta.startTime) -
          Math.abs(b.e.startedAt - meta.startTime)
        );
      })[0]!.e;
    hit.matchIds.push(meta.id);
    this.rewrite(entries);
    return hit;
  }

  getForMatch(matchId: string): RecordingEntry | null {
    return this.list().find((e) => e.matchIds.includes(matchId)) ?? null;
  }

  /** I3: scan the recordings directory and report, at info level, the count
   * and total size of files that are not in the index (OBS crashed mid-way and
   * never even reached StopRecord, leaving no index line; or things the user
   * recorded manually into the same directory). Deliberately does NOT delete
   * and does NOT try to distinguish "crash orphan" from "the user's own
   * recording" — the two are indistinguishable from the filesystem's point of
   * view, and guessing would repeat the destroy-user-data mistake.
   * Not covered: this log only makes the files VISIBLE so a human can clean
   * them up; it never reclaims that disk automatically. The only orphans that
   * can be handled automatically are the recorder.ts ones "gladlog started
   * itself and still remembers the startedAt for" (closeOrphanRecording, which
   * indexes the outputPath returned by stopRecord()) — the case where the OBS
   * PROCESS itself crashes and restarts (as opposed to a websocket
   * disconnection), leaving no positive evidence at all, is out of scope for
   * this fix and is honestly recorded here as a remaining gap. */
  private reportUnindexedFiles(entries: RecordingEntry[]): void {
    const videoDir = this.getVideoDir();
    let names: string[];
    try {
      names = readdirSync(videoDir);
    } catch {
      return;
    }
    const indexed = new Set(entries.map((e) => resolve(e.videoPath)));
    let count = 0;
    let bytes = 0;
    for (const name of names) {
      if (name === "recordings.ndjson" || name.endsWith(".tmp")) continue;
      const p = resolve(join(videoDir, name));
      if (indexed.has(p)) continue;
      try {
        const st = statSync(p);
        if (!st.isFile()) continue;
        count++;
        bytes += st.size;
      } catch {
        /* Races such as the file vanishing between readdir and stat — skip;
           the visibility log's ballpark numbers are unaffected */
      }
    }
    if (count > 0) {
      this.log(
        `[recordings] ${count} 个未入索引文件,共 ${(bytes / 1_000_000).toFixed(1)}MB —— ` +
          `可能是 OBS 崩溃孤儿或用户手动录像,不会自动删除,需人工核查`,
      );
    }
  }

  /** Retention: TWO gates, whichever bites first.
   * - count gate: keep the most recent `keepCount` MATCHES (not chunks -- one
   *   chunk can carry several, design doc 4.3). keepCount <= 0 disables THIS
   *   GATE ONLY; the byte fuse and the orphan cap still apply (behaviour change
   *   2026-08-02 -- a fuse you can switch off is not a fuse).
   * - byte gate: keep total on-disk size under `maxBytes`.
   * A chunk is deleted only when NONE of its matches is in the keep set, so a
   * chunk is admitted whole (its extra matches may push past keepCount).
   * Chunks still being written (stoppedAt === null) are never evicted.
   *
   * Carried over from the count-only version (I2/I4 fixes, audit Important
   * #2/#4):
   * - orphans (matchIds empty) get a SEPARATE, fixed quota (ORPHAN_KEEP_CAP) --
   *   they never squeeze out a matched chunk's keep slot. Orphans still within
   *   ORPHAN_GRACE_MS of their stoppedAt are exempt from the cap entirely
   *   (task-5 brief 复核 B4): managed mode's every-match-plus-idle-10min
   *   splitting produces orphans far faster than they can be claimed by
   *   associate(), and without this grace window a chunk still waiting on its
   *   own match's meta could be pruned before it ever gets claimed.
   * - a line is removed from the index only when unlink actually succeeded (or
   *   the file was already gone); lines whose deletion failed (e.g. the file is
   *   held open by vod:// playback on Windows) are kept in the index verbatim
   *   and retried by the next prune — which both keeps a playing link from
   *   breaking and prevents the file itself from becoming unreachable and
   *   occupying disk forever because its index line was dropped (I4: the old
   *   code swallowed the failure in catch {} and still dropped the line outside
   *   keep — a deliberately left leak). */
  prune(opts: {
    keepCount: number;
    maxBytes: number;
    /** Injected clock for the ORPHAN_GRACE_MS window; defaults to Date.now. */
    now?: () => number;
  }): {
    deleted: number;
    freedBytes: number;
  } {
    const entries = this.list();
    this.reportUnindexedFiles(entries);
    const nowFn = opts.now ?? Date.now;

    // 复核 I2 (post-review Important fix): a `stoppedAt: null` row used to be
    // immortal -- prune() never evicted it, and every quit while the managed
    // backend was mid-chunk (recorder.ts's `stop()` has no managed teardown
    // yet) left a PERMANENT null row whose bytes are still summed into
    // `running` below before the byte-fuse check runs, silently and
    // irreversibly shrinking the effective budget by that row's size forever.
    // Reclaim: a null row whose file hasn't been touched in ORPHAN_GRACE_MS
    // (or is outright missing) cannot possibly still be an active recording
    // -- a real in-progress chunk is written to continuously -- so it is
    // converted into an ordinary CLOSED row (stoppedAt = the file's own
    // mtime, the best available truth; startedAt if the file is gone
    // entirely) and folded into `closed`, where the normal grace/cap/byte
    // logic below applies to it exactly like any other orphan or matched
    // chunk. A row still within the grace window is left alone -- it may
    // genuinely be recording right now.
    const nowMs = nowFn();
    const stillLive: RecordingEntry[] = [];
    const reclaimed: RecordingEntry[] = [];
    for (const e of entries.filter((row) => row.stoppedAt === null)) {
      let mtimeMs: number | null;
      try {
        mtimeMs = statSync(e.videoPath).mtimeMs;
      } catch {
        mtimeMs = null; // file missing -- definitely stale, nothing left to write to
      }
      const stale = mtimeMs === null || nowMs - mtimeMs >= ORPHAN_GRACE_MS;
      if (stale) {
        reclaimed.push({ ...e, stoppedAt: mtimeMs ?? e.startedAt });
      } else {
        stillLive.push(e);
      }
    }
    const live = stillLive;
    const closed = [
      ...entries.filter((e) => e.stoppedAt !== null),
      ...reclaimed,
    ].sort((a, b) => b.startedAt - a.startedAt);

    // Fail-safe count gate (mirrors the maxBytes treatment below, CRITICAL
    // fix, review 2026-08-03): a keepCount that is not a finite number must
    // mean "count gate off", never "admit nothing". "abc" / {} / undefined all
    // fail `<= 0` (NaN comparisons are false), so the OLD gate looked "on" --
    // yet `keptMatches.size < opts.keepCount` is ALSO NaN-false forever, so
    // nothing is ever admitted and every closed entry with a non-empty
    // matchIds gets unlinked. Worse, the byte loop further down only walks the
    // (now-empty) keep set, so the maxBytes fuse never even runs -- a bad
    // keepCount silently bypassed both gates and wiped the library. Coerce up
    // front so countGateOff and the admits comparison agree on the same safe
    // value (0 -> gate off), exactly like maxBytes's Number.isFinite guard.
    const keepCount = Number.isFinite(opts.keepCount) ? opts.keepCount : 0;
    const countGateOff = keepCount <= 0;
    const keptMatches = new Set<string>();
    const keep = new Set<RecordingEntry>();
    const orphans: RecordingEntry[] = [];
    for (const e of closed) {
      if (e.matchIds.length === 0) {
        orphans.push(e);
        continue;
      }
      const admits =
        countGateOff ||
        e.matchIds.some(
          (m) => keptMatches.has(m) || keptMatches.size < keepCount,
        );
      if (admits) {
        for (const m of e.matchIds) keptMatches.add(m);
        keep.add(e);
      }
    }
    // Grace-window orphans are always kept and never touch the fixed cap;
    // `closed` (and therefore `orphans`, filtered from it) is already sorted
    // newest-first, so `.slice(0, ORPHAN_KEEP_CAP)` on the remainder still
    // keeps the newest non-grace orphans, exactly as before this split.
    // (`nowMs` is the same clock reading captured above for the stale-null
    // reclaim pass -- one `now()` call per prune(), not one per phase.)
    const graceOrphans = orphans.filter(
      (e) => e.stoppedAt !== null && nowMs - e.stoppedAt < ORPHAN_GRACE_MS,
    );
    const agedOrphans = orphans.filter((e) => !graceOrphans.includes(e));
    for (const e of graceOrphans) keep.add(e);
    for (const e of agedOrphans.slice(0, ORPHAN_KEEP_CAP)) keep.add(e);

    const sizeOf = (e: RecordingEntry): number => {
      try {
        return statSync(e.videoPath).size;
      } catch {
        return 0;
      }
    };
    // Fail-safe byte gate: a maxBytes that is not a finite number > 0 must
    // mean "byte gate off", never "evict everything". This guard lives HERE,
    // not only in settingsStore's sanitizer, because SettingsStore.get() is a
    // plain {...DEFAULTS, ...raw} merge with no sanitize pass on READ -- a
    // hand-edited settings.json (or any other value that slips past the
    // sanitizer on the write side) reaches prune() unvalidated. Without this,
    // maxBytes: 0 or maxBytes: null both make `running + sz > maxBytes` true
    // for every entry (0 > null coerces the same way), silently deleting the
    // user's entire library on the very next prune (review finding,
    // 2026-08-03).
    const maxBytes =
      Number.isFinite(opts.maxBytes) && opts.maxBytes > 0
        ? opts.maxBytes
        : Number.POSITIVE_INFINITY;
    let running = live.reduce((n, e) => n + sizeOf(e), 0);
    for (const e of closed) {
      if (!keep.has(e)) continue;
      const sz = sizeOf(e);
      if (running + sz > maxBytes) {
        // `continue`, not `break`, is deliberate: `closed` is sorted newest
        // first, so a single oversized entry near the front must not stop the
        // scan and spare every OLDER (smaller / already-under-budget) entry
        // behind it from being counted into `running`. The intended failure
        // mode is "the newest oversized chunk gets evicted, older ones
        // survive" (retention favors recency, not insertion order) -- do not
        // "fix" this to `break` later, that would make one big chunk block
        // eviction of everything after it and let the byte fuse quietly stop
        // working.
        keep.delete(e);
        continue;
      }
      running += sz;
    }

    let deleted = 0;
    let freedBytes = 0;
    const survivors: RecordingEntry[] = [];
    for (const e of closed) {
      if (keep.has(e)) continue;
      const sz = sizeOf(e);
      let removed = true;
      try {
        if (existsSync(e.videoPath)) unlinkSync(e.videoPath);
      } catch {
        // Held open by vod:// playback on Windows -- keep the line and retry
        // next prune, so the file never becomes unreachable-but-on-disk (I4).
        removed = false;
      }
      if (removed) {
        deleted++;
        freedBytes += sz;
      } else {
        survivors.push(e);
      }
    }
    // 复核 I2: a reclaimed stale-null row (see above) must still be flushed to
    // disk even when this particular call evicts nothing -- otherwise the
    // conversion is pure in-memory bookkeeping for this one call, `list()`
    // keeps handing every OTHER caller (associate(), getForMatch()) the stale
    // `stoppedAt: null` shape forever, and the row is stuck re-deriving
    // "stale" from a stat() on every future prune() instead of the cheap
    // stoppedAt!==null check the rest of the codebase already assumes.
    if (deleted === 0 && survivors.length === 0 && reclaimed.length === 0) {
      return { deleted: 0, freedBytes: 0 };
    }
    this.rewrite([...live, ...closed.filter((e) => keep.has(e)), ...survivors]);
    // Visibility for an otherwise-silent deletion (review finding, 2026-08-03):
    // prune() now runs from failure paths and at every app startup, not just
    // the one success-path call site it used to have -- so a no-log delete
    // would mean the first launch after upgrade silently frees disk with no
    // trace anywhere. Deliberately only when deleted > 0: a no-op sweep (the
    // common case, called on every segment close) must not spam the log.
    if (deleted > 0) {
      this.log(
        `[recordings] 清理 ${deleted} 个过期录像,释放 ${(freedBytes / 1_000_000).toFixed(1)}MB`,
      );
    }
    return { deleted, freedBytes };
  }
}
