/**
 * procTriggeredCast.ts — a cast a low-HP protection proc made, not the
 * player (pipeline T134).
 *
 * `CRISIS_PROC_ANSWERS` lists the procs whose marker the log shows and the
 * spells they cast: Well-Honed Instincts (377847, "when you fall below 40%
 * health, you cast Frenzied Regeneration, up to once every 120 sec") puts its
 * marker 382912 on the druid in the millisecond the Frenzied Regeneration
 * goes up. The crisis reading has subtracted those casts from the owner's
 * presses since BACKLOG #43; the cooldown ledger read them as presses of the
 * 36 s button — 74f541c0 r5: pressed 2:19.3, the proc at 2:44.8 (its aura new
 * in a re-stating batch, read as a press made unseen), pressed again 2:54.6,
 * and the kit said `Frenzied Regeneration [28–36s]` beside two "presses"
 * 25.5 s apart. The proc spends no charge: that third press came 35.3 s after
 * the first and 9.8 s after the proc.
 *
 * One reading of the markers (`ownProcMarkers`) and one pairing
 * (`isProcTriggeredCastAt`, `CRISIS_PROC_TRIGGER_TOL_MS`) for the crisis
 * reading, the cooldown ledger, the death block's readiness, the hidden-press
 * reading and the healer timeline's `[YOU] [CD]` promotion.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  CRISIS_PROC_ANSWERS,
  CRISIS_PROC_TRIGGER_TOL_MS,
  type CrisisProcAnswer,
} from "../data/crisisProcAnswers";

export type OwnProcMarker = CrisisProcAnswer & { t: number };

type MarkerUnit = Pick<ICombatUnit, "id"> &
  Partial<Pick<ICombatUnit, "auraEvents" | "healIn">>;

const cache = new WeakMap<object, OwnProcMarker[]>();

/** Every proc marker the unit put on itself: an `aura` marker's APPLIED
 * (self → self), a `heal` marker's own heal row. Memoised per unit. */
export function ownProcMarkers(unit: MarkerUnit): OwnProcMarker[] {
  const hit = cache.get(unit);
  if (hit) return hit;
  const out: OwnProcMarker[] = [];
  for (const a of unit.auraEvents ?? []) {
    const def = CRISIS_PROC_ANSWERS.get(String(a.spellId ?? ""));
    if (
      def?.via === "aura" &&
      a.logLine?.event === LogEvent.SPELL_AURA_APPLIED &&
      a.destUnitId === unit.id &&
      a.srcUnitId === unit.id
    )
      out.push({ t: a.logLine.timestamp, ...def });
  }
  for (const h of unit.healIn ?? []) {
    const def = CRISIS_PROC_ANSWERS.get(String(h.spellId ?? ""));
    if (def?.via === "heal" && h.srcUnitId === unit.id)
      out.push({ t: h.logLine.timestamp, ...def });
  }
  cache.set(unit, out);
  return out;
}

/** Is a cast (or an aura-read activation) of `spellId` by `unit` at `ms` one
 * of its procs' — a marker that casts the spell, within
 * `CRISIS_PROC_TRIGGER_TOL_MS` of it? */
export function isProcTriggeredCastAt(
  unit: MarkerUnit,
  spellId: string | null | undefined,
  ms: number,
): boolean {
  if (!spellId) return false;
  return ownProcMarkers(unit).some(
    (m) =>
      m.triggers.has(spellId) &&
      Math.abs(ms - m.t) <= CRISIS_PROC_TRIGGER_TOL_MS,
  );
}
