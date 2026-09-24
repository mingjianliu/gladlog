/**
 * burstWindowPriorTable.ts — aggregates `burstWindowScan.ts` rows (each one a
 * `BurstWindowDecisionPoint` from the shared predicate,
 * `packages/analysis/src/analysis/burstWindowDecisionPoints.ts`) into the
 * reference table `packages/analysis/src/data/burstWindowPriorGenerated.json`.
 *
 * Same construction as `behaviorPriorTable.ts` (GH #58/#59's crisis reference)
 * and for the same reason: the reference is OUTCOME-based, not rank-based —
 * "did a friendly die inside this burst window", split by whether the team
 * answered within 8 s. Rating is deliberately NOT part of the key (the user's
 * 2026-08-29 ruling, 「不要用分数界定」 — the crisis-no-response precedent).
 *
 * Only FEASIBLE windows enter either population: a window nobody could have
 * answered (no tool off cooldown anywhere on the team, or everyone hard-CC'd
 * for the whole 8 s) was never a test of the team's decision, so counting it
 * would put "we were stunned" into the same bucket as "we did nothing"
 * (Value-Gate rule 3).
 */
import type { BurstWindowDecisionPoint } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";

export interface BurstWindowPriorRow {
  bracket: string;
  point: BurstWindowDecisionPoint;
}

interface BurstWindowPriorCell {
  /** feasible windows the team ANSWERED within 8 s */
  nResp: number;
  /** share of those in which a friendly still died inside the window */
  deathResp: number;
  /** feasible windows the team did NOT answer */
  nNoResp: number;
  deathNoResp: number;
  /** most common answers among `nResp`, share of nResp, 2 dp */
  topResponses: [string, number][];
}

interface BurstWindowPriorTable {
  meta: {
    generatedAt: string;
    corpus: string;
    command: string;
    predicateVersion: number;
  };
  cells: Record<string, BurstWindowPriorCell>;
}

const RESPONSE_KEYS = [
  "wall",
  "external",
  "healCd",
  "control",
  "kite",
  "attackerMoved",
] as const;
const r2 = (x: number) => Math.round(x * 100) / 100;

function cellOf(points: BurstWindowDecisionPoint[]): BurstWindowPriorCell {
  const resp = points.filter((p) => p.responded);
  const no = points.filter((p) => !p.responded);
  const deathRate = (ps: BurstWindowDecisionPoint[]) =>
    ps.length ? r2(ps.filter((p) => p.anyFriendlyDeath).length / ps.length) : 0;
  const topResponses = RESPONSE_KEYS.map(
    (k) => [k, resp.filter((p) => p.responses[k]).length] as const,
  )
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(
      ([k, c]) =>
        [k, resp.length ? r2(c / resp.length) : 0] as [string, number],
    );
  return {
    nResp: resp.length,
    deathResp: deathRate(resp),
    nNoResp: no.length,
    deathNoResp: deathRate(no),
    topResponses,
  };
}

/** `${bracket}|${leadCdSpellId}` with a `${bracket}|*` fallback and a global
 * `*|*` one — the same three-level shape `lookupBurstWindowPrior` reads. */
export function buildBurstWindowPriorTable(
  rows: BurstWindowPriorRow[],
  meta: BurstWindowPriorTable["meta"],
): BurstWindowPriorTable {
  const groups = new Map<string, BurstWindowDecisionPoint[]>();
  for (const r of rows) {
    if (!r.point.feasible) continue;
    for (const key of [
      `${r.bracket}|${r.point.leadCd.spellId}`,
      `${r.bracket}|*`,
      `*|*`,
    ]) {
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r.point);
    }
  }
  const cells: Record<string, BurstWindowPriorCell> = {};
  for (const k of [...groups.keys()].sort()) cells[k] = cellOf(groups.get(k)!);
  return { meta, cells };
}
