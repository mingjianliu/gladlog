/**
 * kick-eaten castStartT / burstAfterCastStart (work order 2026-10-14b fix 12):
 * 1bad0a5c @15 — Mind Control began 14.424, Bloodlust + Ascendance went out
 * at 15.039, the kick landed 15.400; on the 0:15 grid nothing said which
 * came first.
 */
import { describe, expect, it } from "vitest";

import { castStartFacts } from "../src/analysis/candidateFindings";

describe("castStartFacts", () => {
  const p = {
    ours: {
      burstAgainst: ["Bloodlust", "Ascendance", "Avatar"],
      burstFromS: { Bloodlust: 15.039, Ascendance: 15.039, Avatar: 9 },
    },
    theirs: { burstAgainst: [] },
    burstReady: [],
  };
  it("the cast's start, and the bursts that came after it, seconds into the cast", () => {
    expect(castStartFacts(p, 14.424)).toEqual({
      castStartT: "14.4",
      burstAfterCastStart: "Bloodlust +0.6s、Ascendance +0.6s",
    });
  });
  it("no cast start → nothing; no burst after it → only the start", () => {
    expect(castStartFacts(p, null)).toEqual({});
    expect(castStartFacts(p, 15.2)).toEqual({ castStartT: "15.2" });
  });
});
