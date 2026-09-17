/**
 * Reference-table builder for `teammate-crisis-idle` (GH #95, 2026-09-17) —
 * the eval-side half of `data/teammateCrisisPrior.ts`.
 *
 * One row per (healer, teammate) crisis point from the SAME predicate the
 * candidate uses (`teammateCrisisPoints`). A cell holds, for one bracket ×
 * severity bin (and the bracket-wide `*` bin), the two populations the card
 * contrasts — both admitted ONLY after the same feasibility / reach / LoS /
 * mana exclusions (`excluded === null`, codex R2 condition 2):
 *  - idle:     cleanIdle points (healer cast nothing, teammate did not
 *              answer, no innocent explanation) and their 10 s death rate;
 *  - answered: healerAnswered points and theirs.
 * Rates are rendered integers — the producer prints them verbatim and the
 * gate re-derives them from this same table.
 */
import {
  teammateCrisisDmgBinOf,
  type TeammateCrisisPriorCell,
} from "@gladlog/analysis/src/data/teammateCrisisPrior";

export interface TeammateCrisisPriorRow {
  bracket: string;
  dmg2s: number;
  excluded: string | null;
  healerAnswered: boolean;
  cleanIdle: boolean;
  diedWithin10s: boolean;
}

export interface TeammateCrisisPriorTable {
  meta: {
    generatedAt: string;
    corpus: string;
    command: string;
    rows: number;
    nFloor: number;
    predicateVersion: number;
  };
  cells: Record<string, TeammateCrisisPriorCell>;
}

interface Acc {
  idle: number;
  idleDied: number;
  answered: number;
  answeredDied: number;
}

const pct = (num: number, den: number) =>
  den === 0 ? 0 : Math.round((num / den) * 100);

export function buildTeammateCrisisPriorTable(
  rows: TeammateCrisisPriorRow[],
  meta: TeammateCrisisPriorTable["meta"],
): TeammateCrisisPriorTable {
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    if (r.excluded !== null) continue;
    if (!r.cleanIdle && !r.healerAnswered) continue;
    for (const key of [
      `${r.bracket}|${teammateCrisisDmgBinOf(r.dmg2s)}`,
      `${r.bracket}|*`,
    ]) {
      const a =
        acc.get(key) ??
        acc
          .set(key, { idle: 0, idleDied: 0, answered: 0, answeredDied: 0 })
          .get(key)!;
      if (r.cleanIdle) {
        a.idle++;
        if (r.diedWithin10s) a.idleDied++;
      } else {
        a.answered++;
        if (r.diedWithin10s) a.answeredDied++;
      }
    }
  }
  const cells: Record<string, TeammateCrisisPriorCell> = {};
  for (const k of [...acc.keys()].sort()) {
    const a = acc.get(k)!;
    cells[k] = {
      nIdle: a.idle,
      deathIdlePct: pct(a.idleDied, a.idle),
      nAnswered: a.answered,
      deathAnsweredPct: pct(a.answeredDied, a.answered),
    };
  }
  return { meta, cells };
}
