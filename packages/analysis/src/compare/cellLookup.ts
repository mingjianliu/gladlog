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

/** Minimum sample size for a reference cell to be used (read side,
 * `lookupCell`) and to be considered non-insufficient when the corpus is
 * built (write side, `aggregateCells` / `validateCorpus`). One constant:
 * `packages/desktop/src/main/compare.ts` and
 * `packages/corpus-tools/scripts/buildCorpus.ts` both import it — they used
 * to each declare `const N_FLOOR = 30` (found 2026-08-21 while grounding the
 * dashboard small-N work; registered in docs/predicate-index.md). */
export const REFERENCE_CELL_N_FLOOR = 30;

/**
 * Does the corpus actually carry a usable cell for this build group? — the
 * question the read side has to answer BEFORE `lookupCell`, when it picks
 * which build group to ask for (hero tree vs keystone gate, user ruling
 * 2026-09-11).
 *
 * It lives here, next to `lookupCell`, because it must accept exactly what
 * `lookupCell` accepts: same spec AND bracket, a real build cell (not a comp
 * cell), not `insufficient`, and at or above the floor. A looser copy in the
 * caller would pick a group `lookupCell` then cannot honour, and the answer
 * would silently degrade to the build-agnostic cell — the exact failure this
 * predicate exists to prevent.
 */
export function corpusHasBuildGroup(
  corpus: ReferenceCorpus,
  sel: { spec: string; bracket: string; buildGroup: string },
  nFloor: number,
): boolean {
  if (sel.buildGroup === "*") return false;
  return corpus.cells.some(
    (c) =>
      c.spec === sel.spec &&
      c.bracket === sel.bracket &&
      c.buildGroup === sel.buildGroup &&
      !c.enemyComp &&
      !c.insufficient &&
      c.sampleN >= nFloor,
  );
}

export function lookupCell(
  corpus: ReferenceCorpus,
  sel: {
    spec: string;
    bracket: string;
    archetype: string;
    buildGroup: string;
    /** P2: enemy comp signature; when an expert cell for the same comp is
     * found it takes priority (contextualized comparison). */
    enemyComp?: string;
  },
  nFloor: number,
): { cell: ReferenceCell | null; fellBackTo: string } {
  // P2 top tier: the comp cell for the same enemy comp (archetype/buildGroup
  // are *). Fallback chain: enemyComp -> archetype×buildGroup -> … -> *×*.
  if (sel.enemyComp) {
    const compCell = corpus.cells.find(
      (c) =>
        c.spec === sel.spec &&
        c.bracket === sel.bracket &&
        c.enemyComp === sel.enemyComp &&
        !c.insufficient,
    );
    if (compCell) return { cell: compCell, fellBackTo: "enemyComp" };
  }
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
        !c.enemyComp &&
        !c.insufficient &&
        c.sampleN >= nFloor,
    );
    if (cell) return { cell, fellBackTo: label };
  }
  return { cell: null, fellBackTo: "none" };
}
