import { ICombatUnit } from "@gladlog/parser-compat";

import { SCHOOL_PHYSICAL, spellSchoolMask } from "../data/spellSchools";
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

/**
 * Shields that DELAY damage instead of preventing it, keyed to the id their
 * delayed damage later lands as (self → self periodic damage). The log writes
 * the delayed half of every hit as a `SPELL_ABSORBED` by the shield, and then
 * writes it again as the tick that takes the health — one piece of damage,
 * two records. Measured on the 60 raw logs of the 2026-10-08 re-eval
 * (FT-T02b): Time Dilation "absorbed" 21,686,939 and its ticks came back as
 * 19,480,882 landed + 1,764,448 absorbed by a real shield (98.0 %; the rest
 * was still pending at a death or the round's end); Stretch Time 8,325,694 vs
 * 7,292,177 + 941,210 (98.9 %). Counting both read 0e0663e6's 0:48–0:58 as a
 * 1.90M spike of which 287k was the shield's "absorb" and 291k the same
 * damage landing.
 *
 * User ruling 2026-10-09 (FT-T02b, option B): the damage counts when the
 * health is lost — a deferral shield's SPELL_ABSORBED is not absorbed damage
 * (`isDeferralAbsorb`), the tick is the damage. One exception, by the nature
 * of the fact: a per-SCHOOL reading asks what was thrown at the unit, and a
 * tick has no school of its own (the log writes both ids as 0x1, physical,
 * whatever was delayed) — `incomingPressureBySchool` keeps the hit under its
 * own school at the time it was thrown and leaves the tick out.
 *
 * NOT the mitigation table's concern: Time Dilation stays priced at 50 % there
 * (user decision 2026-07-30, on a death / burst-window basis). Registered in
 * curatedIdRegistry.
 */
export const DEFERRAL_SHIELD_DAMAGE_IDS: Readonly<Record<string, string>> = {
  "357170": "361029", // Time Dilation → its deferred damage
  "410355": "413924", // Stretch Time → its deferred damage
};

const DEFERRED_TICK_IDS: ReadonlySet<string> = new Set(
  Object.values(DEFERRAL_SHIELD_DAMAGE_IDS),
);

/** An absorb event (its `spellId` is the shield) that only delayed the hit —
 * the damage is the tick that lands later, not this. */
export function isDeferralAbsorb(a: { spellId?: string | null }): boolean {
  return !!a.spellId && a.spellId in DEFERRAL_SHIELD_DAMAGE_IDS;
}

/** A deferral shield's delayed damage landing (or being eaten by a real
 * shield): the attacking spell is one of the deferred ids. */
export function isDeferredTickId(spellId: string | null | undefined): boolean {
  return !!spellId && DEFERRED_TICK_IDS.has(spellId);
}

/** A `REDISTRIBUTION_DAMAGE_IDS` row from the unit's own side — moved
 * health, not an enemy hitting it. The one test every reader of incoming
 * damage applies (`incomingPressureEvents`, `incomingPressureBySchool`). */
function isRedistributionRow(
  unit: Pick<ICombatUnit, "id" | "reaction">,
  spellId: string | undefined,
  srcUnitId: string | undefined,
  srcUnitFlags: number | undefined,
  destUnitFlags: number | undefined,
  sides: RosterSides | undefined,
): boolean {
  return (
    !!spellId &&
    REDISTRIBUTION_DAMAGE_IDS.has(spellId) &&
    isSameSideSource(unit, srcUnitId, srcUnitFlags, sides, destUnitFlags)
  );
}

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
 * Damage taken plus damage absorbed, in one time-ordered list. A hit a
 * deferral shield delayed (`DEFERRAL_SHIELD_DAMAGE_IDS`) is in the list once,
 * as the tick that takes the health.
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
    isRedistributionRow(
      unit,
      spellId,
      srcUnitId,
      srcUnitFlags,
      destUnitFlags,
      sides,
    );
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
    // delayed, not absorbed: it is counted as the tick that takes the health
    if (isDeferralAbsorb(a)) continue;
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

/**
 * The landed share of [fromMs, toMs] — health the unit actually lost to hits
 * (`damageIn`), without what a shield ate. Same list, so the same
 * redistribution rule: a teammate's Void Leech or Spirit Link moving health
 * onto the unit is not a hit it took. The reading of missed-cleanse's
 * `postCcDamage` (triage missed-cleanse F-C1: 6062daf2's "18k taken" under
 * Landslide was two Void Leech rows from the owner himself), which stays
 * landed-only on purpose — BACKLOG #39's consequence baseline was measured
 * on landed damage.
 */
