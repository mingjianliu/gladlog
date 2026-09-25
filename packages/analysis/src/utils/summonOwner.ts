import type { ICombatUnit } from "@gladlog/parser-compat";

/**
 * The player who owns the summon (totem / pet / guardian) with GUID
 * `sourceId`, looked up by the event's own source GUID — the exact key (GH
 * #99: name lookups collide when both teams field a same-named summon).
 * Returns undefined when the id is not a summon or its owner is not in
 * `roster`.
 *
 * One predicate, two consumers: `resolveSummonOwner` (every `(by X's pet)`
 * credit the prompt renders) and `analyzeOutgoingCCChains` (the outgoing DR /
 * CC chains, reliability audit C6 2026-09-25 — it used to drop every
 * summon-sourced CC, so a Capacitor Totem or Intimidation stun on the enemy
 * healer was in `[CC ON ENEMY]` but not in the chains, the kill-attempt
 * openers or the sync windows, and the next player stun in the category was
 * labelled Full DR).
 */
export function summonOwnerById(
  allUnits: Iterable<ICombatUnit> | undefined,
  sourceId: string | undefined,
  roster: readonly ICombatUnit[],
): ICombatUnit | undefined {
  if (!sourceId || !allUnits) return undefined;
  for (const u of allUnits) {
    if (u.id !== sourceId || !u.ownerId) continue;
    return roster.find((p) => p.id === u.ownerId);
  }
  return undefined;
}
