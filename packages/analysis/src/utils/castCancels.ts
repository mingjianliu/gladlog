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
 * How a cast bar ended is ONE reading, `castBarOutcomesOf`
 * (`castBarOutcomes.ts`; `ownerCastBarOutcomes` below is it for the recorder)
 * — the cancels of this file, the timeline's `[CAST STOPPED]` lines (FT-T16
 * D15 "2b") and the kick audit's juke test (FT F12) all take it. What the
 * cancel ledger counts of it:
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
 *    "被敌方位移(台风等)打断的读条不算骗踢"), nor did the owner die within
 *    it (dying writes the same row — FT I11), and the row is before the
 *    round's end (`isCancelInRound`); any other reason (line of sight,
 *    range, "another action is in progress") is not a cancel.
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

import {
  CAST_INTERRUPTED_REASONS,
  type CastBarEnd,
  type CastBarOutcome,
  castBarOutcomesOf,
  type CastBarStart,
  castBarStartsOf,
} from "./castBarOutcomes";
import {
  CANCEL_CC_NEAR_S,
  DISPLACEMENT_EVIDENCE_IDS,
} from "./castStopEvidence";
import { isPressOfCooldown, talentReplacementsOf } from "./cooldowns";
import { analyzeKickAudit } from "./kickAudit";
import type { RawStreams } from "./rawStreams";
import { roundEndMs } from "./roundEnd";

// The reading of how a cast bar ended, the rows it starts from and the
// interruption reasons live in castBarOutcomes.ts (kickAudit reads them too);
// re-exported for this file's importers.
export { CAST_INTERRUPTED_REASONS, castBarStartsOf };
export type { CastBarEnd, CastBarOutcome, CastBarStart };

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
 * How each of the log owner's cast bars ended: `castBarOutcomesOf` read with
 * the owner's own SPELL_CAST_FAILED rows — the reading behind
 * `ownerCastCancels` (kick-eaten's cancels, the desktop kick dashboard) and
 * the timeline's `[CAST STOPPED]` lines (FT-T16 D15 "2b",
 * `timelineSections/castStopped.ts`). The windows, the order of the end rows
 * and the known limit are stated there.
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
  return castBarOutcomesOf({ unit: owner, startMs, failed });
}

/**
 * Is this bar a cancel of the round: the owner's cast bar the log shows
 * stopped (`stopped`), with nothing that ends a cast happening to them then
 * (`near === null`), before the round's end (`roundEndS`, seconds on the
 * outcome's clock — `roundEndMs`). The ONE test behind the ledger's count
 * and the `[CAST STOPPED]` line that reads "not kicked; no control, silence
 * or knockback landed on you then" (`castStoppedText`): a stop row at or
 * after the round's end is not the player stopping a cast in the round.
 */
export function isCancelInRound(
  o: CastBarOutcome,
  roundEndS: number,
): o is CastBarOutcome & {
  end: { kind: "stopped"; atS: number; near: null };
} {
  return (
    o.end.kind === "stopped" && o.end.near === null && o.end.atS < roundEndS
  );
}

/**
 * The cancel ledger: `ownerCastBarOutcomes` counted, every bar for what that
 * reading says of it.
 *  - a cancel = a `stopped` bar with nothing that ends a cast happening to
 *    the owner then (`near === null`: no control, silence or knockback
 *    landed, and the owner did not die), stopped before the round's end
 *    (`isCancelInRound`). For a control this is the bar whose
 *    `[CAST STOPPED]` line reads "not kicked; no control, silence or
 *    knockback landed on you then" (`CAST_STOPPED_NEAR_TEXT.none`): one
 *    reading, two places. The ledger counts every cast-time spell and its
 *    bars are not clamped to the round's START; the lines exist for controls
 *    begun inside the round — so kick-eaten's `yourCancels` is never below
 *    the number of those lines, and may be above it (gate:
 *    `promptQualityCheck.checkKickEatenCancelsCoverCastStopped`);
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
 * FT I11 (2026-10-11): two stops the player did not choose were cancels.
 * A bar the owner's own death ended (0fe0e2e2: Sleep Walk begun 43.158,
 * "Interrupted" row 43.715, the owner's UNIT_DIED 43.739) — `near` is now
 * `death`. And a bar stopped at or after the round's end (`roundEndMs`: a
 * Solo Shuffle round is over at its first player death, and the log runs on
 * for ~2 s) — f0a10402 round 3: the round-ending death 103.983, the owner's
 * Mind Control begun 104.062 and "Interrupted" 104.602, after the round.
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
  const roundEndS = (roundEndMs(combat) - combat.startTime) / 1000;

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
    } else if (isCancelInRound(s, roundEndS)) {
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
  // out right after one of the cancels above — not any juked kick: for a unit
  // whose SPELL_CAST_FAILED rows it is not handed, kickAudit's juke test only
  // needs a cast start with no end row, which a CC'd or line-of-sight-failed
  // cast also satisfies (codex review 2026-09-26). Handed the rows, it reads
  // the owner's bars exactly as `starts` above does (one reading — a bar this
  // ledger calls stopped is not "completed" there because the same spell
  // went off as an instant right after).
  const baitedKicks: BaitedKick[] = [];
  for (const enemy of enemies)
    for (const k of analyzeKickAudit(enemy, friends, combat, rawStreams)) {
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
