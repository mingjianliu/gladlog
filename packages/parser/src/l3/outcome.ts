import type { MatchResult } from "./model";

export function matchResult(
  winningTeamId: number | null,
  playerTeamId: number | null
): MatchResult {
  if (winningTeamId === null || playerTeamId === null || winningTeamId === 255) {
    return "Unknown";
  }
  return winningTeamId === playerTeamId ? "Win" : "Lose";
}

export function roundWinner(
  deaths: { destId: string }[],
  teamOf: (unitId: string) => number | null
): number | null {
  if (deaths.length === 0) {
    return null;
  }
  const firstDeath = deaths[0]!;
  const team = teamOf(firstDeath.destId);
  if (team === null || team === undefined) {
    return null;
  }
  return team === 0 ? 1 : team === 1 ? 0 : null;
}
