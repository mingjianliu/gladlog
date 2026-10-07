/**
 * The killing blow of a player's death, when it was an EXECUTE — B-tier
 * B15c-U11 (user ruling 2026-10-06: "死亡块写出致死一击，只收斩杀类（轮回之触
 * 等）"). An execute changes what the death teaches: the defensive had to be
 * pressed above the health the execute works from, not when the bar looked
 * empty (95127ab4 1:51: a Mistweaver killed by Touch of Death, and the words
 * "Touch of Death" nowhere in the prompt).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

/**
 * Damage ids of abilities that END a low-health target outright. A hand
 * table (registered in curatedIdRegistry), deliberately one row:
 *  - Touch of Death 322109 — 5 of the 90 player deaths in the 60 triage
 *    rounds (the id is both the cast and the damage row).
 * Looked at and left out (the same 90 deaths, `fix-BD/u11Probe.out`):
 *  - Execute 260798 (2 deaths): a damage ability a Sudden Death proc allows
 *    at any health — being the last hit does not make the death an execute;
 *  - Sudden Demise 343769 (3 deaths, logged without overkill): its mechanic
 *    is not read from DB2 here yet — open, not assumed.
 */
export const EXECUTE_KILLING_BLOW_IDS: ReadonlySet<string> = new Set([
  "322109", // Touch of Death
]);

/** The blow that killed a player: the last damage event with overkill > 0 at
 * or before the death (+500 ms log slack), else undefined. The ONE predicate
 * for "the killing blow" — KILL SEQUENCE's `killing blow:` and the friendly
 * death block's execute line both read it (moved here from
 * context/timelineHelpers.ts, which re-exports it; agy review of the B15c-U11
 * batch: the first cut carried a second predicate with other bounds). */
export function playerKillingBlow(
  unit: Pick<ICombatUnit, "damageIn">,
  deathMs: number,
): ICombatUnit["damageIn"][number] | undefined {
  let best: ICombatUnit["damageIn"][number] | undefined;
  for (const d of unit.damageIn) {
    if ((d.overkill ?? 0) <= 0) continue;
    if (d.logLine.timestamp > deathMs + 500) continue;
    if (!best || d.logLine.timestamp >= best.logLine.timestamp) best = d;
  }
  return best;
}

/** `playerKillingBlow`, only when it is an execute (`EXECUTE_KILLING_BLOW_IDS`). */
export function executeKillingBlowOf(
  unit: Pick<ICombatUnit, "damageIn">,
  deathMs: number,
): ICombatUnit["damageIn"][number] | undefined {
  const blow = playerKillingBlow(unit, deathMs);
  return blow && EXECUTE_KILLING_BLOW_IDS.has(blow.spellId ?? "")
    ? blow
    : undefined;
}
