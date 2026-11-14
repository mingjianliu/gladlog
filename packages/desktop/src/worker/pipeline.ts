import { GladLogParser } from "@gladlog/parser";

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

export class FilePipeline {
  private parser!: ParserLike;
  private tail: TailState;
  private cp: FileCheckpoint;
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
    this.cp = opts.checkpoint ?? { offset: 0, firstLineChecksum: null };
    this.tail = initialTailState(this.cp);
    this.createParser();
  }

  private createParser(): void {
    this.parser = this.parserFactory();
    this.parser.on("match", (payload) =>
      this.emit({
        type: "match",
        fileKey: this.fileKey,
        payload: payload as never,
      }),
    );
    this.parser.on("shuffle", (payload) =>
      this.emit({
        type: "shuffle",
        fileKey: this.fileKey,
        payload: payload as never,
      }),
    );
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
   * the checkpoint always lands on one. */
  processFlush(): void {
    let idleAt = this.cp.offset;
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
        // The fresh parser is IDLE, so the first new line resets idleAt.
        this.cp = { offset: 0, firstLineChecksum };
      },
      line: (line, startOffset) => {
        if (!this.parser.hasOpenSegment()) idleAt = startOffset;
        this.parser.push(line);
      },
    });
    this.tail = r.state;
    this.cp = {
      offset: this.parser.hasOpenSegment() ? idleAt : this.tail.offset,
      firstLineChecksum: this.tail.firstLineChecksum,
    };
  }

  /** Gives up on the open segment of a file WoW will never write again
   * (runtime.ts decides that; see its startup loop). parser.end() is the same
   * call a rotation makes: it stores the finished rounds of an unfinished
   * shuffle with an Unknown result (#21.8), drops an unclosed ordinary match,
   * and emits the aborted segmentClose that pairs the segmentOpen the replay
   * just sent, so the recorder is never left inside that window. The parser
   * is replaced, which releases the segment's records and raw lines (~9.5
   * bytes of heap per raw character, GH #211), and the checkpoint moves to
   * the end of the last complete line so the next launch reads nothing. */
  retire(): void {
    if (!this.parser.hasOpenSegment()) return;
    this.parser.end();
    this.createParser();
    this.cp = {
      offset: this.tail.offset,
      firstLineChecksum: this.tail.firstLineChecksum,
    };
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

  get checkpoint(): FileCheckpoint {
    return this.cp;
  }
  get currentOffset(): number {
    return this.tail.offset;
  }
  /** Used by the segment silence valve (runtime): is a match segment open? */
  get hasOpenSegment(): boolean {
    return this.parser.hasOpenSegment();
  }
}
