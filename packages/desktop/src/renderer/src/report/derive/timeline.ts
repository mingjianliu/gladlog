import type { ReportSource } from "./types";

export interface HpPoint {
  t: number;
  hp: number;
  maxHp: number;
}
export interface DeathMark {
  t: number;
  unitId: string;
  name: string;
}
export interface TimelineData {
  start: number;
  end: number;
  hasAdvanced: boolean;
  series: {
    unitId: string;
    name: string;
    classId: number;
    teamId: number;
    points: HpPoint[];
  }[];
  deaths: DeathMark[];
}

export function deriveTimeline(m: ReportSource): TimelineData {
  const players = Object.values(m.units).filter(
    (u) => u.kind === "Player" && u.info,
  );
  const allPlayers = Object.values(m.units).filter((u) => u.kind === 'Player');
  const series = !m.hasAdvancedLogging
    ? []
    : players
        .map((u) => ({
          unitId: u.id,
          name: u.name,
          classId: u.classId,
          teamId: u.info!.teamId,
          points: [...u.advancedSamples]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((s) => ({ t: s.timestamp, hp: s.hp, maxHp: s.maxHp })),
        }))
        .filter((s) => s.points.length > 0)
        .sort((a, b) => a.teamId - b.teamId || a.name.localeCompare(b.name));
  const deaths: DeathMark[] = allPlayers
    .flatMap((u) =>
      u.deaths
        .filter((d) => !d.unconscious)
        .map((d) => ({ t: d.timestamp, unitId: u.id, name: u.name })),
    )
    .sort((a, b) => a.t - b.t);
  return {
    start: m.startTime,
    end: m.endTime,
    hasAdvanced: m.hasAdvancedLogging,
    series,
    deaths,
  };
}
