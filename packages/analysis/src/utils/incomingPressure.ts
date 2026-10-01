import { ICombatUnit } from "@gladlog/parser-compat";

import { isSameSideSource, type RosterSides } from "./rosterSide";

/**
 * incomingPressure.ts — the single predicate for "how hard was this unit being
 * hit".
 *
 * A hit a shield ate whole is not a damage record: the log reports it as a
 * standalone `SPELL_ABSORBED` (plus a `SPELL_MISSED`/ABSORB restatement of the
 * same numbers), so `damageIn` never sees it. Measured on 600 new-season
 * archive rounds, that is **22.2%** of all incoming effective HP across
 * friendly players, and it is wildly spec-dependent — Discipline Priest 35.2%
 * and Arcane Mage 35.4% at one end, Preservation Evoker 0.9% and Restoration
 * Druid 3.0% at the other — so any cross-spec comparison of pressure built on
 * `damageIn` alone carries a bias of up to 35 percentage points.
 *
 * Consumers must not re-implement the merge: `computePressureWindows` (the
 * damage-spike windows and, through `criticalWindows`, the dense-sampling
 * ranges), the timeline's `[DMG SPIKE]` absorb annotation, the incoming-DPS
 * velocity string and the focus-target pick all read this module.
 *
 * Sign convention: `amount` is a POSITIVE magnitude, unlike `damageIn`'s
 * negative `effectiveAmount`.
 *
 * The damage side settles on `effectiveAmount` (overkill already removed),
 * which is what `computePressureWindows` and `resourceSnapshot` already used.
 * Two call sites were on other criteria and moved here deliberately, not by
 * accident: `matchTimeline`'s incoming-DPS string read
 * `effectiveAmount || amount`, so a hit that was ENTIRELY overkill fell back to
 * the pre-overkill number, and `matchArchetype` read raw `amount` throughout.
 * Both counted overkill as pressure; neither now does.
 */
/**
 * Damage ids that MOVE a teammate's health onto the unit instead of being an
 * enemy hitting it — user ruling 2026-09-30 (triage hp-state R2 / A22 = B:
 * "只排除灵魂链接 98021、虚空汲取 451963"). 5e8b11c1's healer "took a 1.10M
 * spike" of which 685k was his own Spirit Link Totem, while the `Top sources`
 * of that very line (same-team sources excluded) listed 106k / 73k / 58k.
 * A row counts as redistribution only when its source is on the unit's own
 * side BY ROSTER (`isSameSideSource`): on the 605-file capture slice all 712
 * Spirit Link rows and 2,632 of 2,649 Void Leech rows are; the other 17 are a
 * Shadow Priest draining a teammate he has Mind-Controlled — an enemy's
 * damage, flagged "friendly" by the charm, and it stays pressure.
 * Deliberately NOT here (same ruling): Blessing of Sacrifice's transfer 6940
 * and damage dealt by a charmed teammate — damage the enemy caused, taken by
 * someone else. Nor the Void-Tainted Shell rune 1287955 (the unit's own rune,
 * 16,627 of 16,627 applications self-sourced). Registered in
 * curatedIdRegistry.
 */
export const REDISTRIBUTION_DAMAGE_IDS: ReadonlySet<string> = new Set([
  "98021", // Spirit Link (Spirit Link Totem's health redistribution)
  "451963", // Void Leech (Shadow Priest draining an ally)
]);

export interface IPressureEvent {
  timestamp: number;
  /** Positive magnitude of effective HP lost, or that would have been lost. */
  amount: number;
  /** True when a shield ate the hit outright — no health was actually lost. */
  isAbsorb: boolean;
  spellId: string;
  spellName: string;
  /** The attacker. For an absorb this is the attacker, not the shield owner. */
  srcUnitId: string;
}

/** What the predicate reads off a unit; `id` / `reaction` decide the side of
 * a redistribution row's source. */
export type PressureUnit = Pick<
  ICombatUnit,
  "id" | "reaction" | "damageIn" | "absorbsIn"
>;

/**
 * Damage taken plus damage absorbed, in one time-ordered list.
 *
 * A partly absorbed hit emits a damage record AND its own `SPELL_ABSORBED`.
 * They do not overlap: the damage record's `amount` is already net of the
 * absorb (so its effectiveAmount is the health lost), and the absorb event is
 * the part the shield ate — together, the whole hit. Until 2026-10-01
 * `convert.ts` subtracted the absorbed part from the damage record a second
 * time, so this sum under-read every partly absorbed hit by the absorbed
 * amount (user ruling A38, triage missed-cleanse F-C2).
 *
 * `sides` (`buildRosterSides` over the round's units) decides whether a
 * `REDISTRIBUTION_DAMAGE_IDS` row came from the unit's own team; without it
 * the row's own reaction flags do, which is wrong only while someone is
 * charmed.
 */
export function incomingPressureEvents(
  unit: PressureUnit,
  sides?: RosterSides,
): IPressureEvent[] {
  const events: IPressureEvent[] = [];
  const redistributed = (
    spellId: string | undefined,
    srcUnitId: string | undefined,
    srcUnitFlags: number | undefined,
    destUnitFlags: number | undefined,
  ) =>
    !!spellId &&
    REDISTRIBUTION_DAMAGE_IDS.has(spellId) &&
    isSameSideSource(unit, srcUnitId, srcUnitFlags, sides, destUnitFlags);
  for (const d of unit.damageIn ?? []) {
    const amount = Math.abs(d.effectiveAmount);
    if (!Number.isFinite(amount)) continue;
    if (redistributed(d.spellId, d.srcUnitId, d.srcUnitFlags, d.destUnitFlags))
      continue;
    events.push({
      timestamp: d.logLine.timestamp,
      amount,
      isAbsorb: false,
      spellId: d.spellId ?? "",
      spellName: d.spellName ?? "",
      srcUnitId: d.srcUnitId ?? "",
    });
  }
  for (const a of unit.absorbsIn ?? []) {
    const amount = Math.abs(Number(a.absorbedAmount) || 0);
    if (amount <= 0 || !Number.isFinite(amount)) continue;
    // the absorbed hit's own spell and attacker (`spellId` is the shield)
    if (
      redistributed(
        a.attackSpellId,
        a.attackerId,
        a.srcUnitFlags,
        a.destUnitFlags,
      )
    )
      continue;
    events.push({
      timestamp: a.logLine.timestamp,
      amount,
      isAbsorb: true,
      spellId: a.spellId ?? "",
      spellName: a.spellName ?? "",
      srcUnitId: a.attackerId ?? "",
    });
  }
  return events.sort((x, y) => x.timestamp - y.timestamp);
}

/** Total incoming pressure within [fromMs, toMs] (inclusive). */
export function sumIncomingPressure(
  unit: PressureUnit,
  fromMs: number,
  toMs: number,
  sides?: RosterSides,
): number {
  let sum = 0;
  for (const e of incomingPressureEvents(unit, sides)) {
    if (e.timestamp < fromMs || e.timestamp > toMs) continue;
    sum += e.amount;
  }
  return sum;
}

/** The absorbed share of [fromMs, toMs] — what `damageIn` alone cannot see. */
export function sumAbsorbedPressure(
  unit: PressureUnit,
  fromMs: number,
  toMs: number,
  sides?: RosterSides,
): number {
  let sum = 0;
  for (const e of incomingPressureEvents(unit, sides)) {
    if (!e.isAbsorb || e.timestamp < fromMs || e.timestamp > toMs) continue;
    sum += e.amount;
  }
  return sum;
}
