/**
 * Kick-priority reference (corpus-derived, GENERATED json) — GH #78, user
 * rulings 2026-09-12: "1 有用 / 2 可以(50 %) / 3 也可以做 但是记得算距离".
 *
 * "When an enemy healer hardcast a heal on our kill target at ≤ 50 % HP
 * inside a kill window and ≥ 1 friendly could actually kick it (off
 * cooldown, not locked, in range), how often did the target die within 10 s
 * when the heal COMPLETED vs when it was KICKED?" One cell (`all`), no
 * bracket / rating key (user ruling 2026-09-11 on rating buckets; the
 * per-bracket contrasts were +23 … +26 pp on the first archive run, so a
 * bracket key would only shrink n).
 *
 * The contrast is descriptive: kicking the heal is the mechanism that kills
 * the target, so this is the intended effect, not a confound — but the
 * legend still forbids "this kick would have killed them".
 *
 * Regenerate (REQUIRED after any change to `kickPriorityDecisionPoints`):
 *   npx tsx packages/eval/scripts/kickPriorityOutcomeProbe.ts scan …
 *   npx tsx packages/eval/scripts/kickPriorityOutcomeProbe.ts emit-table --in <scan.jsonl> \
 *     > /tmp/table.json && cp /tmp/table.json packages/analysis/src/data/kickPriorityPriorGenerated.json
 */
import { BEHAVIOR_PRIOR_N_FLOOR } from "./behaviorPrior";
import raw from "./kickPriorityPriorGenerated.json";

export const KICK_PRIORITY_PRIOR_N_FLOOR = BEHAVIOR_PRIOR_N_FLOOR;

export interface KickPriorityPriorRef {
  nCompleted: number;
  nInterrupted: number;
  deathCompletedPct: number;
  deathInterruptedPct: number;
}
interface RawCell {
  nCompleted?: number;
  nInterrupted?: number;
  deathCompletedPct?: number;
  deathInterruptedPct?: number;
}
const CELLS = (raw as unknown as { cells: Record<string, RawCell | undefined> }).cells;
export const KICK_PRIORITY_PRIOR_META = (raw as unknown as { meta: Record<string, unknown> }).meta;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function lookupKickPriorityPrior(): KickPriorityPriorRef | null {
  const c = CELLS.all;
  if (!c || !fin(c.nCompleted) || !fin(c.nInterrupted) || !fin(c.deathCompletedPct) || !fin(c.deathInterruptedPct)) return null;
  if (c.nCompleted < KICK_PRIORITY_PRIOR_N_FLOOR || c.nInterrupted < KICK_PRIORITY_PRIOR_N_FLOOR) return null;
  // the sentence quotes "kicked → died more often"; a table where it does not
  // must silence the type rather than argue against itself
  if (c.deathInterruptedPct <= c.deathCompletedPct) return null;
  return { nCompleted: c.nCompleted, nInterrupted: c.nInterrupted, deathCompletedPct: c.deathCompletedPct, deathInterruptedPct: c.deathInterruptedPct };
}
