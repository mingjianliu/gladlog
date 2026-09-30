/**
 * Alter Time's return (triage 2026-09-29 H17). The press is 342245 (the
 * ledger's id, admitted by W1g 2026-09-26), the aura it puts up is 342246,
 * and snapping back is a SECOND cast, 342247 — which no ledger admits, so it
 * was never rendered: a return 0.17 s after the press (f4da82c5, a wasted
 * Alter Time) and a teammate's snap-back from 31 % (138e632d 0:28) both read
 * as nothing, or as an ordinary press. One helper for the [YOU] [CD] and
 * [TEAM] [CD] renderers.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { buffFullDurationForCaster } from "../../utils/buffDuration";

export const ALTER_TIME_CAST_ID = "342245";
export const ALTER_TIME_AURA_ID = "342246";
export const ALTER_TIME_RETURN_ID = "342247";

/**
 * The unit's return cast for an Alter Time pressed at `castSeconds` (seconds
 * since round start): its first 342247 SPELL_CAST_SUCCESS after the press and
 * no later than the aura's official duration (DB2, 10 s) after it — later than
 * that the aura has expired on its own and returned by itself. Null when the
 * log shows no return (the aura ran out, or the unit died first).
 */
export function alterTimeReturnSeconds(
  unit: Pick<ICombatUnit, "spellCastEvents" | "spec" | "info">,
  castSeconds: number,
  matchStartMs: number,
): number | null {
  const durationS =
    buffFullDurationForCaster(ALTER_TIME_AURA_ID, unit as never) ?? 10;
  for (const e of unit.spellCastEvents ?? []) {
    if (e.spellId !== ALTER_TIME_RETURN_ID) continue;
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const s = (e.logLine.timestamp - matchStartMs) / 1000;
    if (s > castSeconds && s <= castSeconds + durationS) return s;
  }
  return null;
}
