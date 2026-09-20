import {
  checkStructuralCompleteness,
  type CompletenessCode,
  type GladMatch,
  type GladShuffle,
} from "@gladlog/parser";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  promises as fsp,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { Worker } from "worker_threads";

import {
  atomicWriteFileSync,
  renameWithRetrySync,
} from "../shared/atomicWrite";
import { nullFiller } from "../shared/roundOffsets";

/** rounds.idx.json shape (written by roundsIdxWorker; size/mtime guard the
 * offsets against any rewrite of match.json). */
interface RoundsIdx {
  v: 1;
  fileSize: number;
  mtimeMs: number;
  arrayOpenEnd: number;
  arrayClose: number;
  rounds: Array<[number, number]>;
}

// slimStoredDoc moved to src/shared/slimDoc.ts (single-source predicate): the
// whole-library migration script, the self-heal worker (slimWorker.ts) and the
// preload parse fallback all consume the same function.

/** LRU total-byte ceiling. The old version kept 2 **fully parsed object
 * graphs** by count (2 p75-sized matches ≈ 1-2GB resident in main, 2026-07-26
 * audit); with raw byte pass-through we only keep the original Buffer and cap
 * by total bytes — 256MB ≈ median size (77MB)×3, or p75 (167MB) + median. */
const LRU_MAX_BYTES = 256 * 1024 * 1024;
const LRU_MAX_ENTRIES = 2;

interface CacheEntry {
  id: string;
  data: Buffer;
}

class MatchLruCache {
  private entries: CacheEntry[] = [];

  private totalBytes(): number {
    return this.entries.reduce((s, e) => s + e.data.length, 0);
  }

  get(id: string): Buffer | undefined {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return undefined;
    const entry = this.entries[idx]!;
    this.entries.splice(idx, 1);
    this.entries.unshift(entry);
    return entry.data;
  }

  set(id: string, data: Buffer): void {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }
    // Single item over the cap (442MB-class shuffle): don't cache, let disk
    // reads go through the OS page cache.
    if (data.length > LRU_MAX_BYTES) return;
    this.entries.unshift({ id, data });
    while (
      this.entries.length > LRU_MAX_ENTRIES ||
      this.totalBytes() > LRU_MAX_BYTES
    ) {
      this.entries.pop();
    }
  }

  delete(id: string): void {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) this.entries.splice(idx, 1);
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Stream out the n-th line (0-based, line delimiter = \n, byte-for-byte
 * equivalent to `content.split("\n")[n]`, keeping the trailing \r of CRLF
 * files as-is). The old implementation read all of raw.txt and split it — to
 * get one line it paid "median 12MB / max 74MB read + whole-file split" in
 * main-thread freeze and transient garbage (2026-07-26 audit); here we scan
 * for \n in 1MB chunks (\n is single-byte in UTF-8, so chunk boundaries are
 * safe) and stop early on a hit. Out-of-range line numbers return null
 * (equivalent to split's undefined).
 */
export async function readNthLine(
  filePath: string,
  n: number,
): Promise<string | null> {
  const fh = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let newlines = 0;
    let collecting = n === 0;
    const parts: Buffer[] = [];
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break; // EOF: still collecting = last line has no \n
      const view = buf.subarray(0, bytesRead);
      let pos = 0;
      while (pos <= view.length) {
        const nl = view.indexOf(0x0a, pos);
        if (collecting) {
          const end = nl === -1 ? view.length : nl;
          parts.push(Buffer.from(view.subarray(pos, end)));
          if (nl !== -1) return Buffer.concat(parts).toString("utf-8");
          break; // line not finished, read the next chunk
        }
        if (nl === -1) break; // no more line starts in this chunk
        newlines++;
        pos = nl + 1;
        if (newlines === n) collecting = true;
      }
    }
    return collecting ? Buffer.concat(parts).toString("utf-8") : null;
  } finally {
    await fh.close();
  }
}

/** Spawn slimWorker (out/main/slimWorker.js, an electron-vite build entry).
 * When vitest runs src directly that build output does not exist → fail
 * gracefully (self-heal is best-effort only).
 * The main bundle is ESM ("type":"module"), so __dirname does not exist — we
 * must use import.meta.dirname (agy review F1: with __dirname the call throws
 * ReferenceError, gets swallowed by the catch, and self-heal silently stops
 * working in production). */
function runSlimHealWorker(filePath: string): Promise<{
  ok: boolean;
  changed?: boolean;
  roundLinesTotal?: Array<{ seq: number; lines: number }>;
}> {
  return new Promise((resolve) => {
    try {
      const worker = new Worker(join(import.meta.dirname, "slimWorker.js"), {
        workerData: { filePath },
      });
      worker.on("message", (msg) => {
        resolve(msg as { ok: boolean });
        void worker.terminate();
      });
      worker.on("error", () => {
        resolve({ ok: false });
        void worker.terminate();
      });
      worker.on("exit", (code) => {
        if (code !== 0) resolve({ ok: false });
      });
    } catch {
      resolve({ ok: false });
    }
  });
}

