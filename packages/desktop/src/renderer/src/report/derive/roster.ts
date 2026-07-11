import type { ReportSource } from "./types";

export interface RosterPlayer {
  unitId: string;
  name: string;
  classId: number;
  specId: number;
  teamId: number;
  rating: number | null;
  isLogOwner: boolean;
}
export interface RosterTeam {
  teamId: number;
  players: RosterPlayer[];
  isWinner: boolean;
  isPlayerTeam: boolean;
}

export function deriveRoster(m: ReportSource): RosterTeam[] {
  const byTeam = new Map<number, RosterPlayer[]>();
  for (const u of Object.values(m.units)) {
    if (u.kind !== "Player" || !u.info) continue;
    const p: RosterPlayer = {
      unitId: u.id,
      name: u.name,
      classId: u.classId,
      specId: u.specId,
      teamId: u.info.teamId,
      rating: u.info ? u.info.personalRating : null,
      isLogOwner: u.id === m.playerId,
    };
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  const teams = [...byTeam.entries()].map(([teamId, players]) => ({
    teamId,
    players: players.sort((a, b) => a.name.localeCompare(b.name)),
    isWinner: teamId === m.winningTeamId,
    isPlayerTeam: teamId === m.playerTeamId,
  }));
  teams.sort(
    (a, b) =>
      Number(b.isPlayerTeam) - Number(a.isPlayerTeam) || a.teamId - b.teamId,
  );
  return teams;
}
