import { parseLine } from "./l1/parseLine";
import { Segmenter } from "./l2/segmenter";
import { Segment, ShuffleClose } from "./l2/types";
import { buildMatch, buildShuffle } from "./l3/compose";
import type { GladMatch, GladShuffle } from "./l3/model";

interface EventMap {
  matchSegment: (seg: Segment) => void;
  shuffleSegments: (s: ShuffleClose) => void;
  diagnostic: (d: { code: string; lineRef?: string }) => void;
  match: (m: GladMatch) => void;
  shuffle: (s: GladShuffle) => void;
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

    this.segmenter.onMatch((seg, end) => {
      this.emit("matchSegment", seg);
      try {
        const m = buildMatch(seg, end);
        this.emit("match", m);
      } catch (err) {
        this.emit("diagnostic", { code: "BUILD_FAILED" });
      }
    });

    this.segmenter.onShuffle((s) => {
      this.emit("shuffleSegments", s);
      try {
        const shuffle = buildShuffle(s);
        this.emit("shuffle", shuffle);
      } catch (err) {
        this.emit("diagnostic", { code: "BUILD_FAILED" });
      }
    });

    this.segmenter.onDiagnostic((d) => {
      this.emit("diagnostic", d);
      if (d.code === "UNCLOSED_SEGMENT" || d.code === "DOUBLE_START") {
        this.segmentsDropped++;
      }
    });
  }

  public push(rawLine: string): void {
    // CRLF 日志按 \n 切行后行尾残留 \r,会污染每个事件的最后一个参数
    // (实锤:UNIT_DIED 假死位 "1\r" !== "1",Feign Death 全被记成真死)
    if (rawLine.endsWith("\r")) {
      rawLine = rawLine.slice(0, -1);
    }
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

  public stats(): {
    linesTotal: number;
    linesDropped: number;
    segmentsDropped: number;
  } {
    return {
      linesTotal: this.linesTotal,
      linesDropped: this.linesDropped,
      segmentsDropped: this.segmentsDropped,
    };
  }

  public hasOpenSegment(): boolean {
    return this.segmenter.hasOpenSegment();
  }

  private emit<K extends keyof EventMap>(
    event: K,
    data: Parameters<EventMap[K]>[0],
  ): void {
    const list = this.listeners[event];
    if (list) {
      for (const cb of list) {
        cb(data as any);
      }
    }
  }
}
