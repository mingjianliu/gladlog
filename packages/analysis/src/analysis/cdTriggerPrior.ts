/**
 * cdTriggerPrior — "when does this healer cohort spend this save cooldown",
 * the engine behind the `[CD PRIOR]` context fact (GH #54 (f) / BACKLOG #38
 * (a)(h); user ruling 2026-09-04: option 1, a context fact, NOT a candidate
 * and NOT a hard threshold).
 *
 * Two exports, ONE HP predicate between them:
 *
 *  - `cdTriggerObservations(owner, combat)` — the corpus-scan side. Every
 *    press of one of the owner's spendable save cooldowns
 *    (`isSpendableDefensiveCd`, the same roster `cd-hoarded` accuses over),
 *    with the LOWEST alive friendly's `gridHpPct` at the press's rendered
 *    second. `packages/eval/scripts/cdTriggerPriorScan.ts` aggregates these
 *    into the per-(spec|heroTree|spellId) medians in
 *    `data/cdTriggerPriorGenerated.json`.
 *
 *  - `cdPriorHoldEpisodes(owner, combat, refOf)` — the product side. Moments
 *    where the lowest friendly fell THROUGH a ready cooldown's cohort median
 *    and the owner held the cooldown for the whole dip. Rendered by
 *    `context/cdPrior.ts`.
 *
 * Both walk the same `lowestFriendlyGridHp` series — the `[STATE]` tick's
 * sampler (`gridHpPct`) and death predicate (`isDeadAtRenderSecond`) at whole
 * rendered seconds — so a median measured on the corpus and a dip quoted in a
 * prompt are readings of one instrument (CLAUDE.md shared-predicate rule).
 *
 * The study this mirrors (eval-private healer-study `seq.py::cd_ladder`,
 * 2026-08-23): a press counts as "given while somebody needed it" only when
 * the lowest friendly was below `CD_TRIGGER_NEEDED_HP_PCT` (its `LADDER_HP`),
 * and a re-press of the same spell inside `CD_TRIGGER_DEDUPE_S` is one event.
 *
 * Deliberate partition with the crisis machinery: an episode whose minimum
 * reaches `CRISIS_HP_PCT_RENDERED` (40%) is `crisisDecisionPoints`' territory
 * — `cd-hoarded` already judges it — so this engine drops it rather than
 * saying the same thing twice. `[CD PRIOR]` lives in the band between the
 * cohort's median and the crisis line.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";

import type { CdTriggerPriorRef } from "../data/cdTriggerPrior";
import { buildCannotCastIntervals } from "../utils/cannotCastIntervals";
import {
  canHelpAnotherUnit,
  cdAvailableAt,
  extractMajorCooldowns,
  gridHpPct,
  type IMajorCooldownInfo,
  isDeadAtRenderSecond,
  SELF_CAST_NOOP_EXTERNAL_IDS,
} from "../utils/cooldowns";
import {
  isSpendableDefensiveCd,
  type SpendableDefensiveCd,
} from "./candidates/cooldownTiming";
import {
  CRISIS_HP_PCT_RENDERED,
  CRISIS_WINDOW_GAP_MS,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
} from "./crisisDecisionPoints";

/**
 * Persistence door: the dip must stay at or below the cohort median for at
 * least this many rendered seconds **during which the owner could cast**
 * (not dead, not inside a `buildCannotCastIntervals` interval — hard CC,
 * silence, school lockout). The length is `RESPONSE_WINDOW_MS`, the
 * user-ruled 3 s (2026-08-29) the crisis machinery gives a player to react,
 * imported rather than a new number.
 *
 * Measured on 120 archive files (2026-09-04, 250 episodes before any door):
 * 54% of dips lasted a single rendered second and 37% bottomed out under
 * 3 pp below the median — a one-tick 49% against a 51% line is not a held
 * cooldown, it is sampling noise. With the raw 3 s door 33/250 remained; the
 * first real excerpt then showed an owner Storm-Bolted for the whole window
 * at the crossing second and still "ready and unspent", hence "castable
 * seconds", not elapsed seconds.
 */
export const CD_PRIOR_MIN_PERSIST_S = RESPONSE_WINDOW_MS / 1000;

/** A press only counts as "spent while somebody needed it" below this
 * lowest-friendly HP — the study's `LADDER_HP = 0.75`, rendered integer. */
export const CD_TRIGGER_NEEDED_HP_PCT = 75;
/** A re-press of the same spell inside this many seconds is the same event
 * (double-charge Pain Suppression, re-cast after a dispel) — study value. */
export const CD_TRIGGER_DEDUPE_S = 30;

export interface CdTriggerObservation {
  spellId: string;
  spellName: string;
  /** rendered second of the press (`Math.floor(cast.timeSeconds)`) */
  tSec: number;
  /** lowest alive friendly's `gridHpPct` at `tSec` — the number the [STATE]
   * tick prints for that unit at that second */
  lowestFriendlyHpPct: number;
  lowestFriendlyName: string;
}