export function sumLandedPressure(
  unit: PressureUnit,
  fromMs: number,
  toMs: number,
  sides?: RosterSides,
): number {
  let sum = 0;
  for (const e of incomingPressureEvents(unit, sides)) {
    if (e.isAbsorb || e.timestamp < fromMs || e.timestamp > toMs) continue;
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

/** The log's own school bits of one hit record (`spellSchoolId` is the hex
 * string of the line; a swing is 0x1). 0 = the line carried none. The one
 * reading of every per-school sum (`incomingPressureBySchool`). */
export function logSchoolMask(spellSchoolId: string | undefined): number {
  return Number.parseInt(String(spellSchoolId ?? "0x0"), 16) || 0;
}

/**
 * Incoming pressure in [fromMs, toMs] per school mask, with the same
 * redistribution rule as `incomingPressureEvents` — the shape
 * `schoolShareCoveredBy` reads (key = the decimal school mask). Damage that
 * landed AND damage a shield ate: a shield judged by "was the team dealing
 * its school" would otherwise delete its own evidence — the better an
 * Anti-Magic Shell works, the less magic damage lands (Fable review of
 * triage enemy-def F-E22 / F-E24, 2026-10-02).
 *
 * Two readers, one answer to "which schools was this unit being hit with":
 * KILL ATTEMPTS (`attributeFailure`: does the enemy's school-limited save
 * cover our go) and cd-hoarded (`DecisionPoint.dmg2sBySchool`: does the
 * owner's school-limited save cover the crisis). cd-hoarded read landed
 * damage only until 2026-10-06 — a Power Word: Shield on the crisis unit hid
 * the school it was eating (user ruling U-KA2).
 *
 * The school of an absorbed hit: the SPELL_ABSORBED line's own attack-school
 * field (spell form, `parameters[10]`), else the attack spell's official
 * SpellMisc.SchoolMask; a swing absorb is physical. An absorb whose school
 * cannot be told (a stored document from before the attack spell was
 * recorded, or a slimmed line of a spell DB2 does not list) is left out —
 * unknown is not a school.
 */
export function incomingPressureBySchool(
  unit: PressureUnit,
  fromMs: number,
  toMs: number,
  sides?: RosterSides,
  /** Does this document record the absorbed attack's spell at all
   * (`documentRecordsAttackSpell` over the round's units)? Decided from
   * this unit alone when omitted — wrong for a unit whose only absorbs are
   * swings (codex review, 2026-10-03). */
  recordsAttackSpell?: boolean,
  /** The window is (fromMs, toMs] instead of [fromMs, toMs] — the shape of
   * a look-back that ends at an instant (cd-hoarded's `DMG_WINDOW_MS` before
   * the HP reading), so a row exactly `DMG_WINDOW_MS` back is in neither
   * this split nor the `dmg2s` it stands beside. */
  fromExclusive = false,
): Record<string, number> {
  const before = (t: number): boolean =>
    fromExclusive ? t <= fromMs : t < fromMs;
  const by: Record<string, number> = {};
  const add = (mask: number, amount: number): void => {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    by[String(mask)] = (by[String(mask)] ?? 0) + amount;
  };
  for (const d of unit.damageIn ?? []) {
    const t = d.logLine.timestamp;
    if (before(t) || t > toMs) continue;
    if (
      isRedistributionRow(
        unit,
        d.spellId,
        d.srcUnitId,
        d.srcUnitFlags,
        d.destUnitFlags,
        sides,
      )
    )
      continue;
    // a deferred tick has no school of its own; the hit is below, under the
    // school it was thrown in (`DEFERRAL_SHIELD_DAMAGE_IDS`)
    if (isDeferredTickId(d.spellId)) continue;
    add(logSchoolMask(d.spellSchoolId), Math.abs(d.effectiveAmount));
  }
  const absorbs = unit.absorbsIn ?? [];
  // A missing attackSpellId means a swing only on documents that record the
  // field at all (parsed on or after 2026-09-20) — the era rule of
  // `timelineHelpers`' absorbed-hit labels.
  const swingWhenNoSpell =
    recordsAttackSpell ?? absorbs.some((a) => a.attackSpellId !== undefined);
  for (const a of absorbs) {
    const t = a.logLine.timestamp;
    if (before(t) || t > toMs) continue;
    if (
      isRedistributionRow(
        unit,
        a.attackSpellId,
        a.attackerId,
        a.srcUnitFlags,
        a.destUnitFlags,
        sides,
      )
    )
      continue;
    if (isDeferredTickId(a.attackSpellId)) continue;
    let mask: number | undefined;
    if (a.attackSpellId === undefined) {
      mask = swingWhenNoSpell ? SCHOOL_PHYSICAL : undefined;
    } else {
      const logged = a.logLine.parameters?.[10];
      mask =
        (typeof logged === "string" && /^0x/i.test(logged)
          ? logSchoolMask(logged)
          : 0) ||
        spellSchoolMask(a.attackSpellId) ||
        undefined;
    }
    if (mask === undefined) continue;
    add(mask, Math.abs(Number(a.absorbedAmount) || 0));
  }
  return by;
}

/** Does this document record the absorbed attack's spell (parsed on or after
 * 2026-09-20)? Then an absorb without one is a swing. Read off every unit of
 * the round: a single unit's absorbs may all be swings. */
export function documentRecordsAttackSpell(
  units: Iterable<Pick<ICombatUnit, "absorbsIn">>,
): boolean {
  for (const u of units)
    if ((u.absorbsIn ?? []).some((a) => a.attackSpellId !== undefined))
      return true;
  return false;
}
