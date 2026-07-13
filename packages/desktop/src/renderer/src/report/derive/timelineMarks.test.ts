import { describe, expect, it } from "vitest";
import { timelineMarks } from "./timelineMarks";
import type { CandidateEvent } from "@gladlog/analysis";

function ev(id: string, t: number, type = "death"): CandidateEvent {
  return { id, type, t, unitNames: [], facts: { t: String(t) } };
}

describe("timelineMarks", () => {
  it("keeps only point events (facts.t defined), scales leftPct to maxT", () => {
    const marks = timelineMarks([ev("a", 10), ev("b", 40)]);
    expect(marks.maxT).toBe(40);
    expect(marks.marks.map((m) => m.id)).toEqual(["a", "b"]);
    expect(marks.marks[0].leftPct).toBe(25);
    expect(marks.marks[1].leftPct).toBe(100);
  });

  it("drops whole-round events with no facts.t", () => {
    const cdWaste: CandidateEvent = {
      id: "c",
      type: "cd-waste",
      t: 0,
      unitNames: [],
      facts: {},
    };
    const marks = timelineMarks([ev("a", 10), cdWaste]);
    expect(marks.marks.map((m) => m.id)).toEqual(["a"]);
  });

  it("empty input yields no marks and maxT >= 1 (no divide-by-zero)", () => {
    const marks = timelineMarks([]);
    expect(marks.marks).toEqual([]);
    expect(marks.maxT).toBe(1);
  });
});
