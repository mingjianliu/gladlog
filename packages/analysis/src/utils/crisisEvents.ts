import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { PASSIVE_SPELL_BLOCKLIST } from "./cooldowns";
import { getEnglishSpellName } from "../data/spellEffectData";

export interface IExtractedRotations {
  opener: string[];
  coreSequences: string[];
  crisisEvents: string[];
}

export function extractRotations(
  player: ICombatUnit,
  match: AtomicArenaCombat,
): IExtractedRotations {
  const casts = player.spellCastEvents
    .filter(
      (e) =>
        e.spellName &&
        e.logLine?.event === "SPELL_CAST_SUCCESS" &&
        !PASSIVE_SPELL_BLOCKLIST.has(e.spellName),
    )
    .map((e) => ({
      spellId: e.spellId,
      name: e.spellName as string,
      time: (e.logLine.timestamp - match.startTime) / 1000,
    }))
    .sort((a, b) => a.time - b.time);

  const opener = casts.filter((c) => c.time <= 30).map((c) => c.name);

  const seqCounts: Record<string, number> = {};
  for (let i = 0; i < casts.length - 2; i++) {
    const chain = `${getEnglishSpellName(casts[i].spellId ?? "", casts[i].name)} -> ${getEnglishSpellName(casts[i + 1].spellId ?? "", casts[i + 1].name)} -> ${getEnglishSpellName(casts[i + 2].spellId ?? "", casts[i + 2].name)}`;
    seqCounts[chain] = (seqCounts[chain] || 0) + 1;
  }
  const coreSequences = Object.entries(seqCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([seq, count]) => `${seq} (used ${count}x)`);

  const teamUnits = (Object.values(match.units) as ICombatUnit[]).filter(
    (u) => u.type === CombatUnitType.Player && u.reaction === player.reaction,
  );
  const allTeamHpRecords = teamUnits
    .flatMap((u) =>
      (u.advancedActions || [])
        .filter(
          (a: any) =>
            a.advanced &&
            a.advancedActorId === u.id &&
            a.advancedActorMaxHp > 0,
        )
        .map((a: any) => ({
          targetName: u.name,
          time: (a.logLine.timestamp - match.startTime) / 1000,
          pct: (a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100,
        })),
    )
    .sort((a, b) => a.time - b.time);

  const crisisEvents: string[] = [];
  let lastCrisisTime = -999;
  for (const record of allTeamHpRecords) {
    if (record.pct < 40 && record.time - lastCrisisTime > 15) {
      lastCrisisTime = record.time;
      const responseCasts = casts
        .filter((c) => c.time >= record.time && c.time <= record.time + 6)
        .map((c) => getEnglishSpellName(c.spellId ?? "", c.name));
      if (responseCasts.length > 0) {
        crisisEvents.push(
          `At ${record.time.toFixed(1)}s (Teammate ${record.targetName} HP: ${Math.floor(record.pct)}%): ${responseCasts.join(" -> ")}`,
        );
      }
    }
  }
  return { opener, coreSequences, crisisEvents };
}
