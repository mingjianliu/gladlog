import type { ParsedLine } from "../l1/types";

export interface Segment {
  kind: "match" | "shuffleRound";
  bracket: string;
  zoneId: string;
  isRated: boolean;
  startLine: ParsedLine;
  records: ParsedLine[];
  rawLines: string[];
  sequenceNumber?: number;
}

export interface ShuffleClose {
  rounds: Segment[];
  end: ParsedLine;
}
