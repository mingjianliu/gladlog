/**
 * Pipeline T111 (fact13 D2/D19), user ruling R47 2026-11-15 (option A): a
 * cooldown a spec passive scales by haste (DB2 aura 416) is never back at its
 * unhasted base — Pierce the Veil (30 s) re-pressed 20.8 s / 26.0 s after with
 * no reset logged. The repo reads no haste %, so no line prints an exact
 * return for these: the `[PRESS]` line and the enemy `[KICK]` line say
 * `HASTE_SCALED_COOLDOWN_NOTE` instead of `back m:ss`, and a `[RES]` `cd:`
 * entry reads `(≤Ns)` (the legend's "possibly already back"). The haste-
 * reading fix is GH #219.
 *
 * The set is read off DB2 through `hasteScaledCooldownsGenerated.json`
 * (`packages/eval/scripts/hasteScaledCooldownGen.ts`, from the talent effect
 * inventory: aura 416 rows with a rate > 0, their mask / label targets, keyed
 * by the spec of the passive that carries them) — never a hand list.
 *
 * Pipeline T267: charges a spec passive recovers by haste (DB2 aura 457 on
 * the spell's charge category) are the same fact — Discipline's Penance, 9 s
 * modelled, re-pressed on a 7.0 s median — and sit in the same set.
 */
import raw from "./hasteScaledCooldownsGenerated.json";

/** The one wording every line uses in place of an exact return. */
export const HASTE_SCALED_COOLDOWN_NOTE = "cooldown shortens with haste";

const BY_SPEC: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries((raw as { bySpec: Record<string, string[]> }).bySpec).map(
    ([spec, ids]) => [spec, new Set(ids)],
  ),
);

/** Does a unit of `spec` have `spellId`'s cooldown scaled by haste? */
export function isHasteScaledCooldown(
  spellId: string | number,
  spec: string | number | undefined,
): boolean {
  if (spec === undefined) return false;
  return BY_SPEC.get(String(spec))?.has(String(spellId)) ?? false;
}

/** The spell ids `spec` has haste-scaled (empty for every other spec). */
export function hasteScaledCooldownIds(
  spec: string | number | undefined,
): ReadonlySet<string> {
  return (spec !== undefined && BY_SPEC.get(String(spec))) || new Set();
}
