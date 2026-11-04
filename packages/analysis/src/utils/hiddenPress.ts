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
import { FORM_COOLDOWN_BUFF_BY_CAST_ID } from "../data/druidForms";
import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
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

/** A summon that brings a press's own aura with it, by summon spell → the
 * aura ids: Blessing of the Forge 434132 ("Avenging Wrath summons an
 * additional Sacred Weapon", talent 433011) puts Sacred Weapon 432502 on the
 * paladin and an ally in the Avenging Crusader's own millisecond, inside its
 * bundle of APPLIED rows — the talent's weapon, no Holy Armaments press and
 * no charge spent (fact10 D7, 070c4933 0:39.94 / 1:59.55: SPELL_SUMMON 434132
 * beside both, the presses alternate Holy Bulwark / Sacred Weapon around
 * them). */
/** An aura that only the press of a cooldown with no aura of its own puts
 * up, by cooldown id: Freezing Rain 270232 (talent 270233, an aura-42 proc,
 * "Frozen Orb makes Blizzard instant cast") on Frozen Orb 84714 / 198149.
 * New in a re-stating batch with no orb row, it is the orb pressed unseen
 * (fact10 D23, 733ef717 0:09.8: Greater Invisibility from 0:03.3, Freezing
 * Rain re-stated new at 0:09.816 and the orb's damage from 0:10.3; cover
 * set: 152 of 178 own Freezing Rain APPLIED rows within 200 ms of an own
 * 84714 SUCCESS, and every new one in a batch without an orb row came out
 * of an invisibility). */
export const PRESS_PROOF_AURA_IDS: ReadonlyMap<string, readonly string[]> =
  new Map([
    ["84714", ["270232"]],
    ["198149", ["270232"]],
  ]);

/** The cooldowns whose press `PRESS_PROOF_AURA_IDS` says this aura proves. */
function pressesProvenBy(auraId: string): string[] {
  return [...PRESS_PROOF_AURA_IDS]
    .filter(([, auras]) => auras.includes(auraId))
    .map(([cd]) => cd);
}

export const SUMMON_BORNE_AURA_IDS: ReadonlyMap<string, readonly string[]> =
  new Map([["434132", ["432502"]]]);

/** A press row this close to the aura is the aura's own press, not a lost
 * one. */
const PRESS_ROW_PAIR_MS = 1000;

const HIDDEN_AURA_LIFE_SLACK_MS = 1000;

/** A talent lengthens a run, not without end: an APPLIED re-lists the run under
 * way only this many of its lives (`hiddenAuraLifeMs`) after the run's last
 * row. The re-listings on the 605 raw logs reach 1.7 (Recklessness 21.7 s after
 * its APPLIED, 12 s + 1; Combustion 15.3 s, Malevolence 28.3 s, Arcane Surge
 * 17.0 s). */
const RELISTED_RUN_MAX_LIVES = 2;

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
  return typeof d === "number" && d > 0
    ? d * 1000 + HIDDEN_AURA_LIFE_SLACK_MS
    : Infinity;
}

/** A same-named id that is a press of its own — the form variants of one
 * button (Stampeding Roar 106898 / bear 77761 / cat 77764: each an 8 s aura
 * with the 120 s cooldown in DB2). The ledger's variant-press rule
 * (`isPressOfCooldown` → `isVariantPress`) read off the official cooldown;
 * fact5 D25 (8d0ed9e9 r0 0:12): the cat-form roar pressed unseen came back
 * as 77764 and the kit printed `[UNUSED]`. */
function isPressVariantOf(id: string, spellId: string): boolean {
  if (id === spellId) return false;
  const name = getEnglishSpellName(spellId, "");
  return (
    name !== "" &&
    getEnglishSpellName(id, "") === name &&
    (spellEffectData[id]?.cooldownSeconds ?? 0) > 0
  );
}

/**
 * Is `ms` inside a batch that re-states `unit` after it was unseen —
 * `RESYNC_BATCH_MIN_APPLIED` APPLIED rows on it within
 * `RESYNC_BATCH_SPAN_MS`? An aura row in it is when the log showed the aura
 * again, not when it went up — `hiddenPressMs`' batch reading (codex
 * 20-F19-07: one helper, 0 disagreements with the inline count over 42,510
 * batch evaluations).
 */
