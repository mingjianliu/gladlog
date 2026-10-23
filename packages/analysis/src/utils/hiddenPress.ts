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
import { spellEffectData } from "../data/spellEffectData";
import { dropAuraRebroadcasts } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";

/** A re-stating batch: at least this many SPELL_AURA_APPLIED rows on the
 * unit in one millisecond (5f4142ec: 30; a press that applies several
 * auras at once — Deep Breath's five — stays under it). */
export const RESYNC_BATCH_MIN_APPLIED = 6;

/** One batch's rows can straddle a millisecond boundary (0284fcd9 r1 0:12:
 * ten rows at .108, five at .109, Tranquility among the second five). */
export const RESYNC_BATCH_SPAN_MS = 5;

/** Herald of the Sun's proc Avenging Wrath comes with its own bundle in one
 * ms — Blessing of An'she 445206, Hammer of Wrath 1241410 (Born in
 * Sunlight, Empyrean Legacy beside them) — enough APPLIED rows to look like a
 * re-listing; an Avenging Wrath (31884 / 454351) beside either is the proc,
 * not a press made unseen (corpusFactScan2 duplicateLine, 136-1-737 2:12:
 * `(proc 5 of 5) [pressed while unseen]` and `(no press)` for one APPLIED;
 * corpusFactScan's heraldProcSkipped reads this set). */
export const HERALD_PROC_BUNDLE_IDS: ReadonlySet<string> = new Set([
  "445206",
  "1241410",
]);
const AVENGING_WRATH_AURA_IDS = new Set(["31884", "454351"]);

/** A press row this close to the aura is the aura's own press, not a lost
 * one. */
const PRESS_ROW_PAIR_MS = 1000;

/** How long an own aura whose REMOVED the log lost is still read as up
 * after its last (re)application: its official length + 1 s, else for good
 * (codex 21-R12-a #3). The corpus scan's `hiddenPressUnused` reads it too. */
export function hiddenAuraLifeMs(
  spellId: string,
  /** the aura's caster, when known: its talents lengthen it (codex
   * 20-F17-04 #3 / 62-POSTHOC-13f #2: Invigorating Fury's 11 s Enraged
   * Regeneration expired at the base 9 s + 1, and a re-listing at 20 s read
   * as a second press) */
  caster?: unknown,
  atMs?: number,
): number {
  const talented =
    caster !== undefined &&
    (caster as { spellCastEvents?: unknown }).spellCastEvents !== undefined
      ? buffFullDurationForCaster(spellId, caster as never, atMs)
      : null;
  const d = talented ?? spellEffectData[spellId]?.durationSeconds;
  return typeof d === "number" && d > 0 ? (d + 1) * 1000 : Infinity;
}

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
  // an application the batch then re-states (a second APPLIED of it inside
  // the batch's span, no REMOVED between) was made while the unit was still
  // seen — a copy another logged press put up, not a press lost while unseen
  // (71-5 0:35: Exhilaration's Smoke Screen Survival of the Fittest at
  // .200, re-stated with Dampening at .201). A press of another spell in the
  // batch's ms is no such sign: a stealth opener re-lists the unit in the
  // ms of its first cast (51-4 0:08 Trueshot beside Moonlight Chakram,
  // 170-1 0:10 Incarnation beside Rake, 117-4 0:11 Shadow Blades beside
  // Shadow Dance)
  // — the SAME aura id: a press's two same-named auras listed together
  // (Incarnation: Avatar of Ashamane 252071 beside 102543 — b38, 50 feral
  // re-listings lost their press) are not a re-statement
  const restated = (i: number) => {
    const ms = own[i]!.logLine.timestamp;
    for (let j = i + 1; j < own.length; j++) {
      const b = own[j]!;
      if (b.logLine.timestamp - ms > RESYNC_BATCH_SPAN_MS) return false;
      if (b.spellId !== own[i]!.spellId) continue;
      if (b.logLine.event === LogEvent.SPELL_AURA_REMOVED) return false;
      if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED) return true;
    }
    return false;
  };
  const heraldProc = (id: string, ms: number) =>
    AVENGING_WRATH_AURA_IDS.has(id) &&
    rows.some(
      (b) =>
        !!b.spellId &&
        HERALD_PROC_BUNDLE_IDS.has(b.spellId) &&
        b.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        b.destUnitId === unit.id &&
        Math.abs(b.logLine.timestamp - ms) <= RESYNC_BATCH_SPAN_MS,
    );
  const out: number[] = [];
  // up until its REMOVED — or, when the log lost the REMOVED, until the
  // aura's official length (+ 1 s) after its last (re)application (codex
  // 21-R12-a #3: an Evasion APPLIED at 10 s with no REMOVED kept `up` true
  // for the round and hid a fresh unseen press at 140 s)
  let upUntilMs = -Infinity;
  // a same-ms REMOVED → APPLIED re-broadcast is the aura staying up, not a
  // new application (codex 62-POSTHOC-13f #1: a second Evasion "press")
  const kept = new Set(dropAuraRebroadcasts(own));
  const lifeMs = (id: string, ms: number) => hiddenAuraLifeMs(id, unit, ms);
  // up to its own REMOVED when the log has one (before another APPLIED of
  // it) — even past the official length (an extended Voidform); the
  // length caps only a run whose REMOVED was lost
  const untilOf = (i: number, ms: number): number => {
    const id = own[i]!.spellId;
    for (let j = i + 1; j < own.length; j++) {
      const b = own[j]!;
      if (b.spellId !== id || !kept.has(b)) continue;
      if (b.logLine.event === LogEvent.SPELL_AURA_REMOVED) return Infinity;
      if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED) break;
    }
    return ms + lifeMs(id!, ms);
  };
  for (const [i, a] of own.entries()) {
    if (!kept.has(a)) continue;
    const ms = a.logLine.timestamp;
    const up = ms <= upUntilMs;
    if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED) upUntilMs = -Infinity;
    else if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (
        !up &&
        batchSize(ms) >= RESYNC_BATCH_MIN_APPLIED &&
        !pressMs.some((p) => Math.abs(p - ms) <= PRESS_ROW_PAIR_MS) &&
        !restated(i) &&
        !heraldProc(a.spellId!, ms)
      )
        out.push(ms);
      upUntilMs = untilOf(i, ms);
    } else upUntilMs = untilOf(i, ms); // a REFRESH / dose row: it is up
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
