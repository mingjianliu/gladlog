/**
 * Save-cooldown trigger-HP reference (corpus-derived, GENERATED json) — the
 * `[CD PRIOR]` context fact. "At what lowest-friendly HP does THIS healer
 * cohort (spec × hero tree) normally spend THIS save cooldown?"
 *
 * Provenance: BACKLOG #38 (a)/(f)/(h) (2026-08-23 healer corpus study) and
 * the user ruling of 2026-09-04 (GH #54 (f)): **option 1 — context fact, not
 * a hard threshold**. The study's finding that drove the key shape: within a
 * spec the two hero trees spend the SAME cooldown at nearly the same HP
 * (Pain Suppression 49/49, Ironbark 47/48, Time Dilation 50/50, Spirit Link
 * 28/28), but their save-CD ROSTERS differ (a Lightsmith has no Sacred Bell
 * to spend) — so the tree is in the key, with a spec-wide fallback.
 *
 * Keyed `${spec}|${heroTree}|${spellId}` with a `${spec}|*|${spellId}`
 * fallback. `spec` is `specToString`'s string, `heroTree` is
 * `heroBuildGroupOf`'s name (`"*"` when unresolved) — both sides of the
 * comparison (the corpus scan and the product) resolve through those same
 * two functions. Rating is NOT in the key: the crisis-no-response precedent
 * (user ruling 2026-08-29, 「不要用分数界定」); `meta.cohort` records which
 * population the emitted medians describe.
 *
 * Regenerate (REQUIRED after any change to analysis/cdTriggerPrior.ts'
 * observation predicate or to `isSpendableDefensiveCd`):
 *   npx tsx packages/eval/scripts/cdTriggerPriorScan.ts scan … then
 *   npx tsx packages/eval/scripts/cdTriggerPriorScan.ts emit-table --in <scan.jsonl> \
 *     --out packages/analysis/src/data/cdTriggerPriorGenerated.json
 * (emit-table writes a temp file and copies it in — never redirect `>` into
 * the imported json.)
 *
 * Consumers: `analysis/cdTriggerPrior.ts` (`cdPriorHoldEpisodes`, the
 * product side) and `packages/eval` `promptQualityCheck.ts`'s
 * `checkCdPriorRefConsistency` (re-parses the rendered line and redoes this
 * lookup) — one lookup, both sides.
 */
import { BEHAVIOR_PRIOR_N_FLOOR } from "./behaviorPrior";
import raw from "./cdTriggerPriorGenerated.json";

/** Same n floor as the crisis reference — one number for "is this cell big
 * enough to quote", imported rather than re-typed. */
export const CD_TRIGGER_PRIOR_N_FLOOR = BEHAVIOR_PRIOR_N_FLOOR;

interface Cell {
  n: number;
  /** already the rendered integer (Math.round of the cohort median) */
  medianHpPct: number;
}

const CELLS = (raw as unknown as { cells: Record<string, Cell | undefined> })
  .cells;
export const CD_TRIGGER_PRIOR_META = (
  raw as unknown as { meta: Record<string, unknown> }
).meta;

export interface CdTriggerPriorRef {
  cellKey: string;
  /** true when the tree cell was too small and the spec-wide cell was used */
  fellBack: boolean;
  n: number;
  medianHpPct: number;
}

function wellFormed(c: Cell | undefined): c is Cell {
  return (
    !!c &&
    Number.isFinite(c.n) &&
    Number.isFinite(c.medianHpPct) &&
    Number.isInteger(c.medianHpPct)
  );
}

export const cdTriggerPriorKey = (
  spec: string,
  heroTree: string,
  spellId: string,
): string => `${spec}|${heroTree}|${spellId}`;

/**
 * Look up the cohort reference for one save cooldown. Falls back
 * `spec|tree|id` → `spec|*|id`, taking the first cell that clears the n
 * floor. A `"*"` tree goes straight to the spec-wide cell.
 */
export function lookupCdTriggerPrior(
  spec: string,
  heroTree: string,
  spellId: string,
): CdTriggerPriorRef | null {
  const keys =
    heroTree === "*"
      ? [cdTriggerPriorKey(spec, "*", spellId)]
      : [
          cdTriggerPriorKey(spec, heroTree, spellId),
          cdTriggerPriorKey(spec, "*", spellId),
        ];
  for (let i = 0; i < keys.length; i++) {
    const c = CELLS[keys[i]!];
    if (!wellFormed(c)) continue;
    if (c.n < CD_TRIGGER_PRIOR_N_FLOOR) continue;
    return {
      cellKey: keys[i]!,
      fellBack: i > 0,
      n: c.n,
      medianHpPct: c.medianHpPct,
    };
  }
  return null;
}