function parseMatchFileInWorker(filePath: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    const code = `
      const { parentPort, workerData } = require('worker_threads');
      const { readFileSync } = require('fs');
      try {
        const content = readFileSync(workerData.filePath, 'utf8');
        const parsed = JSON.parse(content);
        parentPort.postMessage({ success: true, data: parsed });
      } catch (err) {
        parentPort.postMessage({ success: false, error: err.message });
      }
    `;
    const worker = new Worker(code, {
      eval: true,
      workerData: { filePath },
    });
    worker.on("message", (msg) => {
      if (msg.success) {
        resolve(msg.data);
      } else {
        resolve(null);
      }
      worker.terminate();
    });
    worker.on("error", () => {
      resolve(null);
      worker.terminate();
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        resolve(null);
      }
    });
  });
}

export interface StoredMatchMeta {
  id: string;
  kind: "match" | "shuffle";
  bracket: string;
  zoneId: string;
  startTime: number;
  endTime: number;
  result: string;
  storedAt: number;
  // ── Rich-row fields (2026-07-17 backlog #7) — all optional; when an old
  //    index row lacks them the list falls back to the plain-text style.
  //    Old data can be backfilled once via rebuildIndex(). ──
  durationS?: number;
  /** Average personal rating of our team; null when no rating data. */
  avgRating?: number | null;
  /** The two spec groups [ours, theirs] (only the ids rendering needs, no
   * names). */
  teams?: Array<Array<{ specId: number; classId: number }>>;
  /** Recording character's name (to tell multi-character records apart; old
   * rows lack it → backfilled by rebuilding the index). */
  playerName?: string;
  /** The recorder's own personal rating (used for the rating curve; the team
   * average avgRating is kept as a fallback). */
  playerRating?: number | null;
  /** Number of events in this match (definition: see EVENT_ARRAY_FIELDS —
   * only the caster-side arrays are summed). Used by the developer page's fact
   * card: computing it on demand means walking the whole doc, exactly the long
   * task the lazily-expanded tree exists to avoid, so it is computed at write
   * time. Field missing = an old row that never computed it (rebuildIndex can
   * backfill); 0 = genuinely no events. */
  eventCount?: number;
  /** The doc has been slimmed per the slim predicate (slim at write time /
   * backfilled by the whole-library migration). Missing = old fat file, and
   * the read path uses that to trigger background self-heal. */
  slimmed?: boolean;
  /** Per-round {seq: sequenceNumber, lines: linesTotal} for a shuffle
   * (ascending seq) — used by rawLine provenance to compute the raw.txt line
   * offset (predicate: seq < roundSeq; round numbers are not guaranteed to
   * start at 0 or be contiguous, so seq must be carried), avoiding parsing the
   * whole doc just to fetch one line. */
  roundLinesTotal?: Array<{ seq: number; lines: number }>;
  /** Per-round win/loss + that round's enemy specs for a shuffle (ascending
   * seq; the 1e convention: win rate is per round and the matchup dimension
   * uses the round's enemy group — a shuffle swaps sides every round, and
   * meta.teams only holds the R1 roster).
   * Old rows lack it → backfilled by rebuildIndex. */
  roundStats?: Array<{ win: boolean; enemySpecIds: number[] }>;
  /** Structural completeness codes from the parser's
   * checkStructuralCompleteness (shuffle not 6 rounds, a round with no
   * decisive death, roster size off for the bracket, match with no result),
   * deduplicated. `[]` = checked and complete; missing = an old row that was
   * never checked (rebuildIndex backfills). Measured 2026-08-29 over the
   * 1245-match corpus: 15/494 docs flagged (14 partial shuffles, 1 2v2 with a
   * 3-player roster). The list row shows a "partial" badge when non-empty. */
  structuralIssues?: CompletenessCode[];
}

/** Distinct completeness codes for a doc (order of first occurrence). */
function structuralIssueCodes(
  doc: GladMatch | GladShuffle,
): CompletenessCode[] {
  const out: CompletenessCode[] = [];
  for (const i of checkStructuralCompleteness(doc)) {
    if (!out.includes(i.code)) out.push(i.code);
  }
  return out;
}

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, "_");

interface RosterUnitLike {
  kind?: string;
  name?: string;
  specId?: number;
  classId?: number;
  info?: { teamId?: number; personalRating?: number } | null;
}

