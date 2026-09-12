import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { isPassiveProcCast, specToString } from "./cooldowns";
import { filterRealPresses } from "./castPress";
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
  // BACKLOG #36(a): echo copies / channel ticks / same-instant double records
  // are not presses — without the cut a Preservation Evoker's cast count
  // nearly doubles and Divine Hymn inflates 5×, poisoning every sequence this
  // function reports (and the corpus reference_vectors built from it).
  const casts = filterRealPresses(
    player.spellCastEvents.filter(
      (e) =>
        e.spellName &&
        e.logLine?.event === "SPELL_CAST_SUCCESS" &&
        !isPassiveProcCast(e),
    ),
  )
    .map((e) => ({
      spellId: e.spellId,
      name: e.spellName as string,
      time: (e.logLine.timestamp - match.startTime) / 1000,
    }))
    .sort((a, b) => a.time - b.time);

  // Opener names must go through the English index like coreSequences below —
  // raw log names are client-locale, so the same opener splits into an EN and
  // a ZH cell entry and CJK leaks into the prompt (caught by the #37 demo:
  // "奥术弹幕 → 奥术弹幕" listed beside "Arcane Barrage → Arcane Barrage").
  const opener = casts
    .filter((c) => c.time <= 30)
    .map((c) => getEnglishSpellName(c.spellId ?? "", c.name));

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
          // Use the ally's spec name, not their raw character name: spec is the
          // exemplar-relevant identity, is ASCII by construction, and avoids
          // bundling real ladder players' (often non-ASCII) names into the
          // static corpus. `u.spec` is a numeric spec id, so map it to a name.
          targetName: u.spec ? specToString(u.spec) : "ally",
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
