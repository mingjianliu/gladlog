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
 * One reading of the markers (`ownProcMarkers`, the crisis reading's too) and
 * one pairing (`isProcTriggeredCastAt`) for every reader of a press: the
 * cooldown ledger, the death block's readiness, the hidden-press reading, the
 * healer timeline's `[YOU] [CD]` promotion and the enemy self-save list.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  CRISIS_PROC_ANSWERS,
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

/**
 * How far from its marker the proc's own activation sits. The proc logs no
 * cast row of its own: its aura goes up in the marker's millisecond
 * (74f541c0 r5 2:44.822 both, 18e3feae r3 1:19.712 both). A cast row a second
 * later is the player pressing the button on top of it — 18e3feae r4: the
 * proc at 41.76 s, SPELL_CAST_SUCCESS + AURA_REFRESH at 42.80 s; r6: 71.28 s
 * and 73.58 s — and spends its charge. So the press readers pair inside one
 * log batch, not inside the crisis reading's `CRISIS_PROC_TRIGGER_TOL_MS`
 * (1.5 s, which answers "did the proc answer this crisis", a looser
 * question).
 */
export const PROC_OWN_ACTIVATION_PAIR_MS = 100;

/** Is a cast (or an aura-read activation) of `spellId` by `unit` at `ms` its
 * proc's own — a marker that casts the spell, within
 * `PROC_OWN_ACTIVATION_PAIR_MS` of it? */
export function isProcTriggeredCastAt(
  unit: MarkerUnit,
  spellId: string | null | undefined,
  ms: number,
): boolean {
  if (!spellId) return false;
  return ownProcMarkers(unit).some(
    (m) =>
      m.triggers.has(spellId) &&
      Math.abs(ms - m.t) <= PROC_OWN_ACTIVATION_PAIR_MS,
  );
}
