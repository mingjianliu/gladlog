import type { ParsedLine } from "../l1/types";
import { Segment, ShuffleClose } from "./types";

export class Segmenter {
  private matchCallback?: (seg: Segment, end: ParsedLine) => void;
  private shuffleCallback?: (s: ShuffleClose) => void;
  private diagnosticCallback?: (d: { code: string; lineRef?: string }) => void;

  private state: "IDLE" | "IN_MATCH" | "IN_SHUFFLE" = "IDLE";
  private currentSegment?: Segment;
  private rounds: Segment[] = [];

  public onMatch(cb: (seg: Segment, end: ParsedLine) => void): void {
    this.matchCallback = cb;
  }

  public onShuffle(cb: (s: ShuffleClose) => void): void {
    this.shuffleCallback = cb;
  }

  public onDiagnostic(cb: (d: { code: string; lineRef?: string }) => void): void {
    this.diagnosticCallback = cb;
  }

  public push(line: ParsedLine, raw: string): void {
    if (line.eventName === "ARENA_MATCH_START") {
      const isShuffle = line.arenaStart?.bracket === "Rated Solo Shuffle";
      if (this.state === "IDLE") {
        if (isShuffle) {
          this.state = "IN_SHUFFLE";
          this.rounds = [];
          this.currentSegment = {
            kind: "shuffleRound",
            bracket: line.arenaStart?.bracket ?? "",
            zoneId: line.arenaStart?.zoneId ?? "",
            isRated: line.arenaStart?.isRated ?? false,
            startLine: line,
            records: [],
            rawLines: [raw],
            sequenceNumber: 0,
          };
        } else {
          this.state = "IN_MATCH";
          this.currentSegment = {
            kind: "match",
            bracket: line.arenaStart?.bracket ?? "",
            zoneId: line.arenaStart?.zoneId ?? "",
            isRated: line.arenaStart?.isRated ?? false,
            startLine: line,
            records: [],
            rawLines: [raw],
          };
        }
      } else if (this.state === "IN_MATCH") {
        this.diagnosticCallback?.({ code: "DOUBLE_START" });
        if (isShuffle) {
          this.state = "IN_SHUFFLE";
          this.rounds = [];
          this.currentSegment = {
            kind: "shuffleRound",
            bracket: line.arenaStart?.bracket ?? "",
            zoneId: line.arenaStart?.zoneId ?? "",
            isRated: line.arenaStart?.isRated ?? false,
            startLine: line,
            records: [],
            rawLines: [raw],
            sequenceNumber: 0,
          };
        } else {
          this.state = "IN_MATCH";
          this.currentSegment = {
            kind: "match",
            bracket: line.arenaStart?.bracket ?? "",
            zoneId: line.arenaStart?.zoneId ?? "",
            isRated: line.arenaStart?.isRated ?? false,
            startLine: line,
            records: [],
            rawLines: [raw],
          };
        }
      } else if (this.state === "IN_SHUFFLE") {
        if (this.currentSegment) {
          this.rounds.push(this.currentSegment);
        }
        this.currentSegment = {
          kind: "shuffleRound",
          bracket: line.arenaStart?.bracket ?? "",
          zoneId: line.arenaStart?.zoneId ?? "",
          isRated: line.arenaStart?.isRated ?? false,
          startLine: line,
          records: [],
          rawLines: [raw],
          sequenceNumber: this.rounds.length,
        };
      }
    } else if (line.eventName === "ARENA_MATCH_END") {
      if (this.state === "IN_MATCH") {
        if (this.currentSegment) {
          this.matchCallback?.(this.currentSegment, line);
        }
        this.state = "IDLE";
        this.currentSegment = undefined;
      } else if (this.state === "IN_SHUFFLE") {
        if (this.currentSegment) {
          this.rounds.push(this.currentSegment);
        }
        this.shuffleCallback?.({
          rounds: this.rounds,
          end: line,
        });
        this.state = "IDLE";
        this.currentSegment = undefined;
        this.rounds = [];
      } else {
        this.diagnosticCallback?.({ code: "ORPHAN_END" });
      }
    } else {
      if (this.state !== "IDLE" && this.currentSegment) {
        this.currentSegment.records.push(line);
        this.currentSegment.rawLines.push(raw);
      }
    }
  }

  public end(): void {
    if (this.state !== "IDLE") {
      this.diagnosticCallback?.({ code: "UNCLOSED_SEGMENT" });
      this.state = "IDLE";
      this.currentSegment = undefined;
      this.rounds = [];
    }
  }
}
