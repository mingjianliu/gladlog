/**
 * How a cast bar ended, as far as the log says — the ONE reading of it, for
 * any unit:
 *  - `castCancels.ts`: the log owner's bars (`ownerCastBarOutcomes` — the
 *    cancel ledger of kick-eaten, the timeline's `[CAST STOPPED]` lines);
 *  - `kickAudit.ts`: the bar a kick that interrupted nothing went out at
 *    (JUKED by a fake / hit nothing), and the bar a silencing kick landed on.
 * A leaf module: `castCancels.ts` imports `kickAudit.ts`, so what both read
 * cannot live in either (`castStopEvidence.ts` is the other such leaf). The
 * constants and `castBarStartsOf` moved here with the reading and are
 * re-exported from their first homes.
 *
 * Until 2026-10-11 the kick audit paired a cast start with its end rows
 * itself (same rows, a window of its own: the next start plus the queue
 * tolerance for a SUCCESS and for an interrupt alike), so an interrupt up to
 * 0.4 s into the NEXT bar also ended the bar before it (FT F12).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { NOT_READY_REASONS } from "../analysis/candidates/shared";
import { CANCEL_CC_NEAR_S, forcedStopInstantsMs } from "./castStopEvidence";
import type { CastFailedEvent } from "./rawStreams";

/** Spell-queue tolerance: the next cast's SPELL_CAST_START is often logged
 * before this cast's SUCCESS (client-side queuing), so a SUCCESS may follow
 * the next start by this much and still complete THIS cast. Desktop's
 * `castBars.ts` draws the cast bars with the same number (imported through
 * `kickAudit.ts` — one fact, two readers). */
export const CAST_QUEUE_TOLERANCE_MS = 400;
/** How far back before the kick a cancelled enemy cast still counts as the juke bait.
 * Anchored on the cast-bar cap: an uncompleted cast is over within this long
 * (desktop castBars CAST_BAR_MAX_MS renders the same fact — keep equal). */
export const JUKE_LOOKBACK_MS = 4_000;

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
 * started" behind `ownerCastCancels` (its `hardcasts` and its pairing), CC
 * USE's `cast bar started N×` (context/ccUse.ts) and `castBarOutcomesOf`
 * below.
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
 * How one cast bar ended, as far as the log says:
 *  - `completed`: a SPELL_CAST_SUCCESS of the spell. `queued` = that row came
 *    after the NEXT cast bar had begun, within `CAST_QUEUE_TOLERANCE_MS` (the
 *    client queues the next cast and often logs its start first);
 *  - `kicked`: a SPELL_INTERRUPT of the spell on the unit;
 *  - `stopped`: a SPELL_CAST_FAILED with an interruption reason
 *    (`CAST_INTERRUPTED_REASONS`) and no SPELL_INTERRUPT. `near` = what
 *    happened to the unit within `CANCEL_CC_NEAR_S` of it — a control or
 *    silence aura landed (`cc`), an enemy displacement landed (`displaced`),
 *    the unit died (`death`: dying breaks a cast bar, and the client writes
 *    the same "Interrupted" row for it, 14 ms and 24 ms before the UNIT_DIED
 *    row in the two raw samples of FT I11) — or null. With null the log does
 *    not say why: stopping by hand and moving write the same row;
 *  - `refused`: none of the above, and a SPELL_CAST_FAILED of the spell for
 *    any reason but "not ready" (`row` carries the client's own, localized
 *    text);
 *  - `none`: the log has no row of the spell inside the bar's window. For a
 *    unit that did not record the log this is every bar that neither went
 *    off nor was kicked — SPELL_CAST_FAILED is written for the recorder
 *    alone, so `stopped` and `refused` exist for the recorder only.
 */
export type CastBarEnd =
  | { kind: "completed"; atS: number; queued?: true }
  | { kind: "kicked"; atS: number }
  | {
      kind: "stopped";
      atS: number;
      near: "cc" | "displaced" | "death" | "dodged" | null;
    }
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
 * How each of a unit's cast bars ended.
 *
 * A bar's rows are looked for from its start to the next bar's start or
 * `JUKE_LOOKBACK_MS`, whichever is first (the cast-bar cap). In that window,
 * in this order:
 *  1. a SUCCESS with no interruption row before it → completed;
 *  2. a SPELL_INTERRUPT of the spell on the unit → kicked;
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
 * `failed` = the unit's own SPELL_CAST_FAILED rows, on the clock of
 * `startMs` (`rawStreams.castFailed`); empty for a unit that did not record
 * the log, whose bars then end `completed`, `kicked` or `none`.
 *
 * Known limit, the same for every reader: nothing ties a SUCCESS row to its
 * bar but the window, so the previous cast's SUCCESS logged at or just after
 * this bar's start (a queued chain) reads as this bar's completion — such a
 * bar is `completed` whatever happened to it next.
 *
 * Times are seconds since `startMs`.
 */
export function castBarOutcomesOf(params: {
  unit: Pick<
    ICombatUnit,
    | "castStartEvents"
    | "spellCastEvents"
    | "actionIn"
    | "auraEvents"
    | "damageIn"
    | "deathRecords"
  >;
  startMs: number;
  failed: readonly CastFailedEvent[];
  /** epoch ms of the other side's presses that drop a target
   * (`TARGETED_CC_DODGE_SPELLS`: Shadowmeld, Transcendence: Transfer) —
   * `near` = "dodged" for a stop one of them sits next to */
  dodgeMs?: readonly number[];
}): CastBarOutcome[] {
  const { unit, startMs, failed } = params;
  const dodgeAt = (params.dodgeMs ?? []).map((ms) => (ms - startMs) / 1000);
  const sec = (ms: number) => (ms - startMs) / 1000;
  const capS = JUKE_LOOKBACK_MS / 1000;
  const successes = (unit.spellCastEvents ?? []).filter(
    (e) => e.logLine.event === "SPELL_CAST_SUCCESS",
  );
  const kicks = (unit.actionIn ?? []).filter(
    (a) => a.logLine.event === "SPELL_INTERRUPT",
  );
  // a control / silence aura on the unit, and (F-K10b) landed enemy
  // displacements — the shared stop evidence
  const forced = forcedStopInstantsMs(unit);
  const ccAt = forced.cc.map(sec);
  const displacedAt = forced.displaced.map(sec);
  const diedAt = (unit.deathRecords ?? []).map((d) => sec(d.timestamp));
  const starts = castBarStartsOf(unit, startMs);

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
          near: near(ccAt)
            ? "cc"
            : near(displacedAt)
              ? "displaced"
              : near(diedAt)
                ? "death"
                : // fact4 D52 (a8056a0f r0 0:51): the enemy the bar was on
                  // went into Shadowmeld 1 ms before "Interrupted" — no
                  // stop of the player's
                  near(dodgeAt)
                  ? "dodged"
                  : null,
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
