import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CHANNELED_SPELL_IDS } from "../data/channeledGenerated";
import { OFF_GCD_SPELL_IDS } from "../data/offGcdGenerated";
import { getEnglishSpellName } from "../data/spellEffectData";
import { dropAuraRebroadcasts, supersededAuraBreaks } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "./castRowLag";

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

/** How far from a channel's SPELL_CAST_SUCCESS its own aura may start: the
 * aura up to the shared measured aura-before-cast-row lag ahead of it
 * (`AURA_BEFORE_CAST_ROW_MAX_MS`; the public wowarenalogs testlogs: 30 of 77
 * channel auras 2–13 ms ahead of their success, which the old 1 ms lead
 * left unpaired), up to 100 ms after it. */
export const CHANNEL_AURA_LEAD_MS = AURA_BEFORE_CAST_ROW_MAX_MS;
export const CHANNEL_AURA_LAG_MS = 100;

export interface IChannelSpan {
  spellId: string;
  spellName: string;
  startMs: number;
  endMs: number;
  /** the SPELL_CAST_SUCCESS this span is the channel of */
  castMs: number;
  /** what ended it: its aura's REMOVED / BROKEN, a re-cast of the spell
   * that took the channel over (its own SUCCESS + the aura's REFRESH), or —
   * for a channel with no aura of its own — a kick or its last tick
   * (`inferred`) */
  endedBy: "removed" | "broken" | "recast" | "inferred";
}

/**
 * Every channel whose length the log records: a SPELL_CAST_SUCCESS of an
 * officially channelled spell (`CHANNELED_SPELL_IDS`, DB2 "Is Channelled")
 * paired with the caster's own same-id aura starting within
 * [−CHANNEL_AURA_LEAD_MS, +CHANNEL_AURA_LAG_MS] of it; the span runs from the
 * earlier of the two to that aura's removal. One span per cast: a re-cast
 * mid-channel restarts it with a REFRESH of the aura and its own SUCCESS
 * (codex 20-F17-09 #2, ecfb3a7f 141.287 s), which ends the first span
 * (`endedBy: "recast"`) and opens the re-cast's. The one reading of "which
 * channel, from when to when" — missed-cleanse's busy spans, kick-audit's
 * stopped channels and the gap filler's `[channel cut by CC after Ns]`.
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
  const open = new Map<
    string,
    { from: number; cast: (typeof casts)[number] }
  >();
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
  const castOf = (spellId: string, auraMs: number) =>
    casts.find(
      (c) =>
        c.spellId === spellId &&
        auraMs - c.timestamp >= -CHANNEL_AURA_LEAD_MS &&
        auraMs - c.timestamp <= CHANNEL_AURA_LAG_MS,
    );
  const close = (
    spellId: string,
    endMs: number,
    endedBy: IChannelSpan["endedBy"],
  ) => {
    const o = open.get(spellId);
    if (!o) return;
    open.delete(spellId);
    out.push({
      spellId,
      spellName: o.cast.spellName,
      startMs: Math.min(o.cast.timestamp, o.from),
      endMs,
      castMs: o.cast.timestamp,
      endedBy,
    });
  };
  for (const a of auras) {
    const ev = a.logLine.event;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH
    ) {
      const cast = castOf(a.spellId, a.timestamp);
      // a REFRESH no cast started is the running channel's own row
      if (!cast) {
        if (ev === LogEvent.SPELL_AURA_APPLIED) open.delete(a.spellId);
        continue;
      }
      if (open.get(a.spellId)?.cast === cast) continue;
      close(a.spellId, a.timestamp, "recast");
      open.set(a.spellId, { from: a.timestamp, cast });
      continue;
    }
    if (ev === LogEvent.SPELL_AURA_REMOVED)
      close(a.spellId, a.timestamp, "removed");
    else if (
      ev === LogEvent.SPELL_AURA_BROKEN ||
      ev === LogEvent.SPELL_AURA_BROKEN_SPELL
    )
      close(a.spellId, a.timestamp, "broken");
  }
  return out;
}

/**
 * fact1215 R9 (2026-10-18): the channels `channelSpans` cannot see — an
 * officially channelled cast (`CHANNELED_SPELL_IDS`) that puts no same-id
 * aura on its caster (Arcane Missiles 5143: its ticks log as 7268 "Arcane
 * Missiles" damage, no aura) — ended where the log shows it ending:
 *  - a SPELL_INTERRUPT of that spell on the caster (a kick), else
 *  - the caster's own last row of the channel's effect: a damage / heal row
 *    from the caster with the channel's English name (the tick's id is not
 *    the cast's, its name is).
 * Read inside the cast's official length (`buffFullDurationForCaster`) and
 * before the caster's next press — of the same spell, or of anything else
 * (a SUCCESS or a cast start). With neither, or no
 * official length, nothing is guessed. A lower bound like `channelSpans`:
 * the last tick is not later than the channel's end.
 *
 * NOT for a reader that needs the channel's exact end (`kickAudit`'s
 * "stopped just before the kick" reads `channelSpans` alone: a last tick
 * sits up to one tick interval before the end). The occupancy reader
 * (`occupancyWithin`, missed-cleanse `ownerCastingS`) adds these — 62fdbf2e
 * r0 had three Arcane Missiles channels in a cleanse window counted as free
 * hands.
 */
