/**
 * hiddenPress.ts — a cooldown pressed while its holder was unseen by the
 * recorder (fact3 D35, 2026-10-21).
 *
 * While a unit is out of the recorder's sight (Mass Invisibility, stealth,
 * out of range) the log writes none of its rows. When it is seen again the
 * log re-states the unit's whole aura state in one millisecond — a batch of
 * SPELL_AURA_APPLIED rows on it (its poisons, Dampening, every buff up). An
 * aura in that batch that was NOT up before is a new application: its press
 * happened while the unit was unseen, and the press row is lost.
 *
 * 5f4142ec round 1: the enemy rogue went into an ally's Mass Invisibility at
 * 1:07.6; at 1:10.515–.516 thirty APPLIED rows re-stated it, Evasion among
 * them (up to 1:20.0, not up before in the round, no SPELL_CAST_SUCCESS of
 * 5277) — the kill target's kit read `Evasion [UNUSED]` and it had no
 * `[ENEMY DEF]` line.
 *
 * 605-file capture (every 30th of the new-season manifest), self-applied
 * save auras with no cast row within 1 s, in a batch of ≥ 6 APPLIED rows on
 * the unit: 39 Evasion / 132 Feint / 38 Crimson Vial / 25 Cloak of Shadows …
 * re-stated while already up (the state re-sync `AURA_ONLY_ACTIVATION_IDS`'
 * note documents — not presses), against 4 Evasion / 7 Feint / 16 Crimson
 * Vial / 4 Cloak of Shadows / 1 Ice Block … that were not up before.
 *
 * The press's own instant is not in the log: it lies between the unit going
 * unseen and the batch. The batch's instant is the reading (an upper bound).
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  castsOwningEffectAura,
  effectAuraViaName,
  ownEffectAurasOfCast,
} from "../data/castEffectAuras";

/** A re-stating batch: at least this many SPELL_AURA_APPLIED rows on the
 * unit in one millisecond (5f4142ec: 30; a press that applies several
 * auras at once — Deep Breath's five — stays under it). */
export const RESYNC_BATCH_MIN_APPLIED = 6;

/** One batch's rows can straddle a millisecond boundary (0284fcd9 r1 0:12:
 * ten rows at .108, five at .109, Tranquility among the second five). */
export const RESYNC_BATCH_SPAN_MS = 5;

/** A press row this close to the aura is the aura's own press, not a lost
 * one. */
const PRESS_ROW_PAIR_MS = 1000;

/**
 * The instants (ms) of `spellId`'s hidden presses by `unit` in
 * [fromMs, toMs]: an APPLIED of its own aura (same id) from the unit on
 * itself inside a re-stating batch (`RESYNC_BATCH_MIN_APPLIED` rows within
 * `RESYNC_BATCH_SPAN_MS`), the aura
 * not up before it in the window, and no SPELL_CAST_SUCCESS of the spell
 * by the unit within `PRESS_ROW_PAIR_MS`.
 */
export function hiddenPressMs(
  unit: Pick<ICombatUnit, "id" | "auraEvents" | "spellCastEvents">,
  spellId: string,
  fromMs: number,
  toMs: number = Infinity,
): number[] {
  const rows = (unit.auraEvents ?? []).filter(
    (a) => a.logLine.timestamp >= fromMs && a.logLine.timestamp <= toMs,
  );
  // the press's own aura: its id, or its own same-named effect aura (Alter
  // Time is pressed as 342245 and runs as 342246 — corpusFactScan
  // hiddenPressUnused, 149-6 0:20)
  const auraIds = new Set([
    spellId,
    ...ownEffectAurasOfCast(spellId).filter((a) =>
      effectAuraViaName(spellId, a),
    ),
  ]);
  const own = rows.filter(
    (a) =>
      !!a.spellId &&
      auraIds.has(a.spellId) &&
      a.destUnitId === unit.id &&
      a.srcUnitId === unit.id,
  );
  if (own.length === 0) return [];
  const appliedMs = rows
    .filter(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        a.destUnitId === unit.id,
    )
    .map((a) => a.logLine.timestamp);
  const batchSize = (ms: number) =>
    appliedMs.filter((t) => Math.abs(t - ms) <= RESYNC_BATCH_SPAN_MS).length;
  const pressMs = (unit.spellCastEvents ?? [])
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId === spellId,
    )
    .map((e) => e.logLine.timestamp);
  // a press of ANOTHER spell just before is a visible unit triggering a
  // copy, not a re-listing after being unseen (71-5 0:35: Exhilaration put
  // up Smoke Screen's 3 s Survival of the Fittest among its own auras — the
  // `[no press logged]` copy read as a hidden press); corpusFactScan's
  // proc-trigger reading, 0–100 ms before
  const otherPressMs = (unit.spellCastEvents ?? [])
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        !auraIds.has(e.spellId) &&
        e.spellId !== spellId,
    )
    .map((e) => e.logLine.timestamp);
  const out: number[] = [];
  let up = false;
  for (const a of own) {
    const ms = a.logLine.timestamp;
    if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED) up = false;
    else if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (
        !up &&
        batchSize(ms) >= RESYNC_BATCH_MIN_APPLIED &&
        !pressMs.some((p) => Math.abs(p - ms) <= PRESS_ROW_PAIR_MS) &&
        !otherPressMs.some((p) => p <= ms + 5 && ms - p <= 100)
      )
        out.push(ms);
      up = true;
    } else up = true; // a REFRESH / dose row: it is up
  }
  return out;
}

/** A press as the cast-reading families hold it — the logged
 * SPELL_CAST_SUCCESS rows plus the hidden presses (`hiddenPressMs`) of the
 * spells `keep` admits, marked `unseenPress`, in time order. */
export interface IPressRow {
  spellId: string;
  spellName: string;
  logLine: { event: string; timestamp: number };
  unseenPress?: true;
}

export function pressRowsWithHidden(
  unit: Pick<ICombatUnit, "id" | "auraEvents" | "spellCastEvents">,
  keep: (spellId: string) => boolean,
  fromMs: number,
): IPressRow[] {
  const ids = hiddenPressCandidates(unit, keep);
  return [
    ...(unit.spellCastEvents ?? []).map((c) => ({
      spellId: c.spellId ?? "",
      spellName: c.spellName ?? "",
      logLine: c.logLine,
    })),
    ...[...ids].flatMap((id) =>
      hiddenPressMs(unit, id, fromMs).map((ms) => ({
        spellId: id,
        spellName: "",
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
        unseenPress: true as const,
      })),
    ),
  ].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
}

/** The presses `keep` admits whose aura the unit carries — by the aura's own
 * id, or the cast whose own effect it is (`castsOwningEffectAura`: Alter
 * Time 342245 for its 342246). The ids `hiddenPressMs` is asked about. */
export function hiddenPressCandidates(
  unit: Pick<ICombatUnit, "auraEvents">,
  keep: (spellId: string) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const a of unit.auraEvents ?? []) {
    if (!a.spellId) continue;
    for (const id of [a.spellId, ...castsOwningEffectAura(a.spellId)])
      if (keep(id)) out.add(id);
  }
  return out;
}
