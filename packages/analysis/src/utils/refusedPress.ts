/**
 * T29 / user rulings R14 + R15 (2026-11-09): a press the game refused
 * (`pressRefusalMissType`: a miss on its own target, nothing landed) is read
 * in two layers. Its EFFECT never ran — `[RES]`, burst windows, the burst
 * ledger, the kill sequence and the replay drop it. Its INTENT stands — the
 * player pressed it — and an intent fact that names it says it was refused,
 * and, where the log decides it, whether its cooldown was spent:
 *
 *   "<Spell> … (refused: <MISS TYPE>; cooldown spent)"
 *   "<Spell> … (refused: <MISS TYPE>; cooldown not spent)"
 *   "<Spell> … (refused: <MISS TYPE>)"
 *
 * The cooldown clause is printed only when `refusedPressCooldownState`
 * decides it; never "unknown" (R15 (3)).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { NOT_READY_REASONS } from "../analysis/candidates/shared";
import {
  cdAvailableAt,
  type ICooldownCast,
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "./cooldowns";
import { pressRefusalMissType } from "./enemyCDs";
import type { CastFailedEvent } from "./rawStreams";

/** The base global cooldown. A "not ready" refusal (`NOT_READY_REASONS`
 * fire for the GCD and the cooldown alike) within this of any cast row of
 * the unit — the refused press's or a later one's — may be the GCD's answer
 * (codex T29-1i #1), so it proves nothing about the cooldown. */
export const REFUSED_PRESS_RECAST_AFTER_S = 1.5;

/** Two ledger instants within this are the same press. */
const SAME_PRESS_S = 0.05;

export type RefusedPressCooldown = "spent" | "not spent";

/** The ledger's own availability (`cdAvailableAt`: charges, per-press
 * overrides and reductions, shared presses, rate windows) at `t`, counting
 * the presses of `entry` before `t` except `drop`. */
function availableWithout(
  entry: IMajorCooldownInfo,
  drop: ICooldownCast | undefined,
  t: number,
): boolean {
  const before = (cs: readonly ICooldownCast[] | undefined) =>
    cs?.filter((c) => c !== drop && c.timeSeconds < t - SAME_PRESS_S);
  return cdAvailableAt(
    {
      ...entry,
      casts: before(entry.casts) ?? [],
      ...(entry.sharedCasts ? { sharedCasts: before(entry.sharedCasts) } : {}),
    },
    t,
  );
}

/**
 * Did a refused press spend its cooldown? Read on the shared cooldown model
 * (`unitCooldownEntry`; availability through the ledger's own
 * `cdAvailableAt`, so per-press overrides and reductions, charges and shared
 * presses count as the ledger counts them), the press counted against the
 * press dropped:
 *  - "not spent": counting every press, some press of the spell is
 *    unavailable at its instant; dropping this one, every press is available
 *    — and dropping no other refused press of the spell does the same (two
 *    refused presses either of which could have kept its charge decide
 *    nothing, codex T29-1i #3). On 605: refused Ray of Frost, e.g. 129-1 r1
 *    0:47, recast 12.4 s later and again inside the 60 s.
 *  - "spent": every press is available counting them all, and the
 *    recorder's own "not ready" refusal of the spell (`NOT_READY_REASONS`,
 *    only the log owner's are logged) — at least
 *    `REFUSED_PRESS_RECAST_AFTER_S` after every cast row of the unit at or
 *    before it (a cast in its own millisecond too, codex T29-1j #1) — falls where the spell is unavailable only when this press counts,
 *    and dropping no other refused press would make it available. 62-6 r6:
 *    Touch of the Magi refused at 1:04, its recasts "尚未恢复".
 *  - undefined: neither decides it (no later press or refusal in the round,
 *    later presses possible either way, or the model fails both ways).
 */
export function refusedPressCooldownState(
  unit: ICombatUnit,
  combat: Parameters<typeof unitCooldownEntry>[1],
  spellId: string,
  pressSeconds: number,
  /** the recorder's SPELL_CAST_FAILED rows (`rawStreams.castFailed`) */
  recorderFailed: readonly CastFailedEvent[] = [],
): RefusedPressCooldown | undefined {
  const entry = unitCooldownEntry(unit, combat, spellId);
  if (!entry) return undefined;
  const own = [...entry.casts].sort((a, b) => a.timeSeconds - b.timeSeconds);
  const self = own.find(
    (c) => Math.abs(c.timeSeconds - pressSeconds) < SAME_PRESS_S,
  );
  if (!self) return undefined;
  const startMs = combat.startTime;
  // the other presses of the spell the game refused (the same predicate,
  // bounded by the next press of it as the timeline bounds it)
  const otherRefused = own.filter((c, i) => {
    if (c === self) return false;
    const next = own[i + 1];
    return (
      pressRefusalMissType(
        unit,
        c.pressedId ?? spellId,
        startMs + c.timeSeconds * 1000,
        next ? startMs + next.timeSeconds * 1000 : Infinity,
        combat,
      ) !== undefined
    );
  });
  const allFit = (drop: ICooldownCast | undefined) =>
    own.every(
      (c) => c === drop || availableWithout(entry, drop, c.timeSeconds),
    );
  if (!allFit(undefined)) {
    return allFit(self) && !otherRefused.some((q) => allFit(q))
      ? "not spent"
      : undefined;
  }
  const castRowsS = (unit.spellCastEvents ?? []).map(
    (e) => (e.logLine.timestamp - startMs) / 1000,
  );
  const spent = recorderFailed.some(
    (f) =>
      f.unitGuid === unit.id &&
      String(f.spellId) === spellId &&
      NOT_READY_REASONS.has(f.reason) &&
      f.tSeconds >= self.timeSeconds + REFUSED_PRESS_RECAST_AFTER_S &&
      !castRowsS.some(
        (s) =>
          s <= f.tSeconds && f.tSeconds - s < REFUSED_PRESS_RECAST_AFTER_S,
      ) &&
      !availableWithout(entry, undefined, f.tSeconds) &&
      availableWithout(entry, self, f.tSeconds) &&
      !otherRefused.some((q) => availableWithout(entry, q, f.tSeconds)),
  );
  return spent ? "spent" : undefined;
}

/** The marker an intent fact prints after a refused press (R15 wording). */
export function refusedPressMarker(
  missType: string,
  cooldown?: RefusedPressCooldown,
): string {
  return `(refused: ${missType}${cooldown ? `; cooldown ${cooldown}` : ""})`;
}

/** Parses a marker back (the gate's reading of the rendered text). */
export const REFUSED_PRESS_MARKER_RE =
  /\(refused: ([A-Z_]+)(?:; cooldown (spent|not spent))?\)/;