/**
 * What "event count" means (the developer page's fact card).
 *
 * **Only the caster-side arrays are summed**: one hit is stored twice — in the
 * caster's damageOut and in the target's damageIn — so counting both would
 * count every log line twice and the number could no longer be compared
 * against linesTotal. advancedSamples are periodic position/resource samples,
 * not log events, and are excluded too.
 *
 * Both store() and rebuildIndex() compute this through metaExtras: one
 * definition, two consumers — do not write another summation elsewhere.
 */
const EVENT_ARRAY_FIELDS = [
  "damageOut",
  "healOut",
  "absorbsOut",
  "casts",
  "petCasts",
  "auraEvents",
  "actionsOut",
  "deaths",
  "unconsciousEvents",
] as const;

/** Per-round win/loss + matchup specs for a shuffle (1e): shared by store and
 * rebuildIndex.
 * Degenerate rows missing playerTeamId: win=false, empty enemy group — the
 * consumer (dashboard) skips them as "no round data", so nothing is
 * miscounted. */
function shuffleRoundStats(
  rounds: Array<{
    winningTeamId?: number | null;
    playerTeamId?: number | null;
    sequenceNumber?: number;
    units?: Record<string, RosterUnitLike>;
  }>,
): Array<{ win: boolean; enemySpecIds: number[] }> {
  return [...rounds]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map((r) => {
      const enemySpecIds: number[] = [];
      if (r.playerTeamId != null) {
        for (const u of Object.values(r.units ?? {})) {
          if (u.kind !== "Player" || !u.info) continue;
          if (u.info.teamId !== r.playerTeamId)
            enemySpecIds.push(u.specId ?? 0);
        }
      }
      enemySpecIds.sort((a, b) => a - b);
      return {
        win: r.winningTeamId != null && r.winningTeamId === r.playerTeamId,
        enemySpecIds,
      };
    });
}

/** Extract the rich-row fields from a match doc (at store time the full doc is
 * already in hand, so this costs zero extra IO). */
function metaExtras(src: {
  startTime: number;
  endTime: number;
  playerTeamId?: number;
  playerId?: string;
  units?: Record<string, RosterUnitLike>;
}): Pick<
  StoredMatchMeta,
  | "durationS"
  | "avgRating"
  | "teams"
  | "playerName"
  | "playerRating"
  | "eventCount"
> {
  const durationS = Math.max(
    0,
    Math.round((src.endTime - src.startTime) / 1000),
  );
  const own: Array<{ specId: number; classId: number }> = [];
  const foe: Array<{ specId: number; classId: number }> = [];
  const ratings: number[] = [];
  // Event count: sum of the caster-side arrays over all units (pets/NPCs
  // included); for the exact definition see EVENT_ARRAY_FIELDS
  let eventCount = 0;
  for (const u of Object.values(src.units ?? {})) {
    const bag = u as unknown as Record<string, unknown>;
    for (const f of EVENT_ARRAY_FIELDS) {
      const arr = bag[f];
      if (Array.isArray(arr)) eventCount += arr.length;
    }
    if (u.kind !== "Player" || !u.info) continue;
    const entry = { specId: u.specId ?? 0, classId: u.classId ?? 0 };
    if (u.info.teamId === src.playerTeamId) {
      own.push(entry);
      if (
        typeof u.info.personalRating === "number" &&
        u.info.personalRating > 0
      )
        ratings.push(u.info.personalRating);
    } else {
      foe.push(entry);
    }
  }
  const avgRating = ratings.length
    ? Math.round(ratings.reduce((s, r) => s + r, 0) / ratings.length)
    : null;
  // The recorder: character name (to tell characters apart) + personal rating
  // (so the curve no longer feeds on the team average)
  const recorder = src.playerId ? src.units?.[src.playerId] : undefined;
  const playerName = recorder?.name;
  const playerRating =
    typeof recorder?.info?.personalRating === "number" &&
    recorder.info.personalRating > 0
      ? recorder.info.personalRating
      : null;
  return {
    durationS,
    avgRating,
    teams: [own, foe],
    playerName,
    playerRating,
    eventCount,
  };
}

export class MatchStore {
  private index = new Map<string, StoredMatchMeta>();
  private now: () => number;
  private lru = new MatchLruCache();
  private rebuildInFlight: Promise<{ updated: number; failed: number }> | null =
    null;

  constructor(
    private rootDir: string,
    opts?: { now?: () => number },
  ) {
    this.now = opts?.now ?? Date.now;
    mkdirSync(rootDir, { recursive: true });
  }

  private indexPath = () => join(this.rootDir, "_index.ndjson");

  private appendIndexLine(meta: StoredMatchMeta): void {
    appendFileSync(this.indexPath(), JSON.stringify(meta) + "\n");
  }

  private rewriteIndex(): void {
    atomicWriteFileSync(
      this.indexPath(),
      [...this.index.values()].map((m) => JSON.stringify(m)).join("\n") +
        (this.index.size ? "\n" : ""),
    );
  }