export interface CdPriorHoldEpisode {
  spellId: string;
  spellName: string;
  /** rendered second the lowest friendly crossed below the cohort median */
  tSec: number;
  /** that friendly's `gridHpPct` at `tSec` */
  hpAtCrossPct: number;
  /** the deepest lowest-friendly reading before HP came back above the
   * median (or the round ended) */
  minHpPct: number;
  minSec: number;
  /** last rendered second still at or below the median — `endSec - tSec`
   * is how long the dip persisted */
  endSec: number;
  /** rendered seconds inside [tSec, endSec] the owner could NOT cast in
   * (dead / hard CC / silence / lockout, `buildCannotCastIntervals`) —
   * rendered on the line so a stun at the crossing is not hidden behind
   * "ready and unspent" */
  ownerLockedSecs: number;
  /** the friendly at the minimum (may differ from the one that crossed) */
  minUnitName: string;
  /** whether that friendly is the owner */
  minUnitIsOwner: boolean;
  ref: CdTriggerPriorRef;
}

type UnitLike = {
  id: string;
  name: string;
  reaction?: CombatUnitReaction;
  info?: unknown;
};

/** The lowest alive friendly's rendered HP at one whole second, or null when
 * no friendly has a reading there (`gridHpPct` null / 0 = corpse). */
export function lowestFriendlyGridHp(
  friends: UnitLike[],
  matchStartMs: number,
  sec: number,
): { hpPct: number; unit: UnitLike } | null {
  let best: { hpPct: number; unit: UnitLike } | null = null;
  const tMs = matchStartMs + sec * 1000;
  for (const f of friends) {
    if (isDeadAtRenderSecond(f as any, matchStartMs, sec)) continue;
    const hp = gridHpPct(f as any, tMs);
    if (hp === null || hp <= 0) continue;
    if (!best || hp < best.hpPct) best = { hpPct: hp, unit: f };
  }
  return best;
}

function friendliesOf(combat: any, owner: UnitLike): UnitLike[] {
  const reaction = owner.reaction ?? CombatUnitReaction.Friendly;
  return (Object.values(combat.units ?? {}) as UnitLike[]).filter(
    (u) => u.info && u.reaction === reaction,
  );
}

function spendableCds(owner: any, combat: any): SpendableDefensiveCd[] {
  let cds: IMajorCooldownInfo[] = [];
  try {
    cds = extractMajorCooldowns(owner, combat);
  } catch {
    return [];
  }
  return cds.filter((cd) => isSpendableDefensiveCd(cd));
}

/** Test seam shared by both exports: hand-built cooldowns instead of
 * `extractMajorCooldowns` (still filtered through `isSpendableDefensiveCd`,
 * so a test cannot smuggle a non-roster spell past the predicate). */
export interface CdTriggerPriorOverrides {
  cds?: Array<IMajorCooldownInfo | SpendableDefensiveCd>;
}

function rosterOf(
  owner: any,
  combat: any,
  overrides?: CdTriggerPriorOverrides,
): SpendableDefensiveCd[] {
  if (overrides?.cds) return overrides.cds.filter((cd) => isSpendableDefensiveCd(cd));
  return spendableCds(owner, combat);
}

/** Scan side — see the module comment. */
export function cdTriggerObservations(
  owner: any,
  combat: any,
  overrides?: CdTriggerPriorOverrides,
): CdTriggerObservation[] {
  const startMs: number = combat.startTime;
  const friends = friendliesOf(combat, owner);
  const out: CdTriggerObservation[] = [];
  for (const cd of rosterOf(owner, combat, overrides)) {
    let lastKeptSec = -Infinity;
    const casts = [...cd.casts].sort((a, b) => a.timeSeconds - b.timeSeconds);
    for (const c of casts) {
      const tSec = Math.floor(c.timeSeconds);
      if (tSec < 0) continue;
      if (tSec - lastKeptSec < CD_TRIGGER_DEDUPE_S) continue;
      const low = lowestFriendlyGridHp(friends, startMs, tSec);
      if (!low) continue;
      if (low.hpPct >= CD_TRIGGER_NEEDED_HP_PCT) continue;
      lastKeptSec = tSec;
      out.push({
        spellId: cd.spellId,
        spellName: cd.spellName,
        tSec,
        lowestFriendlyHpPct: low.hpPct,
        lowestFriendlyName: low.unit.name,
      });
    }
  }
  return out;
}

/**
 * Product side — see the module comment. `refOf` is the cohort lookup
 * (`lookupCdTriggerPrior` partially applied with the owner's spec and hero
 * tree); a cooldown with no reference is simply not walked.
 *
 * Feasibility at the crossing second, in the same spirit as `cd-hoarded`'s
 * gates: the owner is alive, is not inside a cannot-cast interval (hard CC /
 * silence / school lockout — `buildCannotCastIntervals`, the healing-gap
 * and dispel gate's builder), the cooldown is READY (`cdAvailableAt`) and
 * can reach the unit that dipped (`canHelpAnotherUnit` for a teammate,
 * `!SELF_CAST_NOOP_EXTERNAL_IDS` for the owner's own dip). "Held" = no press
 * of that cooldown from `RESPONSE_PRE_MS` before the crossing to the end of
 * the dip.
 */