export function tickEndedChannelSpans(
  unit: Pick<
    ICombatUnit,
    | "id"
    | "spellCastEvents"
    | "auraEvents"
    | "damageOut"
    | "healOut"
    | "actionIn"
  > &
    Partial<Pick<ICombatUnit, "spec" | "info">>,
): IChannelSpan[] {
  const casts = (unit.spellCastEvents ?? [])
    .filter((e) => CHANNELED_SPELL_IDS.has(e.spellId))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (casts.length === 0) return [];
  const logged = channelSpans(unit);
  const out: IChannelSpan[] = [];
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i]!;
    if (
      logged.some(
        (l) =>
          l.spellId === c.spellId &&
          l.startMs <= c.timestamp &&
          c.timestamp <= l.endMs + CHANNEL_AURA_LAG_MS,
      )
    )
      continue;
    const fullS = buffFullDurationForCaster(
      c.spellId,
      unit as never,
      c.timestamp,
    );
    if (fullS === undefined || !(fullS > 0)) continue;
    const nextSame = casts.slice(i + 1).find((n) => n.spellId === c.spellId);
    // the caster's next press of anything else ends the channel: a tick that
    // lands after it is no channelling (codex 20-F15-24: 0284fcd9 r3,
    // Arcane Missiles 163.491, Arcane Barrage 164.869, a Missiles hit at
    // 165.441 read as 572 ms more channelling)
    // — an off-GCD press excepted: Shimmer mid-Missiles leaves the channel
    // running (codex 20-F15-28: its ticks went on through 11.9 s) — unless
    // that press is a channel of its own, which replaces this one (codex
    // 20-F15-34: Breath of Jan'alai 1308728)
    const nextOther = [
      ...(unit.spellCastEvents ?? []),
      ...((unit as { castStartEvents?: typeof unit.spellCastEvents })
        .castStartEvents ?? []),
    ]
      .filter(
        (e) =>
          e.spellId !== c.spellId &&
          e.timestamp > c.timestamp &&
          !(
            e.spellId &&
            OFF_GCD_SPELL_IDS.has(e.spellId) &&
            !CHANNELED_SPELL_IDS.has(e.spellId)
          ),
      )
      .reduce((m, e) => Math.min(m, e.timestamp), Infinity);
    const capMs = Math.min(
      c.timestamp + fullS * 1000,
      nextSame?.timestamp ?? Infinity,
      nextOther,
    );
    const kick = (unit.actionIn ?? []).find(
      (a) =>
        a.logLine.event === LogEvent.SPELL_INTERRUPT &&
        a.destUnitId === unit.id &&
        (a as { extraSpellId?: string }).extraSpellId === c.spellId &&
        a.logLine.timestamp >= c.timestamp &&
        a.logLine.timestamp <= capMs,
    );
    const name = getEnglishSpellName(c.spellId, c.spellName);
    const endBy = kick?.logLine.timestamp ?? capMs;
    let lastTick: number | undefined;
    for (const r of [...(unit.damageOut ?? []), ...(unit.healOut ?? [])]) {
      if (r.srcUnitId !== unit.id) continue;
      const t = r.logLine.timestamp;
      if (t <= c.timestamp || t > endBy) continue;
      if (getEnglishSpellName(r.spellId, r.spellName) !== name) continue;
      if (lastTick === undefined || t > lastTick) lastTick = t;
    }
    const endMs = kick?.logLine.timestamp ?? lastTick;
    if (endMs === undefined || endMs <= c.timestamp) continue;
    out.push({
      spellId: c.spellId,
      spellName: c.spellName,
      startMs: c.timestamp,
      endMs,
      castMs: c.timestamp,
      endedBy: "inferred",
    });
  }
  return out;
}
