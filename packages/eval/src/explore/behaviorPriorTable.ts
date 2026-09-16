/**
 * behaviorPriorTable.ts — aggregates `behaviorPriorScan.ts` scan rows (each
 * one a `DecisionPoint` from the shared crisis predicate,
 * `packages/analysis/src/analysis/crisisDecisionPoints.ts`) into the
 * reference table for `crisis-no-response`.
 *
 * Task 10 / spec §1b (2026-08-29 amendment, after the value gate), further
 * amended same-day ("不管分数线" — the rating line is out entirely): the
 * reference is OUTCOME-based, not rank-based — "died within 10 s" for ALL
 * ranked (pct != null) players, split by whether they responded
 * (`nNoResp`/`deathNoResp` vs `nResp`/`deathResp` — field names as of spec
 * §1c; §1b's amendment introduced them as `death10NoResp`/`death10Resp`,
 * renamed when the death predicate stopped being fixed at 10 s). `top` (the
 * most common answers) is now ALSO computed over the full `nResp` population —
 * there is no rank filter anywhere in this table. `dangerous` (gate 5:
 * dmg2s >= CRISIS_MIN_DMG2S) and `feasible` are applied to every population —
 * a gated point (in CC, locked out, or died in the window) was never a fair
 * test of the player's response, and a sub-floor crossing showed no
 * death-rate gradient at all (measured: <10% dmg2s died 8.8% unresponded vs
 * 7.8% responded — flat; >=10% died 22–23%), so both are excluded from the
 * reference the same way the product's `crisis-no-response` candidate
 * excludes them from an accusation.
 *
 * Spec §1c (2026-08-29, third ruling): Solo Shuffle's cells count ANY
 * friendly death (owner included) within 15 s instead of the owner's own
 * death within 10 s — a healer diving to 40% in Solo Shuffle usually isn't
 * the kill target (measured: healer-death ÷ crossing 0.11 in Solo vs 0.29 in
 * 3v3), the cost lands on a teammate instead (no-response → 15s any-friend
 * death 25% vs 15% for responders, 3,000-match outcome scan). `outcome`
 * records which predicate a cell used so the renderer and the gate can both
 * say so.
 */
import type { DecisionPoint } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import type {
  BehaviorPriorOutcome,
  CrisisRole,
} from "@gladlog/analysis/src/data/behaviorPrior";
import { dmgBinOf } from "@gladlog/analysis/src/data/behaviorPrior";

/** Brackets whose cells count any friendly death (spec §1c) — HEALER cells
 * only (spec §1d, GH #59): a DPS owner is the kill target far more often, so
 * their cells always count the owner's own death, even in Solo Shuffle. */
export const TEAM_OUTCOME_BRACKETS = new Set<string>(["Rated Solo Shuffle"]);
export function outcomeOf(
  bracket: string,
  role: CrisisRole,
): BehaviorPriorOutcome {
  return role === "healer" && TEAM_OUTCOME_BRACKETS.has(bracket)
    ? "teamDeath15s"
    : "ownDeath10s";
}

export interface BehaviorPriorRow {
  bracket: string;
  /** spec §1d: which population this decision point belongs to. Callers
   * building rows from pre-§1d JSONL (no `role` field on disk) must default
   * it to "healer" themselves before constructing this row — this type does
   * not carry an implicit default. */
  role: CrisisRole;
  pct: number | null;
  point: DecisionPoint;
}
export interface BehaviorPriorCell {
  /** ALL ranked players (pct != null), feasible && dangerous && !responded */
  nNoResp: number;
  /** death rate under `outcome`'s predicate (spec §1c) */
  deathNoResp: number;
  /** ALL ranked players, feasible && dangerous && responded — also `top`'s
   * denominator: share of nResp, 2 dp. */
  nResp: number;
  deathResp: number;
  top: [string, number][];
  /** which death predicate this cell's bracket uses (spec §1c) */
  outcome: BehaviorPriorOutcome;
}
export interface BehaviorPriorTable {
  meta: {
    generatedAt: string;
    corpus: string;
    weeks: string[];
    command: string;
    predicateVersion: number;
  };
  cells: Record<string, BehaviorPriorCell>;
}
const RESPONSE_KEYS = [
  "selfHeal",
  "wall",
  "protective",
  "external",
  "control",
  "kite",
  "carriedHeal",
  "attackerMoved",
] as const;

export { dmgBinOf };
const r2 = (x: number) => Math.round(x * 100) / 100;

function deathRate(
  points: DecisionPoint[],
  outcome: BehaviorPriorOutcome,
): number {
  if (!points.length) return 0;
  const died =
    outcome === "teamDeath15s"
      ? points.filter(
          (p) =>
            // (packages/eval/scripts/behaviorPriorScan.ts output predating
            // §1c) don't carry friendDiedWithin15s at all; treat a missing
            // value as false rather than let it poison the temp table.
            p.friendDiedWithin15s,
        ).length
      : points.filter((p) => p.diedWithin10s).length;
  return r2(died / points.length);
}

function cellOf(
  all: DecisionPoint[],
  outcome: BehaviorPriorOutcome,
): BehaviorPriorCell {
  const noResp = all.filter((p) => !p.responded);
  const resp = all.filter((p) => p.responded);
  const nResp = resp.length;
  const counts = RESPONSE_KEYS.map(
    (k) => [k, resp.filter((p) => p.responses[k]).length] as const,
  )
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, c]) => [k, nResp ? r2(c / nResp) : 0] as [string, number]);
  return {
    nNoResp: noResp.length,
    deathNoResp: deathRate(noResp, outcome),
    nResp,
    deathResp: deathRate(resp, outcome),
    top: counts,
    outcome,
  };
}
export function buildBehaviorPriorTable(
  rows: BehaviorPriorRow[],
  meta: BehaviorPriorTable["meta"],
): BehaviorPriorTable {
  const groups = new Map<string, DecisionPoint[]>();
  const keyMeta = new Map<string, { bracket: string; role: CrisisRole }>();
  for (const r of rows) {
    if (r.pct == null || !r.point.feasible || !r.point.dangerous) continue;
    for (const key of [
      `${r.bracket}|${r.role}|${dmgBinOf(r.point.dmg2s)}`,
      `${r.bracket}|${r.role}|*`,
    ]) {
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r.point);
      keyMeta.set(key, { bracket: r.bracket, role: r.role });
    }
  }
  const cells: Record<string, BehaviorPriorCell> = {};
  for (const k of [...groups.keys()].sort()) {
    const m = keyMeta.get(k)!;
    cells[k] = cellOf(groups.get(k)!, outcomeOf(m.bracket, m.role));
  }
  return { meta, cells };
}
