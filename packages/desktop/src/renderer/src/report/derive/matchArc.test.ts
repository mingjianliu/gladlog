import { describe, expect, it } from "vitest";

import fixture from "../../../../../test/fixtures/report-match.json";
import { deriveMatchArc } from "./matchArc";
import type { ReportSource } from "./types";

// #10 T4: deriveMatchArc only assembles the arguments for
// buildMatchArcStructured (the same legacy/owner/friends/enemies assembly
// pattern as keyMoments.ts:129/:149).
// report-match.json is a 15.5s 2v2 fixture — it naturally lands in
// buildMatchArcStructured's <90s collapsed branch (the early/late two-phase
// form), covering the short-match path along the way.
const source = fixture as unknown as ReportSource;

describe("deriveMatchArc", () => {
  it("短局(<90s)折叠为 early/late 两相位,边界与 fixture 时长对齐", () => {
    const phases = deriveMatchArc(source);
    expect(phases.map((p) => p.phase)).toEqual(["early", "late"]);
    expect(phases[0]!.fromS).toBe(0);
    const durationSeconds = (source.endTime - source.startTime) / 1000;
    expect(phases[phases.length - 1]!.toS).toBeCloseTo(durationSeconds, 1);
  });

  it("坏数据(缺 units)stub-safe 返回 []", () => {
    expect(deriveMatchArc({} as unknown as ReportSource)).toEqual([]);
  });
});
