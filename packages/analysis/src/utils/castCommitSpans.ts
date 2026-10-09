import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CHANNELED_SPELL_IDS } from "../data/channeledGenerated";
import { dropAuraRebroadcasts, supersededAuraBreaks } from "./auraIntervals";

/**
 * castCommitSpans.ts — the stretches a unit spent committed to a cast that
 * has no `SPELL_CAST_START` bar: an empowered cast being held, and a channel.
 *
 * Both are invisible to anything that pairs CAST_START with CAST_SUCCESS:
 *  - an empower logs SPELL_EMPOWER_START and its SPELL_CAST_SUCCESS at the
 *    SAME instant (the success is the press, not the release), then
 *    SPELL_EMPOWER_END (released) or SPELL_EMPOWER_INTERRUPT (cut short —
 *    nothing is released);
 *  - a channel logs SPELL_CAST_SUCCESS when it begins and nothing when it
 *    ends; the caster's own same-id aura is the only record of its length.
 *
 * Single predicate for both facts: `occupancyWithin` (what a player's
 * hands were doing — the owner's and a teammate dispeller's) and the timeline's `[EMPOWER not released …]` tag
 * read these, so "was mid-empower" cannot mean two things.
 */

/** A hold longer than this is not a hold: the closing event belongs to a
 * later cast. Empowers release by themselves a little after the top rank
 * (longest of 1,694 holds on the 605-file capture manifest: 2.79 s); 12 s is
 * the same generous bound `hardCastBarsWithin` gives a cast bar (its
 * own constant — two facts that happen to share a number). */
export const EMPOWER_MAX_HOLD_MS = 12_000;

/** How far an empowered cast's SPELL_CAST_SUCCESS may sit from its
 * SPELL_EMPOWER_START. They are written 1 ms apart; half a second absorbs any
 * caller that carries the press time at coarser precision, and no second
 * hold of the same spell can begin that soon. */
export const EMPOWER_PRESS_MATCH_MS = 500;

export interface IEmpowerSpan {
  spellId: string;
  spellName: string;
  startMs: number;
  endMs: number;
  /** The level released at, or the level reached when it was interrupted. */
  level: number;
  /** True when the hold ended in SPELL_EMPOWER_INTERRUPT: nothing fired. The
   * log writes that event for ANY unreleased hold — an enemy CC or kick, but
   * also the caster moving or letting go before the first rank — so this is
   * "not released", not "an enemy interrupted it". */
  interrupted: boolean;
}

export type EmpowerSpanUnit = Pick<
  ICombatUnit,
  "empowerStarts" | "empowerEnds" | "empowerInterrupts"
>;

/**
 * Every empowered cast the unit held, start to end, in time order.
 *
 * A START is closed by the first END / INTERRUPT of the same spell that
 * follows it in LOG ORDER (timestamp, then line index) before the next START
 * of that spell, within EMPOWER_MAX_HOLD_MS; each closing event closes one
 * hold. Log order matters when a hold is cut and re-pressed on the same
 * millisecond: the INTERRUPT written before the second START closes the
 * first hold, and the second keeps its own END. A START with no such event
 * (log cut, round end) is dropped rather than guessed.
 *
 * `null` when the parse carries no `empowerStarts` (documents stored before
 * the parser kept them): unknown, never "held nothing".
 */