export function cdPriorHoldEpisodes(
  owner: any,
  combat: any,
  refOf: (spellId: string) => CdTriggerPriorRef | null,
  overrides?: CdTriggerPriorOverrides,
): CdPriorHoldEpisode[] {
  const startMs: number = combat.startTime;
  const endMs: number = combat.endTime;
  const lastSec = Math.floor((endMs - startMs) / 1000);
  const friends = friendliesOf(combat, owner);
  const cds = rosterOf(owner, combat, overrides)
    .map((cd) => ({ cd, ref: refOf(cd.spellId) }))
    .filter(
      (x): x is { cd: SpendableDefensiveCd; ref: CdTriggerPriorRef } =>
        x.ref !== null,
    );
  if (cds.length === 0 || lastSec <= 0) return [];

  const enemyIds = new Set(
    (Object.values(combat.units ?? {}) as UnitLike[])
      .filter((u) => u.reaction !== (owner.reaction ?? CombatUnitReaction.Friendly))
      .map((u) => u.id),
  );
  let cannotCast: Array<{ from: number; to: number }> = [];
  try {
    cannotCast = buildCannotCastIntervals(owner, enemyIds);
  } catch {
    cannotCast = [];
  }
  const ownerCannotCastAt = (sec: number): boolean => {
    const tMs = startMs + sec * 1000;
    return cannotCast.some((iv) => iv.from <= tMs && tMs < iv.to);
  };
  const ownerCanActAt = (sec: number): boolean =>
    !isDeadAtRenderSecond(owner, startMs, sec) && !ownerCannotCastAt(sec);

  // One series, walked once per cooldown.
  const series: Array<{ hpPct: number; unit: UnitLike } | null> = [];
  for (let s = 0; s <= lastSec; s++)
    series.push(lowestFriendlyGridHp(friends, startMs, s));

  const out: CdPriorHoldEpisode[] = [];
  for (const { cd, ref } of cds) {
    const line = ref.medianHpPct;
    let lastEpisodeEndSec = -Infinity;
    for (let s = 1; s <= lastSec; s++) {
      const prev = series[s - 1];
      const cur = series[s];
      if (!prev || !cur) continue;
      if (!(prev.hpPct > line && cur.hpPct <= line)) continue;
      // Walk the dip: until HP is back above the line or the round ends.
      let e = s;
      let min = cur;
      let minSec = s;
      while (e + 1 <= lastSec) {
        const nx = series[e + 1];
        if (!nx || nx.hpPct > line) break;
        e++;
        if (nx.hpPct < min.hpPct) {
          min = nx;
          minSec = e;
        }
      }
      const episodeEndSec = e;
      const skipTo = () => {
        s = episodeEndSec; // the for-loop's s++ resumes after the dip
      };
      // Same-cooldown dips closer than the crisis merge gap are one event.
      if ((s - lastEpisodeEndSec) * 1000 < CRISIS_WINDOW_GAP_MS) {
        lastEpisodeEndSec = episodeEndSec;
        skipTo();
        continue;
      }
      lastEpisodeEndSec = episodeEndSec;
      // Crisis territory belongs to crisisDecisionPoints / cd-hoarded.
      if (min.hpPct <= CRISIS_HP_PCT_RENDERED) {
        skipTo();
        continue;
      }
      // Persistence + feasibility door — see CD_PRIOR_MIN_PERSIST_S: at
      // least that many seconds of the dip (crossing second included) must
      // be seconds the owner could have pressed the cooldown in.
      // Two readings of the same constant: the dip outlasted the response
      // window (still at/below the line at s + window), and the owner had a
      // response window's worth of castable seconds inside it.
      let castableSecs = 0;
      for (let t = s; t <= episodeEndSec; t++) if (ownerCanActAt(t)) castableSecs++;
      if (
        episodeEndSec - s < CD_PRIOR_MIN_PERSIST_S ||
        castableSecs < CD_PRIOR_MIN_PERSIST_S
      ) {
        skipTo();
        continue;
      }
      if (!cdAvailableAt(cd, s)) {
        skipTo();
        continue;
      }
      const minIsOwner = min.unit.id === owner.id;
      const helps = minIsOwner
        ? !SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId)
        : canHelpAnotherUnit(cd.spellId, cd.tag);
      if (!helps) {
        skipTo();
        continue;
      }
      const spent = cd.casts.some(
        (c) =>
          c.timeSeconds >= s - RESPONSE_PRE_MS / 1000 &&
          c.timeSeconds <= episodeEndSec + 1,
      );
      if (spent) {
        skipTo();
        continue;
      }
      out.push({
        spellId: cd.spellId,
        spellName: cd.spellName,
        tSec: s,
        hpAtCrossPct: cur.hpPct,
        minHpPct: min.hpPct,
        minSec,
        endSec: episodeEndSec,
        ownerLockedSecs: episodeEndSec - s + 1 - castableSecs,
        minUnitName: min.unit.name,
        minUnitIsOwner: minIsOwner,
        ref,
      });
      skipTo();
    }
  }
  return out.sort((a, b) => a.tSec - b.tSec || a.minHpPct - b.minHpPct);
}
