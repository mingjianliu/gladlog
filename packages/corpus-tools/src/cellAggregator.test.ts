import { describe, expect, it } from "vitest";

import { aggregateCells, PerMatchRecord } from "./cellAggregator";
import type { KeystoneGate } from "./keystoneGates";

function rec(archetype: string, offensiveIndex: number): PerMatchRecord {
  return {
    spec: "RestorationShaman",
    bracket: "3v3",
    archetype,
    buildGroup: "*",
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
    const corpus = aggregateCells(recs, 30, {}, []);
    const arche = corpus.cells.find((c) => c.archetype === "cc_swap_burst")!;
    const parent = corpus.cells.find((c) => c.archetype === "*")!;
    expect(arche.sampleN).toBe(40);
    expect(arche.insufficient).toBe(false);
    expect(arche.metrics.offensiveIndex.p50).toBeCloseTo(19.5, 0); // median of 0..39 ≈ 19.5
    expect(parent.sampleN).toBe(40);
  });
  it("marks an under-floor archetype cell insufficient", () => {
    const recs = Array.from({ length: 5 }, (_, i) => rec("rare_arch", i));
    const corpus = aggregateCells(recs, 30, {}, []);
    const cell = corpus.cells.find((c) => c.archetype === "rare_arch")!;
    expect(cell.insufficient).toBe(true);
  });
  it("per-metric n excludes null reactionLatency", () => {
    const recs = Array.from({ length: 30 }, () => {
      const r = rec("cc_swap_burst", 5);
      (r.metrics as any).reactionLatency = null;
      return r;
    });
    const corpus = aggregateCells(recs, 30, {}, []);
    const cell = corpus.cells.find((c) => c.archetype === "cc_swap_burst")!;
    expect(cell.metrics.reactionLatency.n).toBe(0);
  });
  it("winsorizes offensiveIndex to the pool p99 so a healing~0 blowup can't skew p90", () => {
    // 100 normal values ~0.3 plus one 51.16 blowup (healing~0 round).
    const recs: any[] = [];
    for (let i = 0; i < 100; i++)
      recs.push({
        spec: "X",
        bracket: "b",
        archetype: "a",
        buildGroup: "*",
        metrics: { offensiveIndex: 0.3 },
        crisisEvents: [],
      });
    recs.push({
      spec: "X",
      bracket: "b",
      archetype: "a",
      buildGroup: "*",
      metrics: { offensiveIndex: 51.16 },
      crisisEvents: [],
    });
    const corpus = aggregateCells(recs, 30, {}, []);
    const cell = corpus.cells.find((c) => c.archetype === "a");
    // Without winsorization p90 would be pulled toward the 51 outlier; capped it stays ~0.3.
    expect(cell!.metrics.offensiveIndex.p90).toBeLessThan(1);
  });
});

const gate: KeystoneGate = {
  spec: "Discipline Priest",
  keystoneNodeIds: [82585],
  match: "any",
  metric: "offensiveIndex",
  groupPresent: "offensive",
  groupAbsent: "standard",
};
function rec2(
  spec: string,
  archetype: string,
  buildGroup: string,
  oi: number,
): any {
  return {
    spec,
    bracket: "Rated Solo Shuffle",
    archetype,
    buildGroup,
    metrics: { offensiveIndex: oi },
    crisisEvents: [],
  };
}

describe("aggregateCells build-split", () => {
  it("emits archetype×buildGroup, *×buildGroup and *×* for an active gated spec", () => {
    const recs: any[] = [];
    for (let i = 0; i < 40; i++)
      recs.push(rec2("Discipline Priest", "hybrid", "offensive", 0.49));
    for (let i = 0; i < 40; i++)
      recs.push(rec2("Discipline Priest", "hybrid", "standard", 0.2));
    const c = aggregateCells(recs, 30, {}, [gate]);
    const keys = c.cells.map((x) => `${x.archetype}|${x.buildGroup}`).sort();
    expect(keys).toContain("hybrid|offensive");
    expect(keys).toContain("hybrid|standard");
    expect(keys).toContain("*|offensive"); // build parent
    expect(keys).toContain("*|standard");
    expect(keys).toContain("*|*"); // bracket parent, build-agnostic
    expect(keys).toContain("hybrid|*"); // archetype baseline (kept for fallback)
    expect(c.buildGroups["Discipline Priest"]).toEqual({
      keystoneNodeIds: [82585],
      match: "any",
      groupPresent: "offensive",
      groupAbsent: "standard",
    });
  });
  it("collapses to archetype-only when a buildGroup's build-parent is below N_floor", () => {
    const recs: any[] = [];
    for (let i = 0; i < 40; i++)
      recs.push(rec2("Discipline Priest", "hybrid", "standard", 0.2));
    for (let i = 0; i < 5; i++)
      recs.push(rec2("Discipline Priest", "hybrid", "offensive", 0.49));
    const c = aggregateCells(recs, 30, {}, [gate]);
    const keys = c.cells.map((x) => `${x.archetype}|${x.buildGroup}`);
    expect(keys).toContain("hybrid|*"); // collapsed to archetype-only
    expect(keys).not.toContain("hybrid|offensive");
    expect(c.buildGroups["Discipline Priest"]).toBeUndefined();
  });
  it("leaves non-gated specs exactly as SP-B1 (archetype×* and *×*)", () => {
    const recs: any[] = [];
    for (let i = 0; i < 40; i++)
      recs.push(rec2("Mistweaver Monk", "hybrid", "*", 0.1));
    const c = aggregateCells(recs, 30, {}, [gate]);
    const keys = c.cells.map((x) => `${x.archetype}|${x.buildGroup}`).sort();
    expect(keys).toEqual(["*|*", "hybrid|*"]);
    expect(Object.keys(c.buildGroups)).toHaveLength(0);
  });
  it("never emits a build-split cell for a spec absent from gates, even if records carry a non-'*' buildGroup", () => {
    // Defensive: a record with buildGroup="offensive" but whose spec is NOT in
    // gates must collapse to "*", so no undeclared build-split cell is emitted
    // and buildGroups stays empty. (aggregateCells self-consistency, not just
    // reliant on combatToRecords assigning "*" upstream.)
    const recs: any[] = [];
    for (let i = 0; i < 40; i++)
      recs.push(rec2("Restoration Shaman", "hybrid", "offensive", 0.3));
    const c = aggregateCells(recs, 30, {}, [gate]); // gate is Disc-only
    expect(c.cells.every((x) => x.buildGroup === "*")).toBe(true);
    expect(Object.keys(c.buildGroups)).toHaveLength(0);
  });
});
