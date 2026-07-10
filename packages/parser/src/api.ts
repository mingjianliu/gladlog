import { parseLine } from "./l1/parseLine";
import { Segmenter } from "./l2/segmenter";
import { Segment, ShuffleClose } from "./l2/types";

interface EventMap {
  matchSegment: (seg: Segment) => void;
  shuffleSegments: (s: ShuffleClose) => void;
  diagnostic: (d: { code: string; lineRef?: string }) => void;
}

export class GladLogParser {
  private timezone?: string;
  private wowVersion?: "retail";
  private segmenter: Segmenter;

  private linesTotal = 0;
  private linesDropped = 0;
  private segmentsDropped = 0;

  private listeners: {
    [K in keyof EventMap]?: EventMap[K][];
  } = {};

  constructor(opts?: { timezone?: string; wowVersion?: "retail" }) {
    this.timezone = opts?.timezone;
    this.wowVersion = opts?.wowVersion;
    this.segmenter = new Segmenter();

    this.segmenter.onMatch((seg) => {
      this.emit("matchSegment", seg);
    });

    this.segmenter.onShuffle((s) => {
      this.emit("shuffleSegments", s);
    });

    this.segmenter.onDiagnostic((d) => {
      this.emit("diagnostic", d);
      if (d.code === "UNCLOSED_SEGMENT" || d.code === "DOUBLE_START") {
        this.segmentsDropped++;
      }
    });
  }

  public push(rawLine: string): void {
    if (rawLine.trim() === "") {
      return;
    }
    this.linesTotal++;
    const parsed = parseLine(rawLine, { timezone: this.timezone });
    if (parsed === null) {
      this.linesDropped++;
    } else {
      this.segmenter.push(parsed, rawLine);
    }
  }

  public end(): void {
    this.segmenter.end();
  }

  public on<K extends keyof EventMap>(event: K, cb: EventMap[K]): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(cb);
    return this;
  }

  public stats(): { linesTotal: number; linesDropped: number; segmentsDropped: number } {
    return {
      linesTotal: this.linesTotal,
      linesDropped: this.linesDropped,
      segmentsDropped: this.segmentsDropped,
    };
  }

  private emit<K extends keyof EventMap>(event: K, data: Parameters<EventMap[K]>[0]): void {
    const list = this.listeners[event];
    if (list) {
      for (const cb of list) {
        cb(data as any);
      }
    }
  }
}
