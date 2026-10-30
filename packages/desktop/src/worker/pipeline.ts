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

  processFlush(): void {
    const r = readTail(this.filePath, this.tail);
    if (r.rotated) {
      // A rotation discards the old parser. parser.end() is a no-op when
      // IDLE, and otherwise: (a) emits the aborted segmentClose the recording
      // side needs (else it waits for the 40-minute safety valve), and (b)
      // for a shuffle in progress, flushes shuffleCallback for the rounds
      // that already completed before rotation, instead of silently
      // discarding the finished rounds along with the truncated one --
      // without this, those rounds' recording segments were permanently
      // orphaned (BACKLOG #21.8; the underlying flush logic lives in
      // packages/parser's Segmenter.end()).
      this.parser.end();
      this.createParser();
      this.cp = { offset: 0, firstLineChecksum: r.state.firstLineChecksum };
    }
    for (const line of r.lines) this.parser.push(line);
    this.tail = r.state;
    if (!this.parser.hasOpenSegment()) {
      this.cp = {
        offset: this.tail.offset,
        firstLineChecksum: this.tail.firstLineChecksum,
      };
    }
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
