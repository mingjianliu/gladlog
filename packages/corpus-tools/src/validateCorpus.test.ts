import { describe, expect, it } from "vitest";
import { validateCorpus } from "./validateCorpus";
import type { Corpus } from "./cellAggregator";

function corpusWith(cell: any): Corpus {
  return {
    wowPatchVersion: "11.0.7",
    builtAt: "now",
    sourceFloor: 2300,
    cells: [cell],
    buildGroups: {},
  };
}
const goodCell = {
  spec: "RestorationShaman",
  bracket: "3v3",
  archetype: "cc_swap_burst",
  sampleN: 40,
  insufficient: false,
  metrics: { reactionLatency: { p10: 1, p50: 2, p90: 3, n: 40 } },
  exemplarCrises: [["[0:10] taken Chaos Bolt"]],
  buildGroup: "*",
};

describe("validateCorpus", () => {
  it("passes a clean corpus", () => {
    expect(validateCorpus(corpusWith(goodCell), 30)).toEqual([]);
  });
  it("flags the 1.5 latency sentinel when it recurs with real records (n>0)", () => {
    // The real failure mode: a reintroduced 1.5s default arrives WITH records,
    // so the median is exactly 1.5. (The old n===0 guard was unsatisfiable and
    // missed this.)
    const bad = {
      ...goodCell,
      metrics: { reactionLatency: { p10: 1.5, p50: 1.5, p90: 1.5, n: 5 } },
    };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /1\.5 sentinel/.test(v)),
    ).toBe(true);
  });
  it("does not flag a legitimate reactionLatency distribution", () => {
    // goodCell has p50=2 with n=40 — a real median, must pass clean.
    expect(
      validateCorpus(corpusWith(goodCell), 30).some((v) => /sentinel/.test(v)),
    ).toBe(false);
  });
  it("flags non-ASCII crisis spell names", () => {
    const bad = { ...goodCell, exemplarCrises: [["[0:10] 承受 混乱之箭"]] };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /non-ASCII/.test(v)),
    ).toBe(true);
  });
  it("flags a cell below floor not marked insufficient", () => {
    const bad = { ...goodCell, sampleN: 5, insufficient: false };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /insufficient/.test(v)),
    ).toBe(true);
  });
  it("flags missing/unknown wowPatchVersion", () => {
    const c = corpusWith(goodCell);
    c.wowPatchVersion = "unknown";
    expect(validateCorpus(c, 30).some((v) => /wowPatchVersion/.test(v))).toBe(
      true,
    );
  });
  it("flags a cell at/above floor wrongly marked insufficient", () => {
    const bad = { ...goodCell, sampleN: 40, insufficient: true };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /insufficient/.test(v)),
    ).toBe(true);
  });
  it("flags a non-'*' buildGroup cell whose spec is not declared in buildGroups", () => {
    const bad = { ...goodCell, buildGroup: "offensive" };
    const c = corpusWith(bad); // buildGroups is {}
    expect(
      validateCorpus(c, 30).some((v) => /undeclared buildGroup/.test(v)),
    ).toBe(true);
  });
  it("passes a declared build-split cell", () => {
    const cell = {
      ...goodCell,
      spec: "Discipline Priest",
      buildGroup: "offensive",
      sampleN: 40,
    };
    const c = corpusWith(cell);
    c.buildGroups = {
      "Discipline Priest": {
        keystoneNodeIds: [82585],
        match: "any",
        groupPresent: "offensive",
        groupAbsent: "standard",
      },
    };
    expect(validateCorpus(c, 30).filter((v) => /buildGroup/.test(v))).toEqual(
      [],
    );
  });
  it("flags a buildGroups decl with empty keystoneNodeIds", () => {
    const c = corpusWith(goodCell);
    c.buildGroups = {
      X: {
        keystoneNodeIds: [],
        match: "any",
        groupPresent: "a",
        groupAbsent: "b",
      } as any,
    };
    expect(validateCorpus(c, 30).some((v) => /keystoneNodeIds/.test(v))).toBe(
      true,
    );
  });
  it("flags an activated buildGroup whose build-parent cell is below N_floor (guard post-assertion)", () => {
    // A declared gate whose *×offensive build-parent has sampleN < nFloor should
    // never happen (the guard prevents it) — but the validator must catch it if
    // aggregateCells ever regresses.
    const parent = {
      ...goodCell,
      spec: "Discipline Priest",
      archetype: "*",
      buildGroup: "offensive",
      sampleN: 12,
      insufficient: true,
    };
    const c = corpusWith(parent);
    c.buildGroups = {
      "Discipline Priest": {
        keystoneNodeIds: [82585],
        match: "any",
        groupPresent: "offensive",
        groupAbsent: "standard",
      },
    };
    expect(
      validateCorpus(c, 30).some((v) =>
        /build-parent .* below N_floor/.test(v),
      ),
    ).toBe(true);
  });
});
