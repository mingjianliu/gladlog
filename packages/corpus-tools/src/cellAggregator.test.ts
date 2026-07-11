import { describe, expect, it } from "vitest";
import { aggregateCells, PerMatchRecord } from "./cellAggregator";

function rec(archetype: string, offensiveIndex: number): PerMatchRecord {
  return {
    spec: "RestorationShaman",
    bracket: "3v3",
    archetype,
    metrics: {
      offensiveIndex,
      ccDensity: 1,
      reactionLatency: 2,
      burstResponseCoverage: { answered: 1, windows: 2 },
      defensiveOverlapRatio: 0.1,
      effectiveCastRatio: 0.9,
      ccAvoidanceRate: 0.5,
      ccAvoidedCount: 1,
      ccLandedCount: 1,
    },
    crisisEvents: [`[0:10] crisis ${offensiveIndex}`],
  };
}

describe("aggregateCells", () => {
  it("builds an archetype cell and a bracket-wide parent cell", () => {
    const recs = Array.from({ length: 40 }, (_, i) => rec("cc_swap_burst", i));
    const corpus = aggregateCells(recs, 30);
    const arche = corpus.cells.find((c) => c.archetype === "cc_swap_burst")!;
    const parent = corpus.cells.find((c) => c.archetype === "*")!;
    expect(arche.sampleN).toBe(40);
    expect(arche.insufficient).toBe(false);
    expect(arche.metrics.offensiveIndex.p50).toBeCloseTo(19.5, 0); // median of 0..39 ≈ 19.5
    expect(parent.sampleN).toBe(40);
  });
  it("marks an under-floor archetype cell insufficient", () => {
    const recs = Array.from({ length: 5 }, (_, i) => rec("rare_arch", i));
    const corpus = aggregateCells(recs, 30);
    const cell = corpus.cells.find((c) => c.archetype === "rare_arch")!;
    expect(cell.insufficient).toBe(true);
  });
  it("per-metric n excludes null reactionLatency", () => {
    const recs = Array.from({ length: 30 }, () => {
      const r = rec("cc_swap_burst", 5);
      (r.metrics as any).reactionLatency = null;
      return r;
    });
    const corpus = aggregateCells(recs, 30);
    const cell = corpus.cells.find((c) => c.archetype === "cc_swap_burst")!;
    expect(cell.metrics.reactionLatency.n).toBe(0);
  });
});
