import { GladLogParser } from "@gladlog/parser";
import { randomUUID } from "crypto";
import { statSync } from "fs";

import type { FileCheckpoint, WorkerToMain } from "../shared/protocol";
import { initialTailState, readTail, type TailState } from "./tailReader";

export interface ParserLike {
  push(line: string): void;
  end(): void;
  hasOpenSegment(): boolean;
  on(
    event: "match" | "shuffle" | "diagnostic" | "segmentOpen" | "segmentClose",
    cb: (payload: never) => void,
  ): unknown;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/** ackIds are unique across worker restarts: an ack main sends for a match
 * of a worker that has since died must not match an entry of its successor. */
const ACK_RUN = randomUUID();
let ackSeq = 0;

export class FilePipeline {
  private parser!: ParserLike;
  private tail: TailState;
  /** Where a fresh parser could resume to reach the current state: the end
   * of the last complete line when IDLE, the opening line of the open
   * segment otherwise. Not yet capped by `unacked` (see `checkpoint`). */
  private cp: FileCheckpoint;
  /** Start offset of the last line pushed while the parser was IDLE: while a
   * segment is open, the line that opened it. */
  private idleAt: number;
  /** ackId -> start offset of the segment of a match/shuffle that was sent to
   * main but is not yet known to be on disk. */
  private readonly unacked = new Map<string, number>();
  /** The open segment retire() gave up on, kept so it can be replayed if the
   * file grows after all (see FileCheckpoint.retired). */
  private retired: { segmentStart: number; size: number } | null;
  private readonly fileKey: string;
  private readonly filePath: string;
  private readonly emit: (msg: WorkerToMain) => void;
  private readonly parserFactory: () => ParserLike;

  constructor(opts: {
    fileKey: string;
    filePath: string;
    checkpoint: FileCheckpoint | null;
    emit: (msg: WorkerToMain) => void;
    parserFactory?: () => ParserLike;
  }) {
    this.fileKey = opts.fileKey;
    this.filePath = opts.filePath;
    this.emit = opts.emit;
    this.parserFactory =
      opts.parserFactory ??
      (() => new GladLogParser() as unknown as ParserLike);
    const cp = opts.checkpoint;
    this.cp = {
      offset: cp?.offset ?? 0,
      firstLineChecksum: cp?.firstLineChecksum ?? null,
    };
    this.retired = cp?.retired ?? null;
    this.tail = initialTailState(this.cp);
    this.idleAt = this.cp.offset;
    this.createParser();
  }

  /** Registers a match/shuffle about to be sent. Called while its closing
   * line (or end()) is being processed, when `idleAt` is still the opening
   * line of its segment. Registered before the emit, so an ack that arrives
   * synchronously (the runtime's own dedup path) finds it. */
  private track(): string {
    const ackId = `${ACK_RUN}-${++ackSeq}`;
    this.unacked.set(ackId, this.idleAt);
    return ackId;
  }

  private createParser(): void {
    this.parser = this.parserFactory();
    this.parser.on("match", (payload) => {
      const ackId = this.track();
      this.emit({
        type: "match",
        fileKey: this.fileKey,
        payload: payload as never,
        ackId,
      });
    });
    this.parser.on("shuffle", (payload) => {
      const ackId = this.track();
      this.emit({
        type: "shuffle",
        fileKey: this.fileKey,
        payload: payload as never,
        ackId,
      });
    });
    this.parser.on("segmentOpen", (payload) => {
      const i = payload as {
        bracket: string;
        zoneId: string;
        isRated: boolean;
        startTime: number;
      };
      this.emit({ type: "segmentOpen", fileKey: this.fileKey, ...i });
    });
    this.parser.on("segmentClose", (payload) => {
      const i = payload as { endTime: number | null; aborted: boolean };
      this.emit({ type: "segmentClose", fileKey: this.fileKey, ...i });
    });
    this.parser.on("diagnostic", (payload) => {
      const d = payload as { code: string; lineRef?: string };
      this.emit({
        type: "diagnostic",
        fileKey: this.fileKey,
        code: d.code,
        detail: d.lineRef,
      });
    });
  }

  /** Reads and parses everything past the tail, then moves the persisted
   * checkpoint to the last IDLE boundary (GH #211).
   *
   * The checkpoint must be a point a *fresh* parser can resume from and end
   * up in the same state, so it may never sit inside a match: with a segment
   * open at the end of the flush, it goes to the start of the line that
   * opened it -- the last line pushed while the parser was IDLE (a shuffle
   * lobby counts as one segment, so that is its first round's START; a
   * DOUBLE_START does not pass through IDLE, so it is the first START). Before
   * this, the checkpoint simply stayed where it was, and a file ending inside
   * an unclosed match kept `{offset: 0}` forever and was re-parsed in full on
   * every launch. Every recorded offset is the start of a complete line, so
   * the checkpoint always lands on one. What gets persisted is further
   * capped by the matches main has not acknowledged yet (`checkpoint`). */
  processFlush(): void {
    if (this.retired && fileSize(this.filePath) > this.retired.size)
      this.unretire();
    const r = readTail(this.filePath, this.tail, {
      rotated: (firstLineChecksum) => {
        // A rotation discards the old parser. parser.end() is a no-op when
        // IDLE, and otherwise: (a) emits the aborted segmentClose the
        // recording side needs (else it waits for the 40-minute safety
        // valve), and (b) for a shuffle in progress, flushes shuffleCallback
        // for the rounds that already completed before rotation, instead of
        // silently discarding the finished rounds along with the truncated
        // one -- without this, those rounds' recording segments were
        // permanently orphaned (BACKLOG #21.8; the underlying flush logic
        // lives in packages/parser's Segmenter.end()).
        this.parser.end();
        this.createParser();
        // Unacknowledged offsets point into content that no longer exists;
        // replaying from them would land anywhere in the new content.
        this.unacked.clear();
        this.retired = null;
        // The fresh parser is IDLE, so the first new line resets idleAt.
        this.idleAt = 0;
        this.cp = { offset: 0, firstLineChecksum };
      },
      line: (line, startOffset) => {
        if (!this.parser.hasOpenSegment()) this.idleAt = startOffset;
        this.parser.push(line);
      },
    });
    this.tail = r.state;
    this.cp = {
      offset: this.parser.hasOpenSegment() ? this.idleAt : this.tail.offset,
      firstLineChecksum: this.tail.firstLineChecksum,
    };
  }

