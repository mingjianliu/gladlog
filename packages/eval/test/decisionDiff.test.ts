import { describe, expect, it } from "vitest";

import {
  classifyPair,
  diffTraces,
  summarizeDiff,
  type TraceLine,
} from "../src/explore/decisionDiff";

// GH #96 D6 fixtures (codex astra R2 ruling 4).
const line = (over: Partial<TraceLine>): TraceLine => ({
  opportunityId: "f#1#p|cd-hoarded:p:u:10",
  input: "f#1#p",
  type: "cd-hoarded",
  ownerId: "p",
  spec: "105",
  bracket: "3v3",
  verdict: "suppressed",
  facts: { readyCds: ["102342"] },
  candidateIds: [],
  ...over,
});

describe("decision diff classification", () => {
  it("indeterminate in both runs is classified indeterminate and counted in the denominator", () => {
    const a = [line({ verdict: "indeterminate" })];
    const b = [line({ verdict: "indeterminate" })];
    const rows = diffTraces(a, b);
    expect(rows.map((r) => r.class)).toEqual(["indeterminate"]);
    expect(summarizeDiff(rows).byType["cd-hoarded"]!.eligible).toBe(1);
  });

  it("an exception on one side is evaluation-error, never removed", () => {
    const a = [line({ verdict: "emitted", candidateIds: ["c1"] })];
    const b = [
      line({
        opportunityId: "f#1#p|evaluation",
        verdict: "evaluation-error",
        facts: {},
      }),
    ];
    const rows = diffTraces(a, b);
    expect(
      rows.find((r) => r.opportunityId === a[0]!.opportunityId)!.class,
    ).toBe("evaluation-error");
    expect(rows.some((r) => r.class === "removed")).toBe(false);
  });

  it("classifies removed / new / corrected-fact / unchanged", () => {
    const emitted = line({ verdict: "emitted", candidateIds: ["c1"] });
    const suppressed = line({ verdict: "suppressed", reason: "no-ready-cd" });
    expect(classifyPair(emitted, suppressed, false, false)).toBe("removed");
    expect(classifyPair(suppressed, emitted, false, false)).toBe("new");
    expect(
      classifyPair(
        emitted,
        line({
          verdict: "emitted",
          candidateIds: ["c1"],
          facts: { readyCds: [] },
        }),
        false,
        false,
      ),
    ).toBe("corrected-fact");
    expect(classifyPair(emitted, { ...emitted }, false, false)).toBe(
      "unchanged",
    );
  });

  it("does not depend on which side ran first (symmetric classes swap removed/new only)", () => {
    const a = [
      line({ verdict: "emitted", candidateIds: ["c1"] }),
      line({
        opportunityId: "f#1#p|cd-hoarded:p:u:20",
        verdict: "indeterminate",
      }),
    ];
    const b = [
      line({ verdict: "suppressed" }),
      line({
        opportunityId: "f#1#p|cd-hoarded:p:u:20",
        verdict: "indeterminate",
      }),
    ];
    const ab = summarizeDiff(diffTraces(a, b)).byType["cd-hoarded"]!;
    const ba = summarizeDiff(diffTraces(b, a)).byType["cd-hoarded"]!;
    expect(ab.eligible).toBe(ba.eligible);
    expect(ab.counts.removed).toBe(ba.counts.new);
    expect(ab.counts.indeterminate).toBe(ba.counts.indeterminate);
  });

  it("an opportunity present on one side only, with no error, is unmatched (an id-stability bug)", () => {
    expect(diffTraces([line({})], []).map((r) => r.class)).toEqual([
      "unmatched",
    ]);
  });
});
