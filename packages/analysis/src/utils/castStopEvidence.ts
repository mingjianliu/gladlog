/**
 * What tells a cast the unit stopped ITSELF from one something else stopped —
 * the evidence both sides of the "was it a fake" question read:
 *  - `castCancels.ts`: the log owner's own stopped hardcasts (rulings A′17,
 *    A35) and kick-eaten's `stoppedJustBefore` fact;
 *  - `kickAudit.ts`: a channel the kick's target stopped just before the kick
 *    (B-tier B21b, user ruling 2026-10-06 — "the mirror of A35, one
 *    predicate").
 * A leaf module: `castCancels.ts` imports `kickAudit.ts`, so the shared
 * pieces cannot live in either.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { spellClassMap } from "../data/drCategories";
import { ccSpellIds, officialSilenceIds } from "../data/spellTags";

/** A control aura this close to the stop means CC broke the cast. */
export const CANCEL_CC_NEAR_S = 0.3;

/** How close before the next thing (the owner's next cast start that was
 * kicked; an enemy's kick) a self-stopped cast counts as "just before"
 * (user ruling A35, 2026-09-30: 0.5 s; B21b reads the same number for a
 * stopped channel). */
export const STOPPED_JUST_BEFORE_S = 0.5;

/**
 * Enemy displacements that break a cast bar by moving the caster: the hand
 * knockback family (`drCategories.ts`: Thunderstorm 51490, Typhoon 132469,
 * Gorefiend's Grasp 108199) plus the daze aura Typhoon leaves, 61391 — the
 * only trace on the victim when the knockback row itself is not logged
 * against them (138e632d @116.9, 141470d0 @344.0).
 *
 * Only LANDED evidence counts (codex review of the triage entry, 10-01): the
 * aura applied on the unit, or damage of one of these ids taken by it. A
 * displacement that MISSED (IMMUNE, MISS) did not move the unit, so a stop
 * next to it is still the unit's own.
 */
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DISPLACEMENT_EVIDENCE_IDS: ReadonlySet<string> = new Set([
  ...spellClassMap.diminishingReturns.knockback.map((k) => k.spellId),
  "61391", // Typhoon (daze aura)
]);

/** The instants (epoch ms) at which something other than the unit could
 * have stopped its cast: a control or silence aura applied on it (`cc`; a
 * silence breaks a cast bar too — codex review 2026-09-26), and a landed
 * enemy displacement (`displaced`: aura applied, or damage of the
 * displacement taken — F-K10b). */
export function forcedStopInstantsMs(
  unit: Pick<ICombatUnit, "auraEvents" | "damageIn">,
): { cc: number[]; displaced: number[] } {
  const auras = unit.auraEvents ?? [];
  return {
    cc: auras
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          (ccSpellIds.has(a.spellId) || officialSilenceIds.has(a.spellId)),
      )
      .map((a) => a.timestamp),
    displaced: [
      ...auras.filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          !!a.spellId &&
          DISPLACEMENT_EVIDENCE_IDS.has(a.spellId),
      ),
      ...(unit.damageIn ?? []).filter(
        (d) => !!d.spellId && DISPLACEMENT_EVIDENCE_IDS.has(d.spellId),
      ),
    ].map((e) => e.timestamp),
  };
}
