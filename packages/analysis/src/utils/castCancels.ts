/**
 * The log owner's own cancelled hardcasts, and the enemy kicks those
 * cancellations made miss — the "you already fake-cast" contrast next to
 * kick-eaten (user request 2026-09-25: "读条我们能算出来读了多少吗 如果是主人自己
 * 取消的话").
 *
 * Only the player who RECORDED the log has cancellations: SPELL_CAST_FAILED is
 * written for that player alone (verified on the new-season archive — one GUID
 * per file). For anybody else `ownerCastCancels` returns null, never zero.
 *
 * How a cast bar ended is ONE reading, `ownerCastBarOutcomes` below — the
 * cancels of this file and the timeline's `[CAST STOPPED]` lines (FT-T16 D15
 * "2b") both take it. What the cancel ledger counts of it:
 *
 * A hardcast start (castStartEvents) ends with the first of:
 *  - a same-spell SPELL_CAST_SUCCESS within JUKE_LOOKBACK_MS → completed;
 *  - a SPELL_INTERRUPT of that spell on the owner → kicked;
 *  - a SPELL_CAST_FAILED of that spell (raw streams) → cancelled when the
 *    reason is an interruption (CAST_INTERRUPTED_REASONS, every client locale
 *    the corpus shows) and no control or silence aura (ccSpellIds,
 *    officialSilenceIds) landed on the owner within CANCEL_CC_NEAR_S of it,
 *    nor an enemy displacement (`DISPLACEMENT_EVIDENCE_IDS`: a knockback
 *    moves the caster and breaks the bar — user ruling A′17, 2026-09-30:
 *    "被敌方位移(台风等)打断的读条不算骗踢"); any other reason (line of
 *    sight, range, "another action is in progress") is not a cancel.
 * The window for all three is the next start or JUKE_LOOKBACK_MS, whichever is
 * first (`kickAudit`'s cast-bar cap). A bar with none of the three there and
 * a SUCCESS up to `CAST_QUEUE_TOLERANCE_MS` past the next bar's start is
 * completed too (`queued`), and a key pressed again while the bar ran is not
 * its end (`earlierFailure`) — the ledger counts every bar for what
 * `ownerCastBarOutcomes` says of it, with no restriction of its own (see
 * `ownerCastCancels`).
 *
 * `progressPct` = elapsed ÷ the owner's median completed duration of the same
 * spell in the round (haste included, since it is the owner's own cast time)
 * — an ESTIMATE; null without a completed cast to compare with, or above 100 %.
 *
 * A cancel is not proof of a fake cast — moving breaks a cast bar the same way
 * and the log cannot tell the two apart. The fake-cast evidence is
 * `baitedKicks`: enemy kicks the product's kickAudit calls "juked" on this
 * unit (by GUID) that went out while one of the cancels above was being cast
 * or within BAIT_AFTER_CANCEL_S after it stopped, with no other cast started
 * in between — consistent with a working fake, not proof of intent. An
 * unrecognised localized reason makes a cancel invisible, so zero cancels
 * means "none detected", not "none".
 *
 * Corpus (605 files, recorder only, 15,591 hardcasts): completed 66 %,
 * cancelled 17 % (median progress 44 %), kicked 6 %, CC'd 4 %; enemy kicks
 * baited 199 vs landed 953.
 */
