// packages/analysis/src/compare/cellLookup.test.ts
import { describe, expect, it } from "vitest";
import { lookupCell, assignBuildGroup } from "./cellLookup";
import type { ReferenceCorpus, ReferenceCell } from "./corpusTypes";

function cell(p: Partial<ReferenceCell>): ReferenceCell {
  return {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    insufficient: false,
    metrics: {},
    exemplarCrises: [],
    ...p,
  };
}
function corpus(cells: ReferenceCell[]): ReferenceCorpus {
  return {
    wowPatchVersion: "12.1.0",
    builtAt: "now",
    sourceFloor: 2300,
    buildGroups: {},
    cells,
  };
}
const sel = {
  spec: "Discipline Priest",
  bracket: "3v3",
  archetype: "hybrid",
  buildGroup: "offensive",
};

describe("assignBuildGroup", () => {
  const decl = {
    keystoneNodeIds: [82585],
    match: "any" as const,
    groupPresent: "offensive",
    groupAbsent: "standard",
  };
  it("returns groupPresent on any keystone match", () => {
    expect(assignBuildGroup([1, 82585], decl)).toBe("offensive");
    expect(assignBuildGroup([1, 2], decl)).toBe("standard");
  });
});

describe("lookupCell 4-level fallback", () => {
  it("prefers the full archetype×buildGroup cell", () => {
    const c = corpus([
      cell({}),
      cell({ archetype: "*", buildGroup: "offensive", sampleN: 100 }),
    ]);
    const r = lookupCell(c, sel, 30);
    expect(r.cell!.archetype).toBe("hybrid");
    expect(r.fellBackTo).toBe("archetype×buildGroup");
  });
  it("falls back to *×buildGroup when the full cell is missing", () => {
    const c = corpus([
      cell({ archetype: "*", buildGroup: "offensive", sampleN: 100 }),
    ]);
    expect(lookupCell(c, sel, 30).fellBackTo).toBe("*×buildGroup");
  });
  it("falls back to archetype×* then *×*", () => {
    const c = corpus([cell({ buildGroup: "*", sampleN: 100 })]);
    expect(lookupCell(c, sel, 30).fellBackTo).toBe("archetype×*");
    const c2 = corpus([
      cell({ archetype: "*", buildGroup: "*", sampleN: 100 }),
    ]);
    expect(lookupCell(c2, sel, 30).fellBackTo).toBe("*×*");
  });
  it("skips insufficient cells and keeps falling back", () => {
    const c = corpus([
      cell({ insufficient: true, sampleN: 5 }),
      cell({ archetype: "*", buildGroup: "offensive", sampleN: 100 }),
    ]);
    expect(lookupCell(c, sel, 30).fellBackTo).toBe("*×buildGroup");
  });
  it("returns null when nothing sufficient exists", () => {
    const c = corpus([cell({ insufficient: true, sampleN: 5 })]);
    expect(lookupCell(c, sel, 30).cell).toBeNull();
  });
});
