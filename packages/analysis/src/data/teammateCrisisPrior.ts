/**
 * Corpus reference for the `[MATE CRISIS]` observation card (GH #95,
 * 2026-09-17): at comparable moments — same bracket, same 2 s-damage
 * severity on the teammate, healer free to act under the SAME exclusions
 * (`analysis/teammateCrisis.ts`) — how often did the teammate die within
 * 10 s when the healer cast nothing, and how often when the healer answered?
 *
 * Both rates are OBSERVED associations (codex R3, 2026-09-17): the card says
 * so out loud and never turns them into "a rescue was available". The table
 * is built by `packages/eval/scripts/teammateCrisisPriorScan.ts emit-table`
 * from the archive; the producer (`context/teammateCrisis.ts`) and the gate
 * (`checkTeammateCrisisRefConsistency`) both resolve a cell through
 * `lookupTeammateCrisisPriorByBin` — one import, both sides.
 */
import { BEHAVIOR_PRIOR_N_FLOOR } from "./behaviorPrior";
import raw from "./teammateCrisisPriorGenerated.json";

/** a cell needs this many clean-idle points AND this many answered points
 * before it is quoted; below it the bracket-wide cell is used, and below that
 * nothing renders */
export const TEAMMATE_CRISIS_PRIOR_N_FLOOR = BEHAVIOR_PRIOR_N_FLOOR;

/** Severity bins on the teammate's 2 s damage. The crisis danger floor is
 * `CRISIS_MIN_DMG2S` (10 %), so the lowest bin starts there. Coarser than
 * `behaviorPrior.dmgBinOf` on purpose — clean-idle points are ~0.5 % of
 * rounds and finer bins would fall under the floor everywhere. */
export type TeammateCrisisDmgBin = "10-20%" | "20-30%" | ">=30%";
export function teammateCrisisDmgBinOf(dmg2s: number): TeammateCrisisDmgBin {
  return dmg2s < 0.2 ? "10-20%" : dmg2s < 0.3 ? "20-30%" : ">=30%";
}

export interface TeammateCrisisPriorCell {
  nIdle: number;
  /** already the rendered integer */
  deathIdlePct: number;
  nAnswered: number;
  deathAnsweredPct: number;
}

const CELLS = (
  raw as unknown as {
    cells: Record<string, TeammateCrisisPriorCell | undefined>;
  }
).cells;
export const TEAMMATE_CRISIS_PRIOR_META = (
  raw as unknown as { meta: Record<string, unknown> }
).meta;

export interface TeammateCrisisPriorRef extends TeammateCrisisPriorCell {
  cellKey: string;
  /** true when the severity cell was too small and the bracket-wide cell
   * (`bracket|*`) was used */
  fellBack: boolean;
}

function wellFormed(
  c: TeammateCrisisPriorCell | undefined,
): c is TeammateCrisisPriorCell {
  return (
    !!c &&
    Number.isInteger(c.nIdle) &&
    Number.isInteger(c.nAnswered) &&
    Number.isInteger(c.deathIdlePct) &&
    Number.isInteger(c.deathAnsweredPct)
  );
}

export const teammateCrisisPriorKey = (
  bracket: string,
  bin: TeammateCrisisDmgBin | "*",
): string => `${bracket}|${bin}`;

/**
 * Resolve the cell for (bracket, severity bin): the fine cell when both of
 * its populations clear the floor, else the bracket-wide cell under the same
 * rule, else null (no card). Takes the BIN, not dmg2s, so the eval gate can
 * redo the lookup from the rendered `[ref=bracket|bin]` alone.
 */
export function lookupTeammateCrisisPriorByBin(
  bracket: string,
  bin: TeammateCrisisDmgBin | "*",
): TeammateCrisisPriorRef | null {
  const tryKey = (key: string, fellBack: boolean) => {
    const c = CELLS[key];
    if (
      wellFormed(c) &&
      c.nIdle >= TEAMMATE_CRISIS_PRIOR_N_FLOOR &&
      c.nAnswered >= TEAMMATE_CRISIS_PRIOR_N_FLOOR
    )
      return { cellKey: key, fellBack, ...c };
    return null;
  };
  if (bin !== "*") {
    const fine = tryKey(teammateCrisisPriorKey(bracket, bin), false);
    if (fine) return fine;
  }
  return tryKey(teammateCrisisPriorKey(bracket, "*"), bin !== "*");
}