export function isResyncBatchAt(
  unit: Pick<ICombatUnit, "id" | "auraEvents">,
  ms: number,
): boolean {
  const rows = unit.auraEvents;
  if (!rows || rows.length < RESYNC_BATCH_MIN_APPLIED) return false;
  // a non-finite instant never satisfies |t − ms| <= span (codex 20-F24-17
  // #1): the index holds the finite rows only
  if (!Number.isFinite(ms)) return false;
  const at = appliedOnSelfMs(rows, unit.id);
  // the index only narrows the rows; each is still read by the scan's own
  // test, so float edges (|0.2 − 5.2| is 5, 5.2 − 5 is not 0.2 — codex
  // 20-F24-17 #3) stay where they were. The 1 ms slack covers them.
  const hi = upperBound(at, ms + RESYNC_BATCH_SPAN_MS + 1);
  let n = 0;
  for (let i = lowerBound(at, ms - RESYNC_BATCH_SPAN_MS - 1); i < hi; i++)
    if (
      Math.abs(at[i]! - ms) <= RESYNC_BATCH_SPAN_MS &&
      ++n >= RESYNC_BATCH_MIN_APPLIED
    )
      return true;
  return false;
}

/** Performance only (the 2026-11-03 first-paint regression: a scan of the
 * whole stream per call made the aura-interval build quadratic — ×12 report
 * fixture, `isResyncBatchAt` 65 → 1,561 ms): the sorted instants of the
 * APPLIED rows on the holder itself (finite ones: no other row can count),
 * cached per stream array and holder.
 * Rebuilt when the array's length changes; a stream is never edited in
 * place at the same length. `test/restatedIndex.test.ts` holds it
 * to the plain scan. */
const appliedOnSelfCache = new WeakMap<
  object,
  { len: number; byId: Map<string, number[]> }
>();
function appliedOnSelfMs(
  rows: NonNullable<ICombatUnit["auraEvents"]>,
  unitId: string,
): number[] {
  let entry = appliedOnSelfCache.get(rows);
  if (!entry || entry.len !== rows.length) {
    entry = { len: rows.length, byId: new Map() };
    appliedOnSelfCache.set(rows, entry);
  }
  let at = entry.byId.get(unitId);
  if (!at) {
    at = [];
    for (const a of rows)
      if (
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        a.destUnitId === unitId &&
        Number.isFinite(a.logLine.timestamp)
      )
        at.push(a.logLine.timestamp);
    at.sort((x, y) => x - y);
    entry.byId.set(unitId, at);
  }
  return at;
}

