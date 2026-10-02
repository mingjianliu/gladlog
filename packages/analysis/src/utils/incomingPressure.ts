import { ICombatUnit } from "@gladlog/parser-compat";

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
 */
export function incomingPressureEvents(
  unit: Pick<ICombatUnit, "damageIn" | "absorbsIn">,
): IPressureEvent[] {
  const events: IPressureEvent[] = [];
  for (const d of unit.damageIn ?? []) {
    const amount = Math.abs(d.effectiveAmount);
    if (!Number.isFinite(amount)) continue;
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
  unit: Pick<ICombatUnit, "damageIn" | "absorbsIn">,
  fromMs: number,
  toMs: number,
): number {
  let sum = 0;
  for (const e of incomingPressureEvents(unit)) {
    if (e.timestamp < fromMs || e.timestamp > toMs) continue;
    sum += e.amount;
  }
  return sum;
}

/** The absorbed share of [fromMs, toMs] — what `damageIn` alone cannot see. */
export function sumAbsorbedPressure(
  unit: Pick<ICombatUnit, "damageIn" | "absorbsIn">,
  fromMs: number,
  toMs: number,
): number {
  let sum = 0;
  for (const e of incomingPressureEvents(unit)) {
    if (!e.isAbsorb || e.timestamp < fromMs || e.timestamp > toMs) continue;
    sum += e.amount;
  }
  return sum;
}