export function empowerSpans(unit: EmpowerSpanUnit): IEmpowerSpan[] | null {
  const starts = unit.empowerStarts;
  if (!Array.isArray(starts)) return null;
  type Ordered = { timestamp: number; logLine?: { lineIndex?: number } };
  // -1 / +1: is `a` before / after `b` in the log? Events on the same
  // millisecond with no line index on either side compare equal (0).
  const order = (a: Ordered, b: Ordered): number =>
    a.timestamp - b.timestamp ||
    (a.logLine?.lineIndex ?? 0) - (b.logLine?.lineIndex ?? 0);
  const closers = [
    ...(unit.empowerEnds ?? []).map((e) => ({ e, interrupted: false })),
    ...(unit.empowerInterrupts ?? []).map((e) => ({ e, interrupted: true })),
  ].sort((a, b) => order(a.e, b.e));
  const sorted = [...starts].sort(order);
  const used = new Set<object>();
  const out: IEmpowerSpan[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const nextSameSpell = sorted
      .slice(i + 1)
      .find((n) => n.spellId === s.spellId);
    const close = closers.find(
      (c) =>
        !used.has(c) &&
        c.e.spellId === s.spellId &&
        order(c.e, s) >= 0 &&
        c.e.timestamp - s.timestamp <= EMPOWER_MAX_HOLD_MS &&
        (nextSameSpell === undefined || order(c.e, nextSameSpell) <= 0),
    );
    if (!close) continue;
    used.add(close);
    out.push({
      spellId: s.spellId,
      spellName: s.spellName,
      startMs: s.timestamp,
      endMs: close.e.timestamp,
      level: close.e.level,
      interrupted: close.interrupted,
    });
  }
  return out;
}

/** How far from a channel's SPELL_CAST_SUCCESS its own aura may start. The
 * two share a server tick; the aura line is sometimes written 1 ms first. */
export const CHANNEL_AURA_LEAD_MS = 1;
export const CHANNEL_AURA_LAG_MS = 100;

export interface IChannelSpan {
  spellId: string;
  spellName: string;
  startMs: number;
  endMs: number;
}

/**
 * Every channel whose length the log records: a SPELL_CAST_SUCCESS of an
 * officially channelled spell (`CHANNELED_SPELL_IDS`, DB2 "Is Channelled")
 * paired with the caster's own same-id aura starting within
 * [−CHANNEL_AURA_LEAD_MS, +CHANNEL_AURA_LAG_MS] of it; the span runs from the
 * success to that aura's removal.
 *
 * A LOWER BOUND by construction: a channel that puts no same-id aura on its
 * caster (the aura sits on the target, or under another id) has no logged
 * end and is not guessed.
 */
export function channelSpans(
  unit: Pick<ICombatUnit, "id" | "spellCastEvents" | "auraEvents">,
): IChannelSpan[] {
  // `spellCastEvents` holds SPELL_CAST_SUCCESS only (parser collect.ts), so
  // the id gate is the whole filter.
  const casts = (unit.spellCastEvents ?? []).filter((e) =>
    CHANNELED_SPELL_IDS.has(e.spellId),
  );
  if (casts.length === 0) return [];
  const out: IChannelSpan[] = [];
  const open = new Map<string, number>();
  // Re-broadcast REMOVED / APPLIED pairs (a Dracthyr visage swap mid-channel)
  // are one continuous aura, not the channel's end — the filter every aura
  // consumer goes through.
  // … and a BROKEN line the aura's own REMOVED follows is not its end.
  const notTheEnd = supersededAuraBreaks(unit.auraEvents ?? []);
  const auras = dropAuraRebroadcasts(unit.auraEvents ?? [])
    .filter(
      (a) =>
        !notTheEnd.has(a) &&
        a.srcUnitId === unit.id &&
        a.destUnitId === unit.id &&
        CHANNELED_SPELL_IDS.has(a.spellId),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const a of auras) {
    const ev = a.logLine.event;
    if (ev === LogEvent.SPELL_AURA_APPLIED) {
      open.set(a.spellId, a.timestamp);
      continue;
    }
    if (
      ev !== LogEvent.SPELL_AURA_REMOVED &&
      ev !== LogEvent.SPELL_AURA_BROKEN &&
      ev !== LogEvent.SPELL_AURA_BROKEN_SPELL
    )
      continue;
    const from = open.get(a.spellId);
    if (from === undefined) continue;
    open.delete(a.spellId);
    const cast = casts.find(
      (c) =>
        c.spellId === a.spellId &&
        from - c.timestamp >= -CHANNEL_AURA_LEAD_MS &&
        from - c.timestamp <= CHANNEL_AURA_LAG_MS,
    );
    if (!cast) continue;
    out.push({
      spellId: a.spellId,
      spellName: cast.spellName,
      startMs: Math.min(cast.timestamp, from),
      endMs: a.timestamp,
    });
  }
  return out;
}
