import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { extractMajorCooldowns, kitRowUnused } from "./cooldowns";

/**
 * The cooldowns a unit OWNS and has not pressed this round: the rows of its
 * cooldown ledger the kit line tags `[UNUSED]` (`extractMajorCooldowns(…, {
 * withBaselineOnly: true })` — the ledger the loadout renders — and
 * `kitRowUnused`, the tag's own reading), by the name the kit prints.
 * Memoised per (unit, round): the readers ask per attempt, per window and per
 * span of every enemy, and the answer is the round's.
 *
 * What stands behind a row is the ledger's ownership rule, not a cast: a
 * talent-tree spell only when COMBATANT_INFO's talents hold it (never when it
 * was not taken; with an undecodable talent blob, or no COMBATANT_INFO row at
 * all, only on a cast), a spell outside the spec's tree on a PvP-talent pick
 * or on the spec's DB2 baseline (`BASELINE_DEFENSIVE_BY_SPEC`, ruling C4).
 *
 * Readers: KILL ATTEMPTS' wall tier (`unpressedWallsOwned`, the 20–99 %
 * walls) and the kill-window span (`computeOffensiveWindows`: user ruling
 * 2026-10-20, fact1215 retest idx 60 「都要」 — a roster defensive in the kit
 * and never pressed is in hand the whole round).
 */
const cache = new WeakMap<
  ICombatUnit,
  { combat: AtomicArenaCombat; rows: { spellId: string; name: string }[] }
>();

export function unusedKitRows(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): ReadonlyArray<{ spellId: string; name: string }> {
  const hit = cache.get(unit);
  if (hit && hit.combat === combat) return hit.rows;
  const rows = extractMajorCooldowns(unit, combat, { withBaselineOnly: true })
    .filter((cd) => kitRowUnused(cd))
    .map((cd) => ({ spellId: cd.spellId, name: cd.spellName }));
  cache.set(unit, { combat, rows });
  return rows;
}