import {
  type AtomicArenaCombat,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { NOT_READY_REASONS } from "../analysis/candidates/shared";
import {
  CANCEL_CC_NEAR_S,
  DISPLACEMENT_EVIDENCE_IDS,
  forcedStopInstantsMs,
} from "./castStopEvidence";
import { isPressOfCooldown, talentReplacementsOf } from "./cooldowns";
import {
  analyzeKickAudit,
  CAST_QUEUE_TOLERANCE_MS,
  JUKE_LOOKBACK_MS,
} from "./kickAudit";
import type { CastFailedEvent, RawStreams } from "./rawStreams";

/** SPELL_CAST_FAILED reasons that mean "the cast bar was interrupted" — the
 * client writes them localized. Every entry was observed in the new-season
 * archive (605 files, 2026-09-25): Interrupted 2,781 · 被打断 322 ·
 * Interrumpido 65 · Interrompu 64 · 방해를 받아 취소되었습니다. 34 ·
 * Unterbrochen 30 · 被打斷 9 · Interrompido 9. */
export const CAST_INTERRUPTED_REASONS: ReadonlySet<string> = new Set([
  "Interrupted",
  "被打断",
  "被打斷",
  "Interrumpido",
  "Interrompu",
  "방해를 받아 취소되었습니다.",
  "Unterbrochen",
  "Interrompido",
]);

// CANCEL_CC_NEAR_S, DISPLACEMENT_EVIDENCE_IDS and the instants they are tested
// against live in castStopEvidence.ts (kickAudit's stopped-channel test reads
// them too); re-exported for this file's importers.
export { CANCEL_CC_NEAR_S, DISPLACEMENT_EVIDENCE_IDS };

/** A juked kick counts as baited by a cancel when it went out from this long
 * before the cancel (the same tick) to this long after it. */
export const BAIT_BEFORE_CANCEL_S = 0.3;
export const BAIT_AFTER_CANCEL_S = 1.5;

export interface CastCancel {
  spellId: string;
  spellName: string;
  /** Cast start, seconds since match start. */
  startS: number;
  /** The SPELL_CAST_FAILED, seconds since match start. */
  cancelS: number;
  progressPct: number | null;
}

export interface BaitedKick {
  atSeconds: number;
  kickerName: string;
  kickSpellName: string;
  /** The owner's cancelled cast the kick missed. */
  baitSpellName: string;
}

export interface OwnerCastCancels {
  hardcasts: number;
  cancels: CastCancel[];
  baitedKicks: BaitedKick[];
}

export interface CastBarStart {
  id: string;
  name: string;
  /** Seconds since match start. */
  t: number;
}

/**
 * A unit's cast bars begun, in time order: one per SPELL_CAST_START row the
 * parse kept for it. An instant spell writes none; a bar that was later
 * kicked, stopped or refused is still one. The one reading of "a cast was
 * started" behind `ownerCastCancels` below (its `hardcasts` and its pairing)
 * and CC USE's `cast bar started N×` (context/ccUse.ts).
 */
export function castBarStartsOf(
  unit: Pick<ICombatUnit, "castStartEvents">,
  startMs: number,
): CastBarStart[] {
  return (unit.castStartEvents ?? [])
    .map((e) => ({
      id: e.spellId ?? "",
      name: e.spellName ?? "",
      t: (e.logLine.timestamp - startMs) / 1000,
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * `castBarStartsOf` inside the round, both ends included. A Solo Shuffle
 * round's units keep the lines that follow it (the gap, the next round's
 * preparation), so "this round" has to be asked — the same bound the
 * cooldown ledger puts on its casts. `t` is seconds since the round's start.
 */
export function castBarStartsInRound(
  unit: Pick<ICombatUnit, "castStartEvents">,
  round: { startTime: number; endTime: number },
): CastBarStart[] {
  const durationS = (round.endTime - round.startTime) / 1000;
  return castBarStartsOf(unit, round.startTime).filter(
    (s) => s.t >= 0 && s.t <= durationS,
  );
}

/**
 * The bars among `starts` that are cooldown `cd`'s for this unit: a bar is
 * the cooldown's when its completed cast would have been a press of it
 * (`isPressOfCooldown` — the same id, the canonical id, a talent's pressable
 * replacement, a same-named variant press such as a glyphed Hex). One answer
 * for the kit's `[UNUSED — started N×, never finished]`
 * (context/resourceSnapshot.ts) and CC USE's `cast bar started N×`
 * (context/ccUse.ts), which state the same number for one spell.
 */
export function castBarsOfCooldown(
  starts: readonly CastBarStart[],
  unit: ICombatUnit,
  cd: { spellId: string; spellName: string },
): CastBarStart[] {
  const replacements = talentReplacementsOf(unit);
  return starts.filter((s) =>
    isPressOfCooldown(
      { spellId: s.id, logLine: { event: LogEvent.SPELL_CAST_SUCCESS } },
      cd.spellId,
      cd.spellName,
      replacements,
    ),
  );
}

/**
 * How one cast bar ended, as far as the log says:
 *  - `completed`: a SPELL_CAST_SUCCESS of the spell. `queued` = that row came
 *    after the NEXT cast bar had begun, within `CAST_QUEUE_TOLERANCE_MS` (the
 *    client queues the next cast and often logs its start first);
 *  - `kicked`: a SPELL_INTERRUPT of the spell on the unit;
 *  - `stopped`: a SPELL_CAST_FAILED with an interruption reason
 *    (`CAST_INTERRUPTED_REASONS`) and no SPELL_INTERRUPT. `near` = what landed
 *    on the unit within `CANCEL_CC_NEAR_S` of it — a control or silence aura
 *    (`cc`), an enemy displacement (`displaced`) — or null. With null the log
 *    does not say why: stopping by hand and moving write the same row;
 *  - `refused`: none of the above, and a SPELL_CAST_FAILED of the spell for
 *    any reason but "not ready" (`row` carries the client's own, localized
 *    text);
 *  - `none`: the log has no row of the spell inside the bar's window.
 */
export type CastBarEnd =
  | { kind: "completed"; atS: number; queued?: true }
  | { kind: "kicked"; atS: number }
  | { kind: "stopped"; atS: number; near: "cc" | "displaced" | null }
  | { kind: "refused"; atS: number; row: CastFailedEvent }
  | { kind: "none" };

export interface CastBarOutcome extends CastBarStart {
  end: CastBarEnd;
  /**
   * A SPELL_CAST_FAILED of the spell sits inside the bar BEFORE the row that
   * ended it — a key pressed again while the bar ran ("Not yet recovered"),
   * which is not the bar's end. Both readers take the bar for what its end
   * row says; the flag only records that the earlier row was there.
   */
  earlierFailure: boolean;
}

/**
 * How each of the log owner's cast bars ended — the ONE reading behind
 * `ownerCastCancels` (kick-eaten's cancels, the desktop kick dashboard) and
 * the timeline's `[CAST STOPPED]` lines (FT-T16 D15 "2b",
 * `timelineSections/castStopped.ts`).
 *
 * A bar's rows are looked for from its start to the next bar's start or
 * `JUKE_LOOKBACK_MS`, whichever is first (`kickAudit`'s cast-bar cap). In
 * that window, in this order:
 *  1. a SUCCESS with no interruption row before it → completed;
 *  2. a SPELL_INTERRUPT of the spell on the owner → kicked;
 *  3. an interruption row (`CAST_INTERRUPTED_REASONS`) → stopped;
 *  4. with none of the three: a SUCCESS up to `CAST_QUEUE_TOLERANCE_MS` past
 *     a window the next bar's start closed → completed, `queued` (a queued
 *     completion is never called refused or missing);
 *  5. any other SPELL_CAST_FAILED of the spell → refused — except a press
 *     made while the bar was still running, which did not end it: a "not
 *     ready" one (`NOT_READY_REASONS`, the key pressed again inside the bar's
 *     own global cooldown), and one for a reason this same log shows on a
 *     press before a bar's SUCCESS or interruption row ("Another action is
 *     in progress" — learned from the log's rows, no table of client
 *     strings);
 *  6. else none.
 *
 * Known limit, the same for both readers: nothing ties a SUCCESS row to its
 * bar but the window, so the previous cast's SUCCESS logged at or just after
 * this bar's start (a queued chain) reads as this bar's completion — such a
 * bar is `completed` whatever happened to it next.
 *
 * null when the unit did not record the log (SPELL_CAST_FAILED is written for
 * the recorder alone). Times are seconds since `startMs`, the clock of
 * `rawStreams.castFailed`.
 */
export function ownerCastBarOutcomes(params: {
  owner: ICombatUnit;
  startMs: number;
  rawStreams?: RawStreams;
}): CastBarOutcome[] | null {
  const { owner, startMs, rawStreams } = params;
  if (!rawStreams?.available) return null;
  const failed = rawStreams.castFailed.filter((e) => e.unitGuid === owner.id);
  if (failed.length === 0) return null; // not the recorder
  const sec = (ms: number) => (ms - startMs) / 1000;
  const capS = JUKE_LOOKBACK_MS / 1000;
  const successes = (owner.spellCastEvents ?? []).filter(
    (e) => e.logLine.event === "SPELL_CAST_SUCCESS",
  );
  const kicks = (owner.actionIn ?? []).filter(
    (a) => a.logLine.event === "SPELL_INTERRUPT",
  );
  // a control / silence aura on the owner, and (F-K10b) landed enemy
  // displacements — the shared stop evidence
  const forced = forcedStopInstantsMs(owner);
  const ccAt = forced.cc.map(sec);
  const displacedAt = forced.displaced.map(sec);
  const starts = castBarStartsOf(owner, startMs);

  // Reasons the client gave, IN THIS LOG, for a press made while a cast bar
  // was demonstrably still running: a failure row of the spell before the
  // bar's SUCCESS or before its interruption row ("Another action is in
  // progress" 19 ms after the start — 0068182d round 3, a key pressed twice).
  // Such a row is not what ended a bar; read off the log's own rows, in
  // whatever language the client writes.
  const busyReasons = new Set<string>();
  const stillRunningAt = (rows: readonly CastFailedEvent[]) => {
    for (const e of rows) busyReasons.add(e.reason.trim());
  };
  const undecided = new Map<number, CastFailedEvent[]>();
  const outcomes = starts.map((s, i): CastBarOutcome => {
    const nextS = starts[i + 1]?.t ?? Infinity;
    const endS = Math.min(s.t + capS, nextS);
    // Same window for all three endings (codex review 2026-09-26: a success
    // looked up past the next start was paired with two starts at once).
    const done = successes.find(
      (e) =>
        e.spellId === s.id &&
        sec(e.logLine.timestamp) >= s.t &&
        sec(e.logLine.timestamp) <= endS,
    );
    const fails = failed.filter(
      (e) =>
        String(e.spellId) === s.id && e.tSeconds > s.t && e.tSeconds <= endS,
    );
    const first = fails[0];
    const barFail = fails.find((e) =>
      CAST_INTERRUPTED_REASONS.has(e.reason.trim()),
    );
    if (done && (!barFail || sec(done.logLine.timestamp) <= barFail.tSeconds)) {
      const atS = sec(done.logLine.timestamp);
      stillRunningAt(fails.filter((e) => e.tSeconds < atS));
      return {
        ...s,
        end: { kind: "completed", atS },
        earlierFailure: !!first && first.tSeconds < atS,
      };
    }
    const kick = kicks.find(
      (a) =>
        (a as { extraSpellId?: string }).extraSpellId === s.id &&
        sec(a.timestamp) >= s.t &&
        sec(a.timestamp) <= endS,
    );
    if (kick)
      return {
        ...s,
        end: { kind: "kicked", atS: sec(kick.timestamp) },
        earlierFailure: false,
      };
    if (barFail) {
      const near = (ts: number[]) =>
        ts.some((t) => Math.abs(t - barFail.tSeconds) <= CANCEL_CC_NEAR_S);
      stillRunningAt(fails.slice(0, fails.indexOf(barFail)));
      return {
        ...s,
        end: {
          kind: "stopped",
          atS: barFail.tSeconds,
          near: near(ccAt) ? "cc" : near(displacedAt) ? "displaced" : null,
        },
        earlierFailure: first !== barFail,
      };
    }
    const queued =
      nextS < s.t + capS
        ? successes.find(
            (e) =>
              e.spellId === s.id &&
              sec(e.logLine.timestamp) > endS &&
              sec(e.logLine.timestamp) <=
                Math.min(s.t + capS, nextS + CAST_QUEUE_TOLERANCE_MS / 1000),
          )
        : undefined;
    if (queued) {
      stillRunningAt(fails);
      return {
        ...s,
        end: {
          kind: "completed",
          atS: sec(queued.logLine.timestamp),
          queued: true,
        },
        earlierFailure: fails.length > 0,
      };
    }
    // refused or none: decided below, once every bar's rows have been read
    undecided.set(i, fails);
    return { ...s, end: { kind: "none" }, earlierFailure: fails.length > 0 };
  });
  for (const [i, fails] of undecided) {
    const refusal = fails.find((e) => {
      const reason = e.reason.trim();
      return !NOT_READY_REASONS.has(reason) && !busyReasons.has(reason);
    });
    if (refusal)
      outcomes[i] = {
        ...outcomes[i]!,
        end: { kind: "refused", atS: refusal.tSeconds, row: refusal },
        earlierFailure: fails[0] !== refusal,
      };
  }
  return outcomes;
}

/**
 * The cancel ledger: `ownerCastBarOutcomes` counted, every bar for what that
 * reading says of it.
 *  - a cancel = a `stopped` bar with nothing landing on the owner
 *    (`near === null`). For a control this is the bar whose `[CAST STOPPED]`
 *    line reads "not kicked; no control, silence or knockback landed on you
 *    then" (`CAST_STOPPED_NEAR_TEXT.none`): one reading, two places. The
 *    ledger counts every cast-time spell and is not clamped to the round; the
 *    lines exist for controls begun inside the round — so kick-eaten's
 *    `yourCancels` is never below the number of those lines, and may be above
 *    it (gate: `promptQualityCheck.checkKickEatenCancelsCoverCastStopped`);
 *  - the median completed bar behind `progressPct` = every `completed` bar
 *    of the spell longer than 0.2 s, a `queued` completion included;
 *  - a baited kick = a kickAudit "juked" kick on the owner that went out into
 *    one of those cancels.
 *
 * Until 2026-10-11 the ledger left two kinds of bar out of the shared reading
 * (its 2026-09-26 code, kept when `[CAST STOPPED]` arrived so that no
 * kick-eaten fact moved): a bar with a SPELL_CAST_FAILED of the spell before
 * its end row (`earlierFailure`) was neither a cancel nor a completed
 * duration, and a `queued` completion was no completed duration. A bar stopped
 * after a repeated key press then had a `[CAST STOPPED]` line and was missing
 * from `yourCancels`. Both are counted now (user decision 2026-10-11).
 * Measured on the 605-match capture: 126 of 1,869 kick-eaten rows change a
 * cast-control fact (`yourCancels`, `yourCancelMedianPct`, `baitedKicks`,
 * `baitedThisKickerT`, `stoppedJustBefore`); no row added or removed, no
 * context line changed.
 *
 * null when the unit did not record the log — never zero.
 */
export function ownerCastCancels(params: {
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  combat: AtomicArenaCombat;
  rawStreams?: RawStreams;
}): OwnerCastCancels | null {
  const { owner, friends, enemies, combat, rawStreams } = params;
  const starts = ownerCastBarOutcomes({
    owner,
    startMs: combat.startTime,
    rawStreams,
  });
  if (!starts) return null;

  const completedDurations = new Map<string, number[]>();
  const pending: Array<{ id: string; name: string; t: number; failS: number }> =
    [];
  for (const s of starts) {
    if (s.end.kind === "completed") {
      const d = s.end.atS - s.t;
      if (d > 0.2) {
        const list = completedDurations.get(s.id) ?? [];
        list.push(d);
        completedDurations.set(s.id, list);
      }
    } else if (s.end.kind === "stopped" && s.end.near === null) {
      pending.push({ id: s.id, name: s.name, t: s.t, failS: s.end.atS });
    }
  }
  const median = (id: string) => {
    const d = [...(completedDurations.get(id) ?? [])].sort((a, b) => a - b);
    return d.length ? d[Math.floor(d.length / 2)]! : null;
  };
  const cancels: CastCancel[] = pending.map((p) => {
    const m = median(p.id);
    const pct = m ? Math.round(((p.failS - p.t) / m) * 100) : null;
    return {
      spellId: p.id,
      spellName: p.name,
      startS: p.t,
      cancelS: p.failS,
      // An estimate against the round's median bar; above 100 % it is
      // measuring bar-length variance, not this cast (seen: 152 %) — omitted,
      // never clamped (codex review 2026-09-26).
      progressPct: pct !== null && pct <= 100 ? pct : null,
    };
  });

  // A baited kick is a kickAudit "juked" kick on THIS unit (by GUID) that went
  // out right after one of the cancels above — not any juked kick: kickAudit's
  // own juke test only needs an uncompleted cast start, which a CC'd or
  // line-of-sight-failed cast also satisfies (codex review 2026-09-26).
  const baitedKicks: BaitedKick[] = [];
  for (const enemy of enemies)
    for (const k of analyzeKickAudit(enemy, friends, combat)) {
      if (k.result !== "juked" || k.targetId !== owner.id) continue;
      // The same cast instance: it started before the kick, was stopped
      // around it, and no other cast of the owner started in between (else
      // the kick was aimed at that one).
      const bait = cancels.find(
        (c) =>
          c.startS <= k.atSeconds &&
          k.atSeconds >= c.cancelS - BAIT_BEFORE_CANCEL_S &&
          k.atSeconds <= c.cancelS + BAIT_AFTER_CANCEL_S &&
          !starts.some(
            (s) =>
              s.t > Math.min(c.startS, k.atSeconds) &&
              s.t <= k.atSeconds &&
              s.t !== c.startS,
          ),
      );
      if (!bait) continue;
      baitedKicks.push({
        atSeconds: k.atSeconds,
        kickerName: enemy.name,
        kickSpellName: k.kickSpellName,
        baitSpellName: bait.spellName,
      });
    }
  baitedKicks.sort((a, b) => a.atSeconds - b.atSeconds);
  return { hardcasts: starts.length, cancels, baitedKicks };
}
