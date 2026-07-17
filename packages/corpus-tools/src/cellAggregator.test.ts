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

describe("P2 对阵 comp cell", () => {
  const rec = (spec: string, enemyComp: string, durationS: number, firstKill: string): any => ({
    spec, bracket: "3v3", archetype: "double-melee", buildGroup: "*",
    enemyComp, durationS, firstEnemyKillSpec: firstKill,
    metrics: { burstCount: 2, burstConversionRate: 0.5, burstIntoDefensiveRatio: 0, alignedBurstRatio: 1, onTargetPct: 0.7, kickLandedRate: 1, kicksJukedCount: 0, firstBurstSeconds: 10 },
    crisisEvents: [],
  });

  it("高频 comp(≥20)出 comp cell,带时长分布与先杀计数;低频不出", async () => {
    const { aggregateCells } = await import("./cellAggregator");
    const recs = [
      ...Array.from({ length: 25 }, (_, i) => rec("Frost Mage", "A + B + C", 100 + i, i < 17 ? "Holy Priest" : "Arms Warrior")),
      ...Array.from({ length: 5 }, () => rec("Frost Mage", "X + Y + Z", 90, "Holy Priest")),
    ];
    const corpus = aggregateCells(recs, 30, { wowPatchVersion: "12.0", sourceFloor: 2300 }, []);
    const comp = corpus.cells.filter((c: any) => c.enemyComp);
    expect(comp).toHaveLength(1);
    expect(comp[0].enemyComp).toBe("A + B + C");
    expect(comp[0].sampleN).toBe(25);
    expect(comp[0].durationS?.n).toBe(25);
    expect(comp[0].firstKill?.["Holy Priest"]).toBe(17);
    // 普通 tier 不受影响,comp cell 不混入 archetype 桶
    expect(corpus.cells.some((c: any) => !c.enemyComp && c.archetype === "double-melee")).toBe(true);
  });

  it("lookupCell:comp tier 置顶命中,无 comp cell 时回退旧链", async () => {
    const { aggregateCells } = await import("./cellAggregator");
    const { lookupCell } = await import("@gladlog/analysis");
    const recs = Array.from({ length: 40 }, (_, i) => rec("Frost Mage", "A + B + C", 100 + i, "Holy Priest"));
    const corpus = aggregateCells(recs, 30, { wowPatchVersion: "12.0", sourceFloor: 2300 }, []) as any;
    const hit = lookupCell(corpus, { spec: "Frost Mage", bracket: "3v3", archetype: "double-melee", buildGroup: "*", enemyComp: "A + B + C" }, 30);
    expect(hit.fellBackTo).toBe("enemyComp");
    expect(hit.cell?.enemyComp).toBe("A + B + C");
    const miss = lookupCell(corpus, { spec: "Frost Mage", bracket: "3v3", archetype: "double-melee", buildGroup: "*", enemyComp: "NO + PE + Q" }, 30);
    expect(miss.fellBackTo).not.toBe("enemyComp");
    expect(miss.cell?.enemyComp).toBeUndefined();
  });
});