  /** Main has the match/shuffle sent with this ackId on disk. Returns whether
   * it was one of this pipeline's, i.e. whether `checkpoint` may have moved. */
  acknowledge(ackId: string): boolean {
    return this.unacked.delete(ackId);
  }

  /** Gives up on the open segment of a file WoW will never write again
   * (runtime.ts decides that; see its startup loop). parser.end() is the same
   * call a rotation makes: it stores the finished rounds of an unfinished
   * shuffle with an Unknown result (#21.8), drops an unclosed ordinary match,
   * and emits the aborted segmentClose that pairs the segmentOpen the replay
   * just sent, so the recorder is never left inside that window. The parser
   * is replaced, which releases the segment's records and raw lines (~9.5
   * bytes of heap per raw character, GH #211), and the checkpoint moves to
   * the end of the last complete line so the next launch reads nothing --
   * once main has acknowledged a shuffle end() stored (until then
   * `checkpoint` stays at the lobby's first START).
   *
   * "Never write again" is a judgement (quiet + not the newest log), and a
   * second client can prove it wrong: the segment's opening offset and the
   * file's size are kept (persisted as FileCheckpoint.retired), and a later
   * flush that finds the file grown replays the segment (unretire()), so a
   * late END still closes the match (codex review of GH #211). No growth, no
   * re-read. */
  retire(): void {
    if (!this.parser.hasOpenSegment()) return;
    const segmentStart = this.idleAt;
    this.parser.end();
    this.createParser();
    this.retired = {
      segmentStart,
      size: this.tail.offset + this.tail.carry.length,
    };
    this.idleAt = this.tail.offset;
    this.cp = {
      offset: this.tail.offset,
      firstLineChecksum: this.tail.firstLineChecksum,
    };
  }

  /** The retired file grew after all: resume from the retired segment's
   * opening line, as if it had never been retired. The parser retire()
   * installed is still fresh -- lines only exist past the size retire()
   * recorded -- so it replays the segment from its START as-is.
   * A shuffle whose finished rounds retire() already stored is stored again
   * under the same id and deduped by the store (the worker's stageMatch finds
   * it on disk and sends nothing). */
  private unretire(): void {
    const at = this.retired!.segmentStart;
    this.retired = null;
    this.tail = {
      offset: at,
      firstLineChecksum: this.tail.firstLineChecksum,
      carry: Buffer.alloc(0),
    };
    this.idleAt = at;
    this.cp = { offset: at, firstLineChecksum: this.tail.firstLineChecksum };
  }

  /** Called before teardown (directory change / reconfiguration) *and* by the
   * segment quiet valve (runtime.ts quietSweep): if a match is in progress,
   * send the recording side the missing close signal, otherwise the recorder
   * has to wait for the 40-minute safety valve (agy flash review #5). Unlike
   * processFlush()'s rotation branch, this must NOT call parser.end() --
   * the quiet valve keeps using the same parser instance afterward and
   * relies on its state being untouched so a late-arriving real
   * ARENA_MATCH_END still completes the segment normally (see
   * runtime.quietclose.test.ts). This only emits the synthetic close signal;
   * it does not (and, for the quiet-valve caller, must not) flush a
   * still-open shuffle's completed rounds -- that only happens on an actual
   * rotation/EOF (BACKLOG #21.8). */
  closeOpenSegment(): void {
    if (this.parser.hasOpenSegment()) {
      this.emit({
        type: "segmentClose",
        fileKey: this.fileKey,
        endTime: null,
        aborted: true,
      });
    }
  }

  /** The checkpoint to persist: the resume point, but never past the opening
   * line of a match/shuffle main has not acknowledged. Without the cap a
   * crash after the worker posted a match and before main committed it lost
   * the match for good: MatchStore.init() deletes the orphaned staging
   * directory, and the restart resumed past the match (codex review of GH
   * #211; the plain "flush ended IDLE -> end of file" path had the same race
   * before GH #211). Replaying a match that main did store is harmless: the
   * store dedups by id. */
  get checkpoint(): FileCheckpoint {
    let offset = this.cp.offset;
    for (const at of this.unacked.values()) offset = Math.min(offset, at);
    return {
      ...this.cp,
      offset,
      ...(this.retired ? { retired: { ...this.retired } } : {}),
    };
  }
  get currentOffset(): number {
    return this.tail.offset;
  }
  /** Used by the segment silence valve (runtime): is a match segment open? */
  get hasOpenSegment(): boolean {
    return this.parser.hasOpenSegment();
  }
}