/** first index whose value is >= x (sorted ascending) */
export function lowerBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** first index whose value is > x (sorted ascending) */
export function upperBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
  unit: Pick<ICombatUnit, "id" | "auraEvents" | "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "actionOut">>,
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
    ...(PRESS_PROOF_AURA_IDS.get(spellId) ?? []),
  ]);
  const own = rows.filter(
    (a) =>
      !!a.spellId &&
      (auraIds.has(a.spellId) || isPressVariantOf(a.spellId, spellId)) &&
      a.destUnitId === unit.id &&
      a.srcUnitId === unit.id,
  );
  if (own.length === 0) return [];
  const pressMs = (unit.spellCastEvents ?? [])
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        (e.spellId === spellId || isPressVariantOf(e.spellId, spellId)),
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
  const summonBorne = (id: string, ms: number) =>
    (unit.actionOut ?? []).some(
      (b) =>
        b.logLine.event === LogEvent.SPELL_SUMMON &&
        b.srcUnitId === unit.id &&
        !!b.spellId &&
        (SUMMON_BORNE_AURA_IDS.get(b.spellId) ?? []).includes(id) &&
        Math.abs(b.logLine.timestamp - ms) <= RESYNC_BATCH_SPAN_MS,
    );
  const out: number[] = [];
  // up until its REMOVED — or, when the log lost the REMOVED, until the
  // aura's official length (+ 1 s) after its last (re)application (codex
  // 21-R12-a #3: an Evasion APPLIED at 10 s with no REMOVED kept `up` true
  // for the round and hid a fresh unseen press at 140 s)
  // Per aura id: a press's same-named auras end on their own (fact7 D34 /
  // D41: Prowl removes Incarnation's 252071 while its 102543 runs on, and the
  // batch that re-states the druid re-lists 102543 — one clock for both read
  // that as a third press). The press is up while any of them is.
  const upUntilMs = new Map<string, number>();
  const anyUpAt = (ms: number) =>
    [...upUntilMs.values()].some((until) => ms <= until);
  // a same-ms REMOVED → APPLIED re-broadcast is the aura staying up, not a
  // new application (codex 62-POSTHOC-13f #1: a second Evasion "press")
  const kept = new Set(dropAuraRebroadcasts(own));
  const lifeMs = (id: string, ms: number) => hiddenAuraLifeMs(id, unit, ms);
  // up to its own REMOVED when the log has one (before another APPLIED of
  // it) — even past the official length (an extended Voidform); the
  // length caps only a run whose REMOVED was lost
  // An APPLIED with no REMOVED before it whose own REMOVED comes sooner than a
  // press would have run is a re-listing of the run under way, which a talent
  // had taken past the official length (d510865c r5: Arcane Surge APPLIED
  // 122.2 s, re-listed 139.2 s, REMOVED 139.6 s; 15 facts on the 605 capture,
  // Combustion, Recklessness, Malevolence, each 11–22 s after its press).
  // Past RELISTED_RUN_MAX_LIVES of the run's last row it is a new press first
  // seen late, whatever its own REMOVED says (codex 04-1).
  const relisting = (i: number, j: number): boolean => {
    const at = own[j]!.logLine.timestamp;
    const id = own[j]!.spellId!;
    const runAt = own[i]!.logLine.timestamp;
    if (at - runAt > RELISTED_RUN_MAX_LIVES * lifeMs(id, runAt)) return false;
    for (let k = j + 1; k < own.length; k++) {
      const b = own[k]!;
      if (b.spellId !== id || !kept.has(b)) continue;
      if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED) return false;
      if (b.logLine.event === LogEvent.SPELL_AURA_REMOVED)
        return (
          b.logLine.timestamp - at < lifeMs(id, at) - HIDDEN_AURA_LIFE_SLACK_MS
        );
    }
    return false;
  };
  const untilOf = (i: number, ms: number): number => {
    const id = own[i]!.spellId;
    for (let j = i + 1; j < own.length; j++) {
      const b = own[j]!;
      if (b.spellId !== id || !kept.has(b)) continue;
      if (b.logLine.event === LogEvent.SPELL_AURA_REMOVED) return Infinity;
      if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED && !relisting(i, j))
        break;
    }
    return ms + lifeMs(id!, ms);
  };
  // a form cooldown's buff still up from an earlier press makes the form
  // aura's re-listing a shift back, not a press (`isFormReshiftCast`'s
  // reading, for a cast the log lost): wide 36-22 2:20, a Tree of Life buff
  // 117679 pressed at 2:03 and re-listed with the form at 2:20 read as a
  // third press 17 s into its own 30 s buff. Up to its REMOVED, or its
  // official length when the log lost that.
  const formBuffId = FORM_COOLDOWN_BUFF_BY_CAST_ID[spellId];
  const formBuffUpBefore = (ms: number): boolean => {
    if (formBuffId === undefined) return false;
    let upUntil = -Infinity;
    for (const b of unit.auraEvents ?? []) {
      const at = b.logLine.timestamp;
      if (at >= ms - RESYNC_BATCH_SPAN_MS) break;
      if (b.spellId !== formBuffId || b.destUnitId !== unit.id) continue;
      const ev = b.logLine.event;
      if (ev === LogEvent.SPELL_AURA_REMOVED) upUntil = -Infinity;
      else if (
        ev === LogEvent.SPELL_AURA_APPLIED ||
        ev === LogEvent.SPELL_AURA_REFRESH
      )
        upUntil = at + hiddenAuraLifeMs(formBuffId, unit, at);
    }
    return ms <= upUntil;
  };
  for (const [i, a] of own.entries()) {
    if (!kept.has(a)) continue;
    const ms = a.logLine.timestamp;
    const up = anyUpAt(ms);
    if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED)
      upUntilMs.delete(a.spellId!);
    else if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (
        !up &&
        isResyncBatchAt({ id: unit.id, auraEvents: rows }, ms) &&
        !pressMs.some((p) => Math.abs(p - ms) <= PRESS_ROW_PAIR_MS) &&
        !restated(i) &&
        !heraldProc(a.spellId!, ms) &&
        !summonBorne(a.spellId!, ms) &&
        !formBuffUpBefore(ms)
      )
        out.push(ms);
      upUntilMs.set(a.spellId!, untilOf(i, ms));
    } else upUntilMs.set(a.spellId!, untilOf(i, ms)); // a REFRESH / dose row: it is up
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
    for (const id of [
      a.spellId,
      ...castsOwningEffectAura(a.spellId),
      ...pressesProvenBy(a.spellId),
    ])
      if (keep(id)) out.add(id);
  }
  return out;
}
