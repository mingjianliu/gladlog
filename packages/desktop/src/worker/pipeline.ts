import { GladLogParser } from "@gladlog/parser";
import type { FileCheckpoint, WorkerToMain } from "../shared/protocol";
import { initialTailState, readTail, type TailState } from "./tailReader";

export interface ParserLike {
  push(line: string): void;
  end(): void;
  hasOpenSegment(): boolean;
  on(
    event: "match" | "shuffle" | "diagnostic",
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
      this.createParser();
      this.cp = { offset: 0, firstLineChecksum: r.state.firstLineChecksum };
    }
    this.tail = r.state;
    for (const line of r.lines) this.parser.push(line);
    if (!this.parser.hasOpenSegment()) {
      this.cp = {
        offset: this.tail.offset,
        firstLineChecksum: this.tail.firstLineChecksum,
      };
    }
  }

  get checkpoint(): FileCheckpoint {
    return this.cp;
  }
  get currentOffset(): number {
    return this.tail.offset;
  }
}
