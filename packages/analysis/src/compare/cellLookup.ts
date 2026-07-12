// packages/analysis/src/compare/cellLookup.ts
import type {
  ReferenceCorpus,
  ReferenceCell,
  BuildGroupDecl,
} from "./corpusTypes";

/** Boolean keystone assignment — the read-side twin of the corpus builder's gate. */
export function assignBuildGroup(
  talents: number[],
  decl: BuildGroupDecl,
): string {
  const set = new Set(talents);
  const present =
    decl.match === "all"
      ? decl.keystoneNodeIds.every((id) => set.has(id))
      : decl.keystoneNodeIds.some((id) => set.has(id));
  return present ? decl.groupPresent : decl.groupAbsent;
}

export function lookupCell(
  corpus: ReferenceCorpus,
  sel: { spec: string; bracket: string; archetype: string; buildGroup: string },
  nFloor: number,
): { cell: ReferenceCell | null; fellBackTo: string } {
  // build-preferring 4-level fallback; each tier is (archetype, buildGroup) keys.
  const tiers: Array<[string, string, string]> = [
    [sel.archetype, sel.buildGroup, "archetype×buildGroup"],
    ["*", sel.buildGroup, "*×buildGroup"],
    [sel.archetype, "*", "archetype×*"],
    ["*", "*", "*×*"],
  ];
  for (const [a, b, label] of tiers) {
    const cell = corpus.cells.find(
      (c) =>
        c.spec === sel.spec &&
        c.bracket === sel.bracket &&
        c.archetype === a &&
        c.buildGroup === b &&
        !c.insufficient &&
        c.sampleN >= nFloor,
    );
    if (cell) return { cell, fellBackTo: label };
  }
  return { cell: null, fellBackTo: "none" };
}
