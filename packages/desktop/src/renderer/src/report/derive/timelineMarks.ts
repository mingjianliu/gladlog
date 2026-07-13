import type { CandidateEvent } from "@gladlog/analysis";

export interface TimelineMark {
  id: string;
  t: number;
  leftPct: number;
  type: string;
}

export interface TimelineMarks {
  marks: TimelineMark[];
  maxT: number;
}

export function timelineMarks(candidates: CandidateEvent[]): TimelineMarks {
  // Only point-in-time events belong on a time axis. Whole-round observations
  // (e.g. cd-waste, t=0, no facts.t) would otherwise plot at the far left.
  const points = candidates.filter((c) => c.facts.t !== undefined);
  const maxT = Math.max(1, ...points.map((c) => c.t));
  const marks = points.map((c) => ({
    id: c.id,
    t: c.t,
    leftPct: (c.t / maxT) * 100,
    type: c.type,
  }));
  return { marks, maxT };
}
