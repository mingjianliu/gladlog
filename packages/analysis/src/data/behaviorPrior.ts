/**
 * Behavior-prior reference (corpus-derived, GENERATED json): outcome-based
 * reference for a crisis decision point, per bracket × damage bin (Task 10 /
 * spec §1b, 2026-08-29 amendment). Consumed by candidates/crisisNoResponse.ts
 * (the rendered reference) AND by packages/eval promptQualityCheck's
 * checkBehaviorPriorConsistency (the gate that re-parses the rendered
 * numbers) — one lookup, both sides.
 *
 * Regenerate (spec §3; REQUIRED after any change to crisisDecisionPoints.ts):
 *   npx tsx packages/eval/scripts/behaviorPriorScan.ts scan … && emit-table …
 *   into a TEMP file, then cp over packages/analysis/src/data/
 *   behaviorPriorGenerated.json — never `>` straight into the imported json
 *   (a crash mid-write would truncate what the product imports).
 * Runbook: docs/commands/update-wow-data.md step 6b-pre-2.
 *
 * Current table: eval-private/reports/behavior-prior-2026-09-02/ —
 * regenerated 2026-09-02 over the same 18,134-match 12.1 archive after
 * GH #34 chg2b anchored crisisDecisionPoints onto the render grid (16,040 →
 * 13,364 decision points; crossings no whole rendered second can see are
 * dropped). Same 9 cells, no death-contrast sign flip, max contrast move
 * 3 pp vs the 2026-08-28 v8 basis (reports/behavior-prior-2026-08-28/).
 */
import raw from "./behaviorPriorGenerated.json";

/** Which population a decision point / reference cell belongs to (spec §1d,
 * GH #59). Declared here (data/) rather than in crisisDecisionPoints.ts
 * (analysis/) — analysis already imports from data/, so an analysis → data
 * import is the non-cyclic direction; the reverse (data importing the type
 * from analysis/crisisDecisionPoints.ts) would cycle. crisisDecisionPoints.ts
 * re-exports this same type rather than declaring its own. */
export type CrisisRole = "healer" | "dps";
export const BEHAVIOR_PRIOR_N_FLOOR = 50;
type DmgBin = "<10%" | "10-20%" | ">=20%";
export function dmgBinOf(dmg2s: number): DmgBin {
  return dmg2s < 0.1 ? "<10%" : dmg2s < 0.2 ? "10-20%" : ">=20%";
}
/** Which death predicate a cell's death rates were computed under (spec
 * §1c): `ownDeath10s` = the owner's own death within 10 s;
 * `teamDeath15s` = ANY friendly player's death within 15 s (Rated Solo
 * Shuffle — a healer diving to 40% there usually isn't the kill target, the
 * cost lands on a teammate instead). Exported for
 * packages/eval/src/explore/behaviorPriorTable.ts (the table builder) to
 * import — one type, not two kept in sync by convention. */
export type BehaviorPriorOutcome = "ownDeath10s" | "teamDeath15s";
function isValidOutcome(v: unknown): v is BehaviorPriorOutcome {
  return v === "ownDeath10s" || v === "teamDeath15s";
}
/** Single source for the enum-token → prose translation (crisis-no-response
 * follow-up, 2026-08-29): the rendered `facts.refOutcome` must be a human
 * phrase a coaching model can paste into a sentence, never the bare
 * `BehaviorPriorOutcome` token. `crisisNoResponse.ts` renders through this;
 * `promptQualityCheck.ts`'s `checkBehaviorPriorConsistency` re-derives
 * through the same function — one place, both sides (CLAUDE.md
 * shared-predicate rule). The enum itself still travels as
 * `facts.refOutcomeKey` for anything that needs to branch on it. */
// Role-neutral (spec §1d, GH #59): `ownDeath10s` is now the outcome for
// BOTH a healer's non-Solo-Shuffle crossing and every DPS crossing (dps
// cells are always ownDeath10s, spec §1d — outcomeOf), so its phrase can no
// longer say "healer". `teamDeath15s` stays healer-only (outcomeOf never
// returns it for a dps role), so its wording is unaffected.
const OUTCOME_PHRASE: Record<BehaviorPriorOutcome, string> = {
  ownDeath10s: "this player died within 10 s",
  teamDeath15s: "a teammate (or the healer) died within 15 s",
};
export function outcomePhrase(o: BehaviorPriorOutcome): string {
  return OUTCOME_PHRASE[o];
}
interface Cell {
  nNoResp: number;
  deathNoResp: number;
  nResp: number;
  deathResp: number;
  top: [string, number][];
  outcome: BehaviorPriorOutcome;
}
// I5: a cell key existing in the JSON is not proof the cell itself is well
// formed — index access can still miss (unknown key) or hit a malformed
// entry, so the static type admits both.
const CELLS = (raw as unknown as { cells: Record<string, Cell | undefined> })
  .cells;

export interface BehaviorPriorRef {
  cellKey: string;
  fellBack: boolean;
  /** ALL ranked players who did NOT respond, and their 10s death rate (int %) */
  nNoResp: number;
  deathNoRespPct: number;
  /** ALL ranked players who DID respond, and their 10s death rate (int %) */
  nResp: number;
  deathRespPct: number;
  /** among players of this role who DID respond, the most common answers, shares as int %
   * (no rank filter — the rating line is out entirely, 2026-08-29 amendment) */
  top: [string, number][];
  /** which death predicate deathNoRespPct/deathRespPct were computed under
   * (spec §1c) */
  outcome: BehaviorPriorOutcome;
}
const pct = (f: number) => Math.round(f * 100);

export function lookupBehaviorPrior(
  bracket: string,
  role: CrisisRole,
  dmg2s: number,
): BehaviorPriorRef | null {
  const fineKey = `${bracket}|${role}|${dmgBinOf(dmg2s)}`;
  const starKey = `${bracket}|${role}|*`;
  const fine = CELLS[fineKey];
  const cell =
    fine && fine.nNoResp >= BEHAVIOR_PRIOR_N_FLOOR ? fine : CELLS[starKey];
  if (!cell) return null;
  // I5: a malformed cell (non-finite counts, or a missing/invalid `outcome`
  // — spec §1c) must fail closed, not render NaN/Infinity/undefined into the
  // prompt.
  if (
    !Number.isFinite(cell.nNoResp) ||
    !Number.isFinite(cell.deathNoResp) ||
    !Number.isFinite(cell.nResp) ||
    !Number.isFinite(cell.deathResp) ||
    !isValidOutcome(cell.outcome)
  )
    return null;
  const fellBack = cell !== fine;
  return {
    cellKey: fellBack ? starKey : fineKey,
    fellBack,
    nNoResp: cell.nNoResp,
    deathNoRespPct: pct(cell.deathNoResp),
    nResp: cell.nResp,
    deathRespPct: pct(cell.deathResp),
    top: cell.top.map(([k, f]) => [k, pct(f)] as [string, number]),
    outcome: cell.outcome,
  };
}
