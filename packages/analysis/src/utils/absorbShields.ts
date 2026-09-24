import type { ICombatUnit } from "@gladlog/parser-compat";

/**
 * Absorb shields as effective HP (2026-08-12, user-specified semantics).
 *
 * The percentage mitigation table (mitigationData) deliberately excludes absorb
 * shields — they are not a percentage, so there is nothing for it to hold, and
 * every absorb sits in `NO_MITIGATION_IDS` with that reason. The consequence
 * was that a Power Word: Shield or an Ice Barrier was simply invisible to the
 * death audit: the coach could say "you took X and pressed no mitigation" while
 * the player had in fact shielded.
 *
 * What the log gives us decides the model:
 *  - `SPELL_ABSORBED` events carry the SHIELD's own spellId and the amount that
 *    shield actually ate (measured on 237k events across the local library), so
 *    a shield's contribution is a measured number, never an estimate;
 *  - the shield's NOMINAL size at application is not available — that field
 *    lives in the log line's trailing parameters, which archive slimming drops.
 *
 * Hence "count the shield as effective HP, but account for when the buff
 * expires" is satisfied structurally rather than by arithmetic: only damage the
 * shield actually absorbed is counted, so a shield that expired unconsumed
 * contributes exactly what it was worth — nothing — and a shield that expired
 * mid-window contributes only what it ate before expiring. The unconsumed
 * remainder cannot be reported from a slimmed archive, and is deliberately not
 * guessed.
 */

/** One shield's measured contribution inside a queried window. */
interface IAbsorbContribution {
  spellId: string;
  spellName: string;
  /** Damage this shield actually absorbed inside the window. */
  absorbedAmount: number;
  /** Number of absorb events that made it up (evidence density). */
  events: number;
}

/**
 * Absorbed-by-shield totals for `unit` within [fromMs, toMs].
 *
 * Attribution is by the absorb event's own spellId — the shield, not the
 * incoming damage spell — which is what the parser stores (verified against the
 * real archives; the separate `shieldSpellId` field exists in the type but is
 * never populated, so nothing may depend on it).
 */
export function absorbContributionsInWindow(
  unit: Pick<ICombatUnit, "absorbsIn">,
  fromMs: number,
  toMs: number,
): IAbsorbContribution[] {
  const byShield = new Map<string, IAbsorbContribution>();
  for (const ev of unit.absorbsIn ?? []) {
    const ts = ev.logLine?.timestamp;
    if (typeof ts !== "number" || ts < fromMs || ts > toMs) continue;
    const spellId = ev.spellId ?? "";
    if (!spellId) continue;
    const amount = Math.abs(Number(ev.absorbedAmount) || 0);
    if (amount <= 0) continue;
    const row = byShield.get(spellId);
    if (row) {
      row.absorbedAmount += amount;
      row.events += 1;
    } else {
      byShield.set(spellId, {
        spellId,
        spellName: ev.spellName ?? spellId,
        absorbedAmount: amount,
        events: 1,
      });
    }
  }
  return [...byShield.values()].sort(
    (a, b) => b.absorbedAmount - a.absorbedAmount,
  );
}

/** Total effective HP the unit gained from all absorbs in the window. */
export function totalAbsorbedInWindow(
  unit: Pick<ICombatUnit, "absorbsIn">,
  fromMs: number,
  toMs: number,
): number {
  return absorbContributionsInWindow(unit, fromMs, toMs).reduce(
    (sum, c) => sum + c.absorbedAmount,
    0,
  );
}
