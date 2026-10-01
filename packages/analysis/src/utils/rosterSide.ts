import {
  CombatUnitReaction,
  getUnitReaction,
  ICombatUnit,
} from "@gladlog/parser-compat";

import { isControlledPlayerFlags } from "./charmedPlayer";

/**
 * rosterSide.ts — the single predicate for "is this event's source on the
 * victim's own team".
 *
 * The per-event reaction flags cannot answer it: while a player is charmed
 * (Mind Control) the log writes that player with the OTHER side's flags, and
 * while the log's own recorder is charmed it flips everyone's. A flag test
 * then read the enemy's damage as "same team" and dropped it from the Top
 * sources line (triage 2026-09-29, death-kill F-T1: ba8c0510, 113k of a 199k
 * Ray of Frost missing), or kept a teammate's redistribution as enemy
 * pressure. The side is a roster fact, so it is read from the source's GUID:
 * a unit's `reaction` is the vote over the whole round (parser `roster.ts`),
 * and a summon takes its owner's.
 *
 * One thing the roster cannot see: a CHARM. A charmed player keeps its GUID
 * and is flagged as a controlled player on its own rows
 * (`isControlledPlayerFlags`: PET type — the recorder too, 0x1118), and
 * while it lasts nothing that damages across it is "same team":
 *  - a charmed SOURCE acts for the other team (a Mind-Controlled teammate's
 *    Consecration ticking on the victim);
 *  - a charmed VICTIM is attacked by its own team (90c57b63 r3 75.9 s:
 *    Scourge Strike from the charmed recorder's own Death Knight) while the
 *    other team's DoTs on it keep ticking.
 * Those rows stay in the pressure total (user ruling A22: "mind-controlled
 * teammates stay in"), so they stay in Top sources too. 605-file slice
 * (`fix-T1015/mcprobe.ts`): 429 rows / 577k from a charmed source in 107
 * rounds; 166 rows / 1.13M from teammates on a charmed recorder.
 *
 * Consumers: `getTopDamageSourcesInWindow` (Top sources, final-5 s, the
 * `[KILL]` line) and `incomingPressureEvents` (the redistribution rule). The
 * flags are the fallback for a GUID the roster does not know and for a unit
 * whose roster vote came out Neutral (it decides nothing).
 */
export type RosterSides = ReadonlyMap<string, CombatUnitReaction>;

/** unit GUID → roster side, for every unit; a summon → its owner's side. */
export function buildRosterSides(
  units: Iterable<Pick<ICombatUnit, "id" | "ownerId" | "reaction">>,
): RosterSides {
  const all = [...units];
  const byId = new Map(all.map((u) => [u.id, u]));
  const out = new Map<string, CombatUnitReaction>();
  for (const u of all) {
    const owner =
      u.ownerId && u.ownerId !== "0000000000000000"
        ? byId.get(u.ownerId)
        : undefined;
    out.set(u.id, owner && owner.id !== u.id ? owner.reaction : u.reaction);
  }
  return out;
}

const decided = (
  side: CombatUnitReaction | undefined,
): side is CombatUnitReaction.Friendly | CombatUnitReaction.Hostile =>
  side === CombatUnitReaction.Friendly || side === CombatUnitReaction.Hostile;

/** True when the source of an event on `victim` acts for the victim's own
 * side. The roster decides, unless this row flags the source
 * (`srcUnitFlags`) or the victim (`destUnitFlags`) as a charmed player —
 * then the row is an attack across the charm, never same-side. The source's
 * flags are also the fallback for a source the roster lacks or left
 * undecided (Neutral). */
export function isSameSideSource(
  victim: Pick<ICombatUnit, "id" | "reaction">,
  srcUnitId: string | undefined,
  srcUnitFlags: number | undefined,
  sides?: RosterSides,
  destUnitFlags?: number,
): boolean {
  if (
    isControlledPlayerFlags(srcUnitId, srcUnitFlags) ||
    isControlledPlayerFlags(victim.id, destUnitFlags)
  )
    return false;
  const victimSide = sides?.get(victim.id) ?? victim.reaction;
  const srcSide = srcUnitId ? sides?.get(srcUnitId) : undefined;
  if (decided(srcSide)) return srcSide === victimSide;
  return (
    srcUnitFlags !== undefined && getUnitReaction(srcUnitFlags) === victimSide
  );
}
