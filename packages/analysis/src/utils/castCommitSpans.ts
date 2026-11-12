import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CHANNELED_SPELL_IDS } from "../data/channeledGenerated";
import { OFF_GCD_SPELL_IDS, ON_GCD_SPELL_IDS } from "../data/offGcdGenerated";
import { getEnglishSpellName } from "../data/spellEffectData";
import { CAST_WHILE_CHANNELING_SPELL_IDS } from "../data/spellStateAttrsGenerated";
import { dropAuraRebroadcasts, supersededAuraBreaks } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { isNoPressRow } from "./castPress";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "./castRowLag";
import { fmtTime } from "./renderGrid";

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
 * The instant the caster's next press of anything else ended a channel begun
 * at `afterMs` (Infinity when none): a tick that lands after it is no
 * channelling (codex 20-F15-24: 0284fcd9 r3, Arcane Missiles 163.491, Arcane
 * Barrage 164.869, a Missiles hit at 165.441 read as 572 ms more channelling)
 * — a press DB2 lets through excepted: Shimmer mid-Missiles leaves the channel
 * running (codex 20-F15-28: its ticks went on through 11.9 s) — unless that
 * press is a channel of its own, which replaces this one (codex 20-F15-34:
 * Breath of Jan'alai 1308728).
 *
 * "Lets through" is off the global cooldown AND Allow Cast While Channeling
 * (`CAST_WHILE_CHANNELING_SPELL_IDS`). Off-GCD alone read too wide: 24
 * archives of the 605 sample, off-GCD presses inside a channel its own aura
 * measures, no bit: 39 ended it within 100 ms, 0 left it running (fact7
 * `channelOutlived`, 33-5-238: Pain Suppression 3.47 s into an Ultimate
 * Penitence stopped it at 19 of its 25 bolts). On-GCD presses with the bit
 * still end it here, as before (Soothing Mist, which allows them, is
 * measured by its aura and never reaches this reading).
 */
export function nextPressEndingChannelMs(
  unit: Pick<ICombatUnit, "spellCastEvents">,
  spellId: string,
  afterMs: number,
): number {
  const casts = unit.spellCastEvents ?? [];
  return [
    ...casts.filter((e) => rowIsPressEndingCast(e, casts)),
    ...(
      (unit as { castStartEvents?: typeof unit.spellCastEvents })
        .castStartEvents ?? []
    ).filter((e) => !pressRidesAlong(e.spellId)),
  ]
    .filter((e) => e.spellId !== spellId && e.timestamp > afterMs)
    .reduce((m, e) => Math.min(m, e.timestamp), Infinity);
}

/** Has DB2 a SpellCooldowns row for this cast id — on the global cooldown or
 * off it (`ON_GCD_SPELL_IDS` / `OFF_GCD_SPELL_IDS`)? A row with none — a
 * passive trigger, a pet command, a channel's tick under its own id — is no
 * press of a button (codex 20-F25-01: 8919f02e Shadowy Apparition inside a
 * Vampiric Touch, 0bc703bc Spell Lock's command inside a Chaos Bolt). */
export function isButtonPress(spellId: string): boolean {
  return ON_GCD_SPELL_IDS.has(spellId) || OFF_GCD_SPELL_IDS.has(spellId);
}

/**
 * Is this SPELL_CAST_SUCCESS row a press that ends a running channel or cast
 * bar of another spell — the one reading of "the unit did something a cast
 * cannot outlive" (`nextPressEndingChannelMs`, `kickAudit`'s open bar):
 * a press of a button (`isButtonPress`), no copy, tick or companion row of
 * another press (`isNoPressRow` — fact11 D2: Divine Hymn's own 64844 tick
 * row 1.04 s into the channel read as the press that ended it, `channeled
 * 1.0s` for a 3.95 s channel), that does not ride along (`pressRidesAlong`).
 */
export function rowIsPressEndingCast<
  T extends {
    spellId?: string;
    destUnitId?: string;
    logLine: { timestamp: number; event?: string };
  },
>(e: T, rows: readonly T[]): boolean {
  return (
    !!e.spellId &&
    isButtonPress(e.spellId) &&
    !pressRidesAlong(e.spellId) &&
    !isNoPressRow(e, rows)
  );
}

/** A press that leaves a running channel or cast bar going: off the global
 * cooldown, castable while channelling (DB2 bit), and no channel itself.
 * `nextPressEndingChannelMs`'s exemption; the kick audit's open-bar test
 * reads it too (fact10 D22). */
export function pressRidesAlong(spellId: string | undefined): boolean {
  return (
    !!spellId &&
    OFF_GCD_SPELL_IDS.has(spellId) &&
    CAST_WHILE_CHANNELING_SPELL_IDS.has(spellId) &&
    !CHANNELED_SPELL_IDS.has(spellId)
  );
}

/** The caster's own last row of a channel's effect after `afterMs`, up to
 * `untilMs` (undefined when none): a damage / heal row with the channel's
 * English name (a tick's id is not the cast's, its name is), a hit a shield
 * ate (SPELL_ABSORBED: `spellId` the shield, `attackSpellId` the hit) or one
 * that missed (7a404f6a 1:01: Ultimate Penitence's bolts into a Grounding
 * Totem, MISSED from 3.0 s to 5.05 s). */
function lastChannelEffectMs(
  unit: Pick<ICombatUnit, "id" | "damageOut" | "healOut"> &
    Partial<Pick<ICombatUnit, "missesOut">>,
  name: string,
  afterMs: number,
  untilMs: number,
  /** `untilMs` is the next press of the same channel: its own rows (a
   * refusal logged in its millisecond) are not this channel's (GH #192) */
  untilExclusive = false,
): number | undefined {
  let last: number | undefined;
  for (const r of [
    ...(unit.damageOut ?? []),
    ...(unit.healOut ?? []),
    ...(unit.missesOut ?? []),
  ]) {
    if (r.srcUnitId !== unit.id) continue;
    const t = r.logLine.timestamp;
    if (t <= afterMs || t > untilMs || (untilExclusive && t >= untilMs - 0.5))
      continue;
    const { attackSpellId, attackSpellName } = r as {
      attackSpellId?: string;
      attackSpellName?: string;
    };
    const english = attackSpellId
      ? getEnglishSpellName(attackSpellId, attackSpellName ?? "")
      : getEnglishSpellName(r.spellId, r.spellName);
    if (english !== name) continue;
    if (last === undefined || t > last) last = t;
  }
  return last;
}

/**
 * Where a channel ended, for the `[YOU] [CD]` channel suffix: its aura's end,
 * or the next press that ended it while the aura ran on (fact7 D12, 07367f6e
 * 0:40: Ultimate Penitence's 421453 ran 6.5 s, Penance went off 5.93 s in).
 *
 * A pressed spell DB2 does not call a channel has an aura that does not
 * measure one. Ultimate Penitence's 421453 is the 6.5 s shield (DB2 duration
 * index 589, a damage absorb that ignores haste); the channel is 421434, 6 s before haste, and
 * leaves no aura. It writes its bolts, 25 when it runs out, so there the end
 * is also the last bolt (fact7 `channelOutlived`, 45-1-267: bolts to 5.05 s,
 * Fade at 5.25 s, printed 6.5 s). A bolt can land after the press that
 * stopped the channel, still in the air: the press wins then.
 */
export function channelEndSeconds(
  unit: Pick<ICombatUnit, "id" | "spellCastEvents" | "damageOut" | "healOut"> &
    Partial<Pick<ICombatUnit, "missesOut">>,
  spellId: string,
  castSeconds: number,
  auraEndSeconds: number,
  matchStartMs: number,
  spellName = "",
): number {
  const castMs = matchStartMs + castSeconds * 1000;
  const toSeconds = (ms: number) => (ms - matchStartMs) / 1000;
  const end = Math.min(
    auraEndSeconds,
    toSeconds(nextPressEndingChannelMs(unit, spellId, castMs)),
  );
  if (CHANNELED_SPELL_IDS.has(spellId)) return end;
  const lastEffectMs = lastChannelEffectMs(
    unit,
    getEnglishSpellName(spellId, spellName),
    castMs,
    matchStartMs + auraEndSeconds * 1000,
  );
  return lastEffectMs === undefined
    ? end
    : Math.min(end, toSeconds(lastEffectMs));
}

/**
 * The `[YOU] [CD]` channel suffix's tail for a pressed spell whose own aura
 * outlives the channel it measures (GH #194, user ruling 2026-11-07):
 * Ultimate Penitence's channel is its bolts (what a kick can stop), and its
 * 421453 aura runs on through the descent, ~6.5 s. The suffix keeps the bolt
 * phase and states the aura's end beside it; `channelEndOnOwnRow` reads this
 * tail. Empty when the aura is the channel (`CHANNELED_SPELL_IDS`) or ends
 * in the channel's rendered second.
 */
export const CHANNEL_AURA_TAIL = "its aura until";
export function channelAuraTail(
  spellId: string,
  channelEndSeconds: number,
  auraEndSeconds: number,
): string {
  if (CHANNELED_SPELL_IDS.has(spellId)) return "";
  if (!(auraEndSeconds > channelEndSeconds)) return "";
  const aura = fmtTime(auraEndSeconds);
  if (aura === fmtTime(channelEndSeconds)) return "";
  return `; ${CHANNEL_AURA_TAIL} ${aura}`;
}

/** How close to its SUCCESS row a channel's own refusal is logged: the
 * Ray of Frost MISS a millisecond after the press (fact11 D39). */
const CHANNEL_REFUSED_AT_CAST_MS = 50;

/**
 * Did a channel that put no aura on its caster never run? The game refused
 * it at the press — a SPELL_MISSED of the cast's own id by the caster logged
 * within `CHANNEL_REFUSED_AT_CAST_MS` of the press — and nothing of the
 * channel (`lastChannelEffectMs`: a damage, heal, absorbed or missed row of
 * its English name) follows that refusal before `untilMs`. fact11 D39
 * (e4784cab r0): Ray of Frost at 9.718 into a fresh Phase Shift, MISS at
 * 9.719, no aura, no tick, the next press a second Ray at 12.168 — the
 * ledger gave the first one its official 4 s.
 */
export function channelRefusedAtCast(
  unit: Pick<ICombatUnit, "id" | "damageOut" | "healOut"> &
    Partial<Pick<ICombatUnit, "missesOut">>,
  spellId: string,
  castMs: number,
  untilMs: number,
  spellName = "",
  /** `untilMs` is the caster's next press of the same channel: a row in
   * its millisecond is that press's (GH #192: the second Ray of Frost's
   * IMMUNE at exactly 12.000 read as the first one running to 12 s) */
  untilIsNextPress = false,
): boolean {
  const refusal = (unit.missesOut ?? []).find(
    (r) =>
      r.srcUnitId === unit.id &&
      r.spellId === spellId &&
      Math.abs(r.logLine.timestamp - castMs) <= CHANNEL_REFUSED_AT_CAST_MS,
  );
  if (!refusal) return false;
  return (
    lastChannelEffectMs(
      unit,
      getEnglishSpellName(spellId, spellName),
      refusal.logLine.timestamp,
      untilMs,
      untilIsNextPress,
    ) === undefined
  );
}

/** Ultimate Penitence's 25 bolts in 6 s before haste: the last bolt of a
 * running channel lies less than this before any instant. */
const CHANNEL_EFFECT_GAP_S = 0.3;

/**
 * Was the channel over before `roundEndSeconds`, the instant its aura was cut
 * at? A press ended it there, or its own effect stopped more than a bolt
 * before (`channelEndSeconds`). The status beside the duration: of 16 `still
 * channeling when the round ended` lines on the 605 capture, 44-6-278's
 * Ultimate Penitence was ended by Shadow Word: Death 0.4 s before the round,
 * and 93-4-657's last bolt came 1.9 s before it (fact7 r6, codex 01-3).
 */
export function channelOverBeforeRoundEnd(
  unit: Parameters<typeof channelEndSeconds>[0],
  spellId: string,
  castSeconds: number,
  roundEndSeconds: number,
  matchStartMs: number,
  spellName = "",
): boolean {
  const castMs = matchStartMs + castSeconds * 1000;
  if (
    nextPressEndingChannelMs(unit, spellId, castMs) <
    matchStartMs + roundEndSeconds * 1000
  )
    return true;
  const end = channelEndSeconds(
    unit,
    spellId,
    castSeconds,
    roundEndSeconds,
    matchStartMs,
    spellName,
  );
  return roundEndSeconds - end > CHANNEL_EFFECT_GAP_S;
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
  // …unless a cast of the channel comes with the pair: that is a re-cast,
  // the first channel's end (codex 30-RV-02 #1, b0a417b7 r6: Crackling Jade
  // Lightning recast at 59.353 s merged into the 58.033 s cast, which then
  // read `cut by CC after 1.5s`; the recast ran 0.229 s)
  const recastAt = (a: { spellId?: string | null; timestamp: number }) =>
    casts.some(
      (c) =>
        c.spellId === a.spellId &&
        a.timestamp - c.timestamp >= -CHANNEL_AURA_LEAD_MS &&
        a.timestamp - c.timestamp <= CHANNEL_AURA_LAG_MS,
    );
  const auras = dropAuraRebroadcasts(unit.auraEvents ?? [], (_r, a) =>
    recastAt(a),
  )
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
    const startMs = Math.min(o.cast.timestamp, o.from);
    // D1 (user 2026-10-24): a channel the next cast took over ends no later
    // than its own official length — a lost REMOVED otherwise left it
    // "channelling" until the next press, however much later. An end the
    // log wrote (REMOVED / BROKEN) stands: a refreshed channel can run past
    // its base length (a 24.8 s Soothing Mist on the 605 manifest).
    let end = endMs;
    if (endedBy === "recast") {
      const fullS = buffFullDurationForCaster(
        spellId,
        unit as never,
        o.cast.timestamp,
      );
      if (fullS !== undefined && fullS > 0)
        end = Math.min(end, o.cast.timestamp + fullS * 1000);
    }
    out.push({
      spellId,
      spellName: o.cast.spellName,
      startMs,
      endMs: end,
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

/** English name → the channelled ids that carry it (`CHANNELED_SPELL_IDS`,
 * derived, never hand-listed). */
let channelledIdsByName: Map<string, string[]> | undefined;

/**
 * The channelled ids a press of `spellId` is carried by: a press that is not
 * itself in the channelled table, while a channelled id of the same English
 * name appears on the caster's own effect rows this round (damage, heal or
 * miss rows: the log's proof that this unit's press runs that channel — a
 * same-named spell that is a plain instant for this unit has no such row).
 * Empty for a press in the table and for one with no such row.
 */
function carrierIdsOf(
  unit: Pick<ICombatUnit, "id" | "damageOut" | "healOut"> &
    Partial<Pick<ICombatUnit, "missesOut">>,
  spellId: string,
  spellName: string,
): string[] {
  if (CHANNELED_SPELL_IDS.has(spellId)) return [];
  if (!channelledIdsByName) {
    channelledIdsByName = new Map();
    for (const id of CHANNELED_SPELL_IDS) {
      const n = getEnglishSpellName(id, "");
      if (n === "") continue;
      channelledIdsByName.set(n, [...(channelledIdsByName.get(n) ?? []), id]);
    }
  }
  const ids = channelledIdsByName.get(getEnglishSpellName(spellId, spellName));
  if (!ids) return [];
  const seen = new Set<string>();
  for (const r of [
    ...(unit.damageOut ?? []),
    ...(unit.healOut ?? []),
    ...(unit.missesOut ?? []),
  ]) {
    if (r.srcUnitId !== unit.id) continue;
    const id = (r as { attackSpellId?: string }).attackSpellId ?? r.spellId;
    if (id && ids.includes(id)) seen.add(id);
  }
  return [...seen];
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
  // T92: a channel pressed under one id and carried by another — Lightning
  // Lasso's press is 305483, the channelled spell DB2 marks is 305485, the
  // debuff held on the target. Such a press is a channel's when the caster's
  // own effect rows carry a channelled id of the press's English name
  // (`carrierIdsOf`); 203 Lasso presses of the 605 corpus read as free hands.
  const carried = new Map<string, readonly string[]>();
  const casts = (unit.spellCastEvents ?? [])
    .filter((e) => {
      if (CHANNELED_SPELL_IDS.has(e.spellId)) return true;
      const ids = carrierIdsOf(unit, e.spellId, e.spellName);
      if (ids.length === 0) return false;
      carried.set(e.spellId, ids);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  if (casts.length === 0) return [];
  const logged = channelSpans(unit);
  const out: IChannelSpan[] = [];
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i]!;
    const carriers = carried.get(c.spellId);
    // a carried press whose channelled row is a cast row of its own in the
    // same instant (a companion row) is that row's channel, read above
    if (
      carriers &&
      casts.some(
        (o) =>
          carriers.includes(o.spellId) &&
          Math.abs(o.timestamp - c.timestamp) <= CHANNEL_AURA_LAG_MS,
      )
    )
      continue;
    if (
      logged.some(
        (l) =>
          l.spellId === c.spellId &&
          l.startMs <= c.timestamp &&
          c.timestamp <= l.endMs + CHANNEL_AURA_LAG_MS,
      )
    )
      continue;
    // the press's own official length, or its carrier's (the longest)
    const lengths = [c.spellId, ...(carriers ?? [])]
      .map((id) => buffFullDurationForCaster(id, unit as never, c.timestamp))
      .filter((d): d is number => d !== undefined && d > 0);
    if (lengths.length === 0) continue;
    const fullS = Math.max(...lengths);
    const nextSame = casts.slice(i + 1).find((n) => n.spellId === c.spellId);
    const capMs = Math.min(
      c.timestamp + fullS * 1000,
      nextSame?.timestamp ?? Infinity,
      nextPressEndingChannelMs(unit, c.spellId, c.timestamp),
    );
    const kick = (unit.actionIn ?? []).find(
      (a) =>
        a.logLine.event === LogEvent.SPELL_INTERRUPT &&
        a.destUnitId === unit.id &&
        [c.spellId, ...(carriers ?? [])].includes(
          (a as { extraSpellId?: string }).extraSpellId ?? "",
        ) &&
        a.logLine.timestamp >= c.timestamp &&
        a.logLine.timestamp <= capMs,
    );
    const name = getEnglishSpellName(c.spellId, c.spellName);
    const endBy = kick?.logLine.timestamp ?? capMs;
    const lastTick = lastChannelEffectMs(unit, name, c.timestamp, endBy);
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
