import type { ReportSource } from "./types";

export interface CastRow {
  t: number;
  spellId: number;
  spellName: string;
  targetName: string;
  byPet: boolean;
}
export interface AuraRow {
  t: number;
  spellId: number;
  spellName: string;
  auraType: "BUFF" | "DEBUFF";
  applied: boolean;
}

export function deriveCasts(m: ReportSource, unitId: string): CastRow[] {
  const u = m.units[unitId];
  if (!u) return [];
  const row =
    (byPet: boolean) =>
    (e: (typeof u.casts)[number]): CastRow => ({
      t: e.timestamp,
      spellId: e.spellId,
      spellName: e.spellName,
      targetName: e.destName,
      byPet,
    });
  return [...u.casts.map(row(false)), ...u.petCasts.map(row(true))].sort(
    (a, b) => a.t - b.t,
  );
}

export function deriveAuraEvents(m: ReportSource, unitId: string): AuraRow[] {
  const u = m.units[unitId];
  if (!u) return [];
  return [...u.auraEvents]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({
      t: e.timestamp,
      spellId: e.spellId,
      spellName: e.spellName,
      auraType: e.auraType,
      applied: !e.eventName.includes("REMOVED"),
    }));
}
