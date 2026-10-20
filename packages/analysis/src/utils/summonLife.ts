/**
 * summonLife.ts — when a summon came and when it was killed, as the log says
 * (moved out of context/timelineHelpers.ts with fact2 R6, 2026-10-20, so the
 * utils layer — ccTrinketAnalysis — can read the same two facts).
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

/** When the unit was summoned (its own SPELL_SUMMON), or null. */
export function summonedAtMs(unit: ICombatUnit): number | null {
  const e = unit.actionIn.find(
    (a) => a.logLine.event === LogEvent.SPELL_SUMMON,
  );
  return e ? e.logLine.timestamp : null;
}

/** How a non-player unit's death is known. */
export interface INonPlayerUnitKill {
  timestamp: number;
  /** The killing blow, when the evidence is a damage event (absent when the
   * log only gave a bare `UNIT_DIED`). */
  finalBlow?: ICombatUnit["damageIn"][number];
}

/**
 * When — and by what — a non-player unit was killed, or null when its end is
 * UNKNOWN (expired, replaced, owner died, despawned: the log does not say, and
 * "no kill evidence" must never be read as "survived").
 *
 * Evidence, earliest wins, at most one per unit (a GUID dies once):
 *  - a damage event with `overkill > 0` — the only evidence 12.x logs carry for
 *    totems and guardians (`UNIT_DIED` on 5 of 13,439 listed summoned units;
 *    `PARTY_KILL` is a strict subset of overkill, same millisecond, 134/134 —
 *    docs/log-observability-audit.md direction 4). This is a unit being
 *    ATTACKED; a spell a Grounding Totem eats is a separate SPELL_ABSORBED and
 *    is not a kill;
 *  - a `UNIT_DIED` death record, still honoured for the units that get one.
 */
export function nonPlayerUnitKill(
  unit: ICombatUnit,
): INonPlayerUnitKill | null {
  const finalBlow = unit.damageIn.find((d) => (d.overkill ?? 0) > 0);
  const died = unit.deathRecords?.[0]?.timestamp;
  if (finalBlow && (died === undefined || finalBlow.timestamp <= died))
    return { timestamp: finalBlow.timestamp, finalBlow };
  if (died !== undefined)
    return { timestamp: died, ...(finalBlow ? { finalBlow } : {}) };
  return null;
}