  init(): StoredMatchMeta[] {
    this.index.clear();
    this.lru.clear();
    // 1) Fast path: one read of the append-only index (dedup by id, last wins).
    try {
      const raw = readFileSync(this.indexPath(), "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const meta = JSON.parse(line) as StoredMatchMeta;
          if (typeof meta.id === "string") this.index.set(meta.id, meta);
        } catch {
          /* skip corrupt line */
        }
      }
    } catch {
      /* no index file → migrate below */
    }
    // 2) Reconcile with the per-dir source of truth (cheap: dir NAMES only).
    //    Use Sets so reconciliation is O(N), not O(N^2).
    let names: string[] = [];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      /* empty */
    }
    const nameSet = new Set(
      names.filter((n) => !n.startsWith(".") && !n.startsWith("_")),
    );
    const indexedDirs = new Set(
      [...this.index.values()].map((m) => safeName(m.id)),
    );
    let repaired = false;
    // Recover dirs present on disk but missing from the index (crash between
    // dir write and index append).
    for (const name of nameSet) {
      if (indexedDirs.has(name)) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(this.rootDir, name, "meta.json"), "utf-8"),
        ) as StoredMatchMeta;
        if (typeof meta.id === "string") {
          this.index.set(meta.id, meta);
          this.appendIndexLine(meta);
          repaired = true;
        }
      } catch {
        /* corrupt directory → skip */
      }
    }
    // Drop index entries whose dir is gone.
    for (const [id] of [...this.index]) {
      if (!nameSet.has(safeName(id))) {
        this.index.delete(id);
        repaired = true;
      }
    }
    // No index file at all → write one (migration); or repair.
    if (!existsSync(this.indexPath()) || repaired) this.rewriteIndex();
    return this.list();
  }

  store(item: GladMatch | GladShuffle): {
    stored: boolean;
    meta: StoredMatchMeta | null;
  } {
    let id: string;
    let meta: StoredMatchMeta;
    let data: unknown;
    if (item.kind === "shuffle") {
      const first = item.rounds[0];
      if (!first) return { stored: false, meta: null };
      id = first.id;
      meta = {
        id,
        kind: "shuffle",
        bracket: first.bracket,
        zoneId: first.zoneId,
        startTime: item.startTime,
        endTime: item.endTime,
        result: String(item.result),
        storedAt: this.now(),
        // Take the roster from round 1 (a shuffle swaps sides every round, so
        // round 1 is the entry roster); take the duration over the whole run.
        ...metaExtras(first as unknown as Parameters<typeof metaExtras>[0]),
        durationS: Math.max(
          0,
          Math.round((item.endTime - item.startTime) / 1000),
        ),
        // Slim at write time (the compose layer already trimmed params); the
        // offset table lets rawLine work without parsing
        slimmed: true,
        roundLinesTotal: [...item.rounds]
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
          .map((r) => ({ seq: r.sequenceNumber, lines: r.linesTotal })),
        roundStats: shuffleRoundStats(
          item.rounds as unknown as Parameters<typeof shuffleRoundStats>[0],
        ),
        structuralIssues: structuralIssueCodes(item),
      };
      data = {
        ...item,
        rawLines: undefined,
        rounds: item.rounds.map((r) => ({ ...r, rawLines: undefined })),
      };
    } else {
      id = item.id;
      meta = {
        id,
        kind: "match",
        bracket: item.bracket,
        zoneId: item.zoneId,
        startTime: item.startTime,
        endTime: item.endTime,
        result: String(item.result),
        storedAt: this.now(),
        ...metaExtras(item as unknown as Parameters<typeof metaExtras>[0]),
        slimmed: true, // slim at write time (compose already trimmed params)
        structuralIssues: structuralIssueCodes(item),
      };
      data = { ...item, rawLines: undefined };
    }
    if (this.index.has(id)) {
      // Already indexed — dedup, UNLESS the on-disk meta.json is missing or
      // corrupt: then fall through and re-write to self-heal the files.
      let intact = false;
      try {
        JSON.parse(
          readFileSync(join(this.rootDir, safeName(id), "meta.json"), "utf-8"),
        );
        intact = true;
      } catch {
        /* missing or corrupt → recover */
      }
      if (intact) return { stored: false, meta: this.index.get(id)! };
    }

    const dirName = safeName(id);
    const finalDir = join(this.rootDir, dirName);
    const tmpDir = join(this.rootDir, `.tmp-${dirName}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "meta.json"), JSON.stringify(meta, null, 2));
    writeFileSync(
      join(tmpDir, "match.json"),
      JSON.stringify({
        schemaVersion: 1,
        storedAt: meta.storedAt,
        kind: meta.kind,
        data,
      }),
    );
    // Retention invariant (GH #100, docs/log-observability-audit.md "Raw-log
    // retention invariant"): raw.txt is the ONLY copy of what match.json does
    // not materialise — slim.ts trims params 13+, and L3 keeps no facing, no
    // periodic-energize, no enchant events, no undecoded advanced fields. Do
    // not drop, truncate or lossily replace it until every audit-listed field
    // has a verified lossless replacement.
    writeFileSync(join(tmpDir, "raw.txt"), item.rawLines.join("\n") + "\n");
    rmSync(finalDir, { recursive: true, force: true });
    renameWithRetrySync(tmpDir, finalDir);
    this.index.set(id, meta);
    this.appendIndexLine(meta);
    // perf-1: build the per-round sidecar right away — the user typically opens
    // a match moments after it lands, and the worker beats the click.
    if (meta.kind === "shuffle") this.queueRoundsIdxBuild(id);
    return { stored: true, meta };
  }

  /**
   * A one-shot backfill triggered by the user (DevPanel button): read
   * match.json directory by directory, re-extract the rich-row fields and
   * rewrite meta.json + the index. Old rows missing the fields is the normal
   * case (rendering falls back), so this never runs automatically.
   *
   * Parsing happens in a worker (the old synchronous version did
   * readFileSync + JSON.parse per match on the main thread: per the measured
   * distribution, 794 matches ≈ 83GB of disk reads + 6-10 minutes of pure
   * freeze — one click = the app hangs, 2026-07-26 audit); main only pays for
   * the structured clone + metaExtras, and yields naturally at the await
   * between matches. The IPC invoke semantics are unchanged (the handler
   * already returned a Promise).
   */
  async rebuildIndex(
    onProgress?: (p: { i: number; n: number; id: string }) => void,
  ): Promise<{ updated: number; failed: number }> {
    // Single-flight (agy review #1): a whole-library rebuild takes minutes; if
    // the records page unmounts and remounts, the button's running state is
    // lost, and another click would start a second concurrent rebuild — two
    // loops writing the same meta.json files and this.index at once. If one is
    // in flight, join it instead of starting a new loop (a joiner's onProgress
    // therefore receives nothing — there is only one loop, and only one
    // progress stream).
    if (this.rebuildInFlight) return this.rebuildInFlight;
    this.rebuildInFlight = this.doRebuildIndex(onProgress).finally(() => {
      this.rebuildInFlight = null;
    });
    return this.rebuildInFlight;
  }

  private async doRebuildIndex(
    onProgress?: (p: { i: number; n: number; id: string }) => void,
  ): Promise<{ updated: number; failed: number }> {
    this.lru.clear();
    let updated = 0;
    let failed = 0;
    const all = [...this.index];
    let i = 0;
    for (const [id, meta] of all) {
      i++;
      const next = await this.rebuiltMeta(id, meta);
      if (next) {
        this.index.set(id, next);
        updated++;
      } else {
        failed++;
      }
      onProgress?.({ i, n: all.length, id });
    }
    this.rewriteIndex();
    return { updated, failed };
  }

  /**
   * Re-derive a single match: read match.json → re-forge the rich-row fields
   * → write meta.json back. Returns the new meta on success (the caller is
   * responsible for putting it back into this.index), null on failure.
   * rebuildIndex (whole library) and reparse (developer page, single match)
   * share this one piece, so the two "rebuild meta" paths cannot each grow
   * their own version and drift apart later.
   */
  private async rebuiltMeta(
    id: string,
    meta: StoredMatchMeta,
  ): Promise<StoredMatchMeta | null> {
    try {
      const doc = (await parseMatchFileInWorker(
        join(this.rootDir, safeName(id), "match.json"),
      )) as { kind: string; data: Record<string, unknown> } | null;
      if (!doc) return null;
      const src =
        doc.kind === "shuffle"
          ? (doc.data as { rounds?: unknown[] }).rounds?.[0]
          : doc.data;
      if (!src) return null;
      const next: StoredMatchMeta = {
        ...meta,
        ...metaExtras(src as Parameters<typeof metaExtras>[0]),
        // The stored doc is the parsed doc minus rawLines, which the
        // completeness predicate never reads.
        structuralIssues: structuralIssueCodes(
          doc.data as unknown as GladMatch | GladShuffle,
        ),
      };
      if (doc.kind === "shuffle") {
        next.durationS = Math.max(
          0,
          Math.round((meta.endTime - meta.startTime) / 1000),
        );
        const rounds = (doc.data as { rounds?: unknown[] }).rounds;
        if (Array.isArray(rounds) && rounds.length > 0) {
          next.roundStats = shuffleRoundStats(
            rounds as Parameters<typeof shuffleRoundStats>[0],
          );
        }
      }
      writeFileSync(
        join(this.rootDir, safeName(id), "meta.json"),
        JSON.stringify(next, null, 2),
      );
      return next;
    } catch {
      return null;
    }
  }

  /**
   * Developer page, right column "re-parse this match": re-derive only this
   * one match, touching nothing else.
   * The index line is persisted too — otherwise a restart falls back to the
   * old meta and the user thinks the button did nothing.
   */
  async reparse(id: string): Promise<{ ok: boolean }> {
    const meta = this.index.get(id);
    if (!meta) return { ok: false };
    const next = await this.rebuiltMeta(id, meta);
    if (!next) return { ok: false };
    this.index.set(id, next);
    this.lru.delete(id);
    this.rewriteIndex();
    return { ok: true };
  }

  /**
   * The on-disk directory of this match (used by the developer page's
   * "open matches/&lt;id&gt;/").
   * Only ids present in the index are accepted — no opening for the renderer
   * to turn an arbitrary string into a shell.openPath argument.
   */
  dirOf(id: string): string | null {
    if (!this.index.has(id)) return null;
    return join(this.rootDir, safeName(id));
  }

  /**
   * Intent guard (BACKLOG #26 Task 2): lazy, best-effort raw.txt read for the
   * rawStreams pipeline (candidateFindings.ts's `castFailedInWindow` guard).
   * Same directory-resolution rule as `dirOf`/`rawLine` (only indexed ids,
   * `safeName`-escaped). `null` covers every failure mode uniformly — missing
   * file (old archive predates raw.txt retention, or it was never written),
   * permission error, id not in the index — every caller must treat `null`
   * exactly like `parseRawStreams(null, ...)`'s `available:false`, never
   * throw (Global Constraint, docs/superpowers/plans/2026-08-15-raw-
   * streams.md).
   */
  async readRawText(id: string): Promise<string | null> {
    if (!this.index.has(id)) return null;
    try {
      return await fsp.readFile(
        join(this.rootDir, safeName(id), "raw.txt"),
        "utf-8",
      );
    } catch {
      return null;
    }
  }

  list(): StoredMatchMeta[] {
    return [...this.index.values()].sort((a, b) => b.startTime - a.startTime);
  }

  page(opts: { before?: number; limit: number }): StoredMatchMeta[] {
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit || 0)));
    const before = Number.isFinite(opts.before as number)
      ? (opts.before as number)
      : Infinity;
    return this.list()
      .filter((m) => m.startTime < before)
      .slice(0, limit);
  }

  /**
   * Raw byte pass-through for the doc (the 2026-07-26 audit's root fix):
   * return the **raw bytes** of match.json, and parse only at the final
   * consumer (JSON.parse in the preload layer + the slimStoredDoc fallback).
   * The old path materialized one median-77MB doc on three separate heaps —
   * worker/main/renderer (a 426MB match measured ~5GB peak across the three) —
   * and main's LRU also kept 2 full object graphs resident; now main holds only
   * the Buffer read by async IO, and the LRU is capped by bytes.
   *
   * Self-healing of old fat files (meta without the slimmed flag) is pushed
   * down into slimWorker: parse → slim → atomic rewrite → update meta, all in
   * the background, no longer blocking the open path — this call still returns
   * the fat bytes, and the consumer runs them through the shared slim
   * predicate after parsing, so what the product sees matches the old path.
   */
  async get(id: string): Promise<Buffer | null> {
    if (!this.index.has(id)) return null;
    const cached = this.lru.get(id);
    if (cached !== undefined) return cached;
    try {
      const buf = await fsp.readFile(
        join(this.rootDir, safeName(id), "match.json"),
      );
      this.lru.set(id, buf);
      const meta = this.index.get(id);
      if (meta && !meta.slimmed) this.queueSlimHeal(id);
      return buf;
    } catch {
      return null;
    }
  }

  /**
   * Lazy per-round open path (perf-1): with a valid rounds.idx.json sidecar,
   * return only the shell (rounds replaced by null placeholders) plus round
   * 0's bytes — the consumer (preload composeLazyDoc) parses ~1/6 of a
   * shuffle's bytes instead of all of them. No sidecar (or a stale one, or a
   * non-shuffle) falls back to the whole-doc byte pass-through, queueing a
   * background sidecar build so the NEXT open is fast. Nothing here is cached
   * in the byte LRU: positional reads of a recently-read file are served by
   * the OS page cache, and a stale-sidecar bug then only costs a rebuild.
   */
  async getLazy(
    id: string,
  ): Promise<
    | { mode: "full"; bytes: Buffer }
    | { mode: "perRound"; shell: Buffer; round0: Buffer; roundCount: number }
    | null
  > {
    const meta = this.index.get(id);
    if (!meta) return null;
    if (meta.kind === "shuffle") {
      const idx = this.readRoundsIdx(id);
      if (idx && idx.rounds.length > 0) {
        try {
          const filePath = join(this.rootDir, safeName(id), "match.json");
          const fh = await fsp.open(filePath, "r");
          try {
            const readRange = async (start: number, end: number) => {
              const out = Buffer.allocUnsafe(end - start);
              await fh.read(out, 0, out.length, start);
              return out;
            };
            const prefix = await readRange(0, idx.arrayOpenEnd);
            const suffix = await readRange(idx.arrayClose, idx.fileSize);
            const [r0s, r0e] = idx.rounds[0]!;
            const round0 = await readRange(r0s, r0e);
            const shell = Buffer.concat([
              prefix,
              Buffer.from(nullFiller(idx.rounds.length)),
              suffix,
            ]);
            // Same self-heal hook as get(): a foreign fat doc stays readable
            // and heals in the background (the rewrite bumps mtime, which
            // invalidates this sidecar; the guard rebuilds it).
            if (!meta.slimmed) this.queueSlimHeal(id);
            return {
              mode: "perRound",
              shell,
              round0,
              roundCount: idx.rounds.length,
            };
          } finally {
            await fh.close();
          }
        } catch {
          /* fall through to the whole-doc path */
        }
      } else {
        this.queueRoundsIdxBuild(id);
      }
    }
    const bytes = await this.get(id);
    return bytes ? { mode: "full", bytes } : null;
  }

  /** One lazily-requested round's raw bytes (renderer round switch). Null when
   * the sidecar is missing/stale — the renderer falls back to re-opening the
   * match via the whole-doc path. */
  async getRound(id: string, roundIndex: number): Promise<Buffer | null> {
    const idx = this.readRoundsIdx(id);
    const range = idx?.rounds[roundIndex];
    if (!range) return null;
    try {
      const fh = await fsp.open(
        join(this.rootDir, safeName(id), "match.json"),
        "r",
      );
      try {
        const out = Buffer.allocUnsafe(range[1] - range[0]);
        await fh.read(out, 0, out.length, range[0]);
        return out;
      } finally {
        await fh.close();
      }
    } catch {
      return null;
    }
  }

  private roundsIdxPath = (id: string) =>
    join(this.rootDir, safeName(id), "rounds.idx.json");

  /** Parsed-sidecar cache; every use re-stats match.json and discards the
   * sidecar when size/mtime moved (slim self-heal rewrites the file). */
  private idxCache = new Map<string, RoundsIdx>();

  private readRoundsIdx(id: string): RoundsIdx | null {
    const idx = this.loadValidRoundsIdx(id);
    if (idx) this.idxCache.set(id, idx);
    else {
      this.idxCache.delete(id);
      this.queueRoundsIdxBuild(id);
    }
    return idx;
  }

  /** Load + validate the sidecar with NO side effects (single predicate for
   * the open path, the backfill probe, and the cache guard). */
  private loadValidRoundsIdx(id: string): RoundsIdx | null {
    try {
      const st = statSync(join(this.rootDir, safeName(id), "match.json"));
      const validate = (idx: RoundsIdx | null): RoundsIdx | null =>
        idx &&
        idx.v === 1 &&
        idx.fileSize === st.size &&
        idx.mtimeMs === st.mtimeMs &&
        Array.isArray(idx.rounds)
          ? idx
          : null;
      const cached = validate(this.idxCache.get(id) ?? null);
      if (cached) return cached;
      return validate(
        JSON.parse(readFileSync(this.roundsIdxPath(id), "utf-8")) as RoundsIdx,
      );
    } catch {
      return null;
    }
  }

  /** Dedup in-flight sidecar builds (mirrors queueSlimHeal). */
  private idxBuilding = new Map<string, Promise<boolean>>();
  private queueRoundsIdxBuild(id: string): void {
    void this.runRoundsIdxBuild(id);
  }
  private runRoundsIdxBuild(id: string): Promise<boolean> {
    const meta = this.index.get(id);
    if (!meta || meta.kind !== "shuffle") return Promise.resolve(false);
    const inFlight = this.idxBuilding.get(id);
    if (inFlight) return inFlight;
    const p = new Promise<{ ok: boolean }>((resolve) => {
      try {
        const worker = new Worker(
          join(import.meta.dirname, "roundsIdxWorker.js"),
          {
            workerData: {
              filePath: join(this.rootDir, safeName(id), "match.json"),
              outPath: this.roundsIdxPath(id),
            },
          },
        );
        worker.on("message", (msg) => {
          resolve(msg as { ok: boolean });
          void worker.terminate();
        });
        worker.on("error", () => {
          resolve({ ok: false });
          void worker.terminate();
        });
        worker.on("exit", (code) => {
          if (code !== 0) resolve({ ok: false });
        });
      } catch {
        resolve({ ok: false });
      }
    })
      .then((r) => {
        this.idxCache.delete(id);
        return r.ok;
      })
      .finally(() => this.idxBuilding.delete(id));
    this.idxBuilding.set(id, p);
    return p;
  }

  /**
   * perf-2 startup backfill: serially build the per-round sidecar for every
   * shuffle that lacks a valid one (newest first — those are the ones the
   * user actually opens). One-time cost per library (~0.1-0.5s scan per
   * match, one worker at a time); later startups stat-validate and skip. The
   * `stop` gate lets app-quit interrupt between matches.
   */
  async backfillRoundsIdx(stop?: () => boolean): Promise<{ built: number }> {
    const shuffles = [...this.index.values()]
      .filter((m) => m.kind === "shuffle")
      .sort((a, b) => b.startTime - a.startTime);
    let built = 0;
    for (const meta of shuffles) {
      if (stop?.()) break;
      if (this.loadValidRoundsIdx(meta.id)) continue;
      if (await this.runRoundsIdxBuild(meta.id)) built++;
    }
    return { built };
  }

  /** perf-2 warm-up: make the next open of this match fast — ensure the
   * per-round sidecar exists (queue the worker if not) and touch the file so
   * the OS page cache is warm. Fire-and-forget, never throws. */
  async prefetch(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) return;
    try {
      if (meta.kind === "shuffle") {
        const idx = this.readRoundsIdx(id); // miss → queues the worker build
        if (idx && idx.rounds.length > 0) {
          // Warm shell + round0 pages without materializing anything for keeps
          await this.getLazy(id);
          return;
        }
      }
      // Non-shuffle (or sidecar still building): warm the byte LRU like a
      // normal open would.
      await this.get(id);
    } catch {
      /* best-effort */
    }
  }

  /** Dedup in-flight self-heals; once the worker finishes, set the meta flag
   * and invalidate the byte cache (which still holds the fat copy). */
  private healing = new Set<string>();
  private queueSlimHeal(id: string): void {
    if (this.healing.has(id)) return;
    this.healing.add(id);
    void runSlimHealWorker(join(this.rootDir, safeName(id), "match.json"))
      .then((res) => {
        if (!res.ok) return;
        const meta = this.index.get(id);
        if (!meta) return;
        const next: StoredMatchMeta = {
          ...meta,
          slimmed: true,
          ...(res.roundLinesTotal
            ? { roundLinesTotal: res.roundLinesTotal }
            : {}),
        };
        this.index.set(id, next);
        try {
          writeFileSync(
            join(this.rootDir, safeName(id), "meta.json"),
            JSON.stringify(next, null, 2),
          );
          this.appendIndexLine(next);
        } catch {
          /* best-effort */
        }
        this.lru.delete(id);
      })
      .finally(() => this.healing.delete(id));
  }

  /**
   * B2 provenance deep link: event lineIndex → the raw line in raw.txt.
   * lineIndex is the index within the parsed segment (within the round for a
   * shuffle); the offset into the whole-match raw.txt is the sum of the
   * preceding rounds' linesTotal — same source of order as compose's
   * concatenation of rawLines (rounds in order + a trailing ARENA_MATCH_END
   * line, which does not affect any prefix offset).
   */
  async rawLine(
    id: string,
    opts: { roundSeq?: number | null; lineIndex: number },
  ): Promise<{ line: string; fileLine: number } | null> {
    if (!this.index.has(id)) return null;
    if (!Number.isInteger(opts.lineIndex) || opts.lineIndex < 0) return null;
    try {
      let offset = 0;
      if (opts.roundSeq != null) {
        // Prefer meta's line-offset table (written by store / migration /
        // self-heal); only fall back to one worker parse when an old meta
        // lacks it — get() now passes bytes through, so main no longer has a
        // parsed object around.
        let pairs = this.index.get(id)?.roundLinesTotal;
        if (!Array.isArray(pairs) || typeof pairs[0]?.seq !== "number") {
          const doc = (await parseMatchFileInWorker(
            join(this.rootDir, safeName(id), "match.json"),
          )) as {
            data?: {
              rounds?: { sequenceNumber: number; linesTotal: number }[];
            };
          } | null;
          const rounds = doc?.data?.rounds;
          if (!Array.isArray(rounds)) return null;
          pairs = rounds.map((r) => ({
            seq: r.sequenceNumber,
            lines: r.linesTotal,
          }));
        }
        for (const p of pairs) {
          if (p.seq < opts.roundSeq) offset += p.lines;
        }
      }
      const fileLine = offset + opts.lineIndex;
      const line = await readNthLine(
        join(this.rootDir, safeName(id), "raw.txt"),
        fileLine,
      );
      return line === null || line === "" ? null : { line, fileLine };
    } catch {
      return null;
    }
  }
}
