import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  buildCannotCastIntervals,
  coveredMsWithin,
} from "./cannotCastIntervals";
import { isHealerSpec, isPassiveProcCast, specToString } from "./cooldowns";
import { getLowestHpPercentInWindow } from "./killWindowTargetSelection";
import { fmtTime } from "./renderGrid";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEALING_GAP_THRESHOLD_MS = 3000;
/** Healer must have this many ms of free (non-CC) time to have realistically cast a heal */
const MIN_FREE_CAST_MS = 1500;
/** Grace period: ignore tail gaps within this many ms of match end (match may end mid-cast) */
const TAIL_GRACE_MS = 5000;
/** B19: Suppress gaps that start in the first N ms of the match (pre-combat initialization) */
const MATCH_START_GRACE_MS = 5000;
/**
 * B47: Gap-specific pressure factor — 10% of max HP taken in the gap window.
 * Lower than the panic-defensive 15% because gaps are measured over the full gap
 * duration (≥3.5s) rather than a short burst window, so moderate sustained
 * pressure (≈10-15k DPS) is enough to flag a meaningful missed heal.
 */
const GAP_PRESSURE_PCT = 0.1;
const GAP_PRESSURE_FALLBACK_DPS = 40_000;
const GAP_PRESSURE_FALLBACK_HEALER = 25_000;

// "Could not cast" (hard CC + silence auras ∪ kick lockouts) is decided by
// utils/cannotCastIntervals.ts — the same predicate dispelAnalysis's
// "dispeller was locked out" gate reads (BACKLOG #38 (e), 2026-09-02). The
// aura half already went through isCastBlockingAuraType (single source, hard
// CC + silence; the earlier local set ["cc", "immunities_spells"] missed
// silences and carried a dead value); the kick half is new here.

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface IHealingGap {
  fromSeconds: number;
  toSeconds: number;
  durationSeconds: number;
  /** Gap duration minus CC/silence time — the healer's actual free window */
  freeCastSeconds: number;
  /** Name of the teammate who took the most damage during this gap */
  mostDamagedName: string;
  mostDamagedSpec: string;
  /** Raw damage taken by the most-pressured teammate */
  mostDamagedAmount: number;
  /**
   * The minimum HP% (0-100) reached by any friendly player's raw advancedAction
   * sample whose timestamp falls inside [fromMs, effectiveToMs] (the same window
   * used for the pressure check above). null when no friendly advancedAction
   * sample landed inside the window at all. 3,000-match outcome probe
   * (2026-08-30, eval-private/reports/signal-outcomes-2026-08-30/report.md):
   * friendly-death-within-10s is flat across gap length (2-4s 5.3%, 4-6s 5.4%,
   * 6+s 5.7%) but steeply keyed on this value (<=40% 13.0%, 40-70% 2.8%,
   * >70% 0.8%) — gap length is not the criterion, this is.
   */
  lowestFriendlyHpPct: number | null;
}

// ---------------------------------------------------------------------------
// Pressure threshold (gap-specific)
// ---------------------------------------------------------------------------

function getGapPressureThreshold(unit: ICombatUnit): number {
  if (unit.advancedActions.length > 0) {
    const maxHp = Math.max(
      ...unit.advancedActions.map((a) => a.advancedActorMaxHp),
    );
    if (maxHp > 0) return maxHp * GAP_PRESSURE_PCT;
  }
  return isHealerSpec(unit.spec)
    ? GAP_PRESSURE_FALLBACK_HEALER
    : GAP_PRESSURE_FALLBACK_DPS;
}

// ---------------------------------------------------------------------------
// CC coverage helper
// ---------------------------------------------------------------------------

/**
 * Milliseconds within [fromMs, toMs] during which the healer could not cast —
 * enemy hard CC + silence auras ∪ enemy kick school-lockouts, one predicate
 * shared with dispelAnalysis's "dispeller was locked out" gate
 * (`utils/cannotCastIntervals.ts`, BACKLOG #38 (e), 2026-09-02). Before that
 * this file subtracted auras only: a pure interrupt logs no aura event, so the
 * 3–6 s after a Pummel / Counterspell counted as free-cast time and the
 * healer was charged with a gap he was locked out of.
 */
function getCCCoveredMs(
  cannotCast: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): number {
  return coveredMsWithin(cannotCast, fromMs, toMs);
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

/**
 * Finds intervals where a healer produced no healOut events or spell casts for >= 3.5s,
 * while a teammate was under significant pressure, and the healer had enough
 * free (non-CC, non-silenced) time to have cast at least one heal.
 */
export function detectHealingGaps(
  healer: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: { startTime: number; endTime: number },
): IHealingGap[] {
  const enemyIds = new Set(enemies.map((u) => u.id));
  // One predicate for "could not cast" (auras ∪ kick lockouts), built once
  // per healer and clipped per gap below.
  const cannotCast = buildCannotCastIntervals(healer, enemyIds);
  const teammates = friends.filter((u) => u.id !== healer.id);
  const matchStartMs = combat.startTime;
  const matchEndMs = combat.endTime;

  // All timestamps where the healer produced a heal event or successfully cast a spell, sorted ascending
  const healTimestamps = healer.healOut.map((h) => h.logLine.timestamp);
  const castTimestamps = healer.spellCastEvents
    // GH #108: a passive proc is not the healer acting
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !isPassiveProcCast(e),
    )
    .map((e) => e.logLine.timestamp);

  const activeTimestamps = Array.from(
    new Set([...healTimestamps, ...castTimestamps]),
  ).sort((a, b) => a - b);

  // Build raw gap intervals [fromMs, toMs] where no heal/cast was produced
  const rawGaps: Array<{ fromMs: number; toMs: number }> = [];

  if (activeTimestamps.length === 0) {
    rawGaps.push({ fromMs: matchStartMs, toMs: matchEndMs });
  } else {
    // Gap before first activity
    if (activeTimestamps[0] - matchStartMs > HEALING_GAP_THRESHOLD_MS) {
      rawGaps.push({ fromMs: matchStartMs, toMs: activeTimestamps[0] });
    }
    // Gaps between consecutive activities
    for (let i = 0; i < activeTimestamps.length - 1; i++) {
      const from = activeTimestamps[i];
      const to = activeTimestamps[i + 1];
      if (to - from > HEALING_GAP_THRESHOLD_MS) {
        rawGaps.push({ fromMs: from, toMs: to });
      }
    }
    // Tail gap — only outside the grace window at match end
    const lastActivity = activeTimestamps[activeTimestamps.length - 1];
    if (matchEndMs - lastActivity > HEALING_GAP_THRESHOLD_MS + TAIL_GRACE_MS) {
      rawGaps.push({ fromMs: lastActivity, toMs: matchEndMs });
    }
  }

  const results: IHealingGap[] = [];

  // B137: a dead healer cannot be "inactive". Bound every gap by the healer's first in-match death:
  // the tail gap otherwise runs to match end (charging inactivity "while a teammate was under
  // pressure" during seconds the healer was already dead), and a pre-death HoT ticking post-mortem
  // can even open a phantom gap that STARTS after the death.
  const deathTimestamps = healer.deathRecords
    .map((r) => r.timestamp)
    .filter((ts) => ts >= matchStartMs && ts <= matchEndMs);
  const firstDeathMs = deathTimestamps.length
    ? Math.min(...deathTimestamps)
    : Infinity;

  for (const { fromMs, toMs } of rawGaps) {
    // B19: skip gaps at match start — pre-combat initialization artifact
    if (fromMs - matchStartMs < MATCH_START_GRACE_MS) continue;

    // B137: drop gaps that begin at/after the healer's death; clip gaps that run into it.
    if (firstDeathMs <= fromMs) continue;
    const effectiveToMs = firstDeathMs < toMs ? firstDeathMs : toMs;

    // CC check: how much of the gap was the healer unable to cast?
    const ccMs = getCCCoveredMs(cannotCast, fromMs, effectiveToMs);
    const freeCastMs = effectiveToMs - fromMs - ccMs;
    if (freeCastMs < MIN_FREE_CAST_MS) continue;

    // Pressure check: did any teammate take significant damage in this window?
    let mostDamagedAmount = 0;
    let mostDamagedName = "";
    let mostDamagedSpec = "";
    let anyUnderPressure = false;

    for (const teammate of teammates) {
      const dmg = teammate.damageIn
        .filter(
          (d) =>
            d.logLine.timestamp >= fromMs &&
            d.logLine.timestamp <= effectiveToMs,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);

      if (dmg >= getGapPressureThreshold(teammate)) anyUnderPressure = true;
      if (dmg > mostDamagedAmount) {
        mostDamagedAmount = dmg;
        mostDamagedName = teammate.name;
        mostDamagedSpec = specToString(teammate.spec);
      }
    }

    if (!anyUnderPressure) continue;

    // "How low did anyone get while the healer sat idle": every sample in the
    // window, per teammate via the shared windowed predicate, then the min.
    let lowestFriendlyHpPct: number | null = null;
    for (const teammate of teammates) {
      const low = getLowestHpPercentInWindow(
        teammate,
        (fromMs - matchStartMs) / 1000,
        (effectiveToMs - matchStartMs) / 1000,
        matchStartMs,
      );
      if (
        low !== null &&
        (lowestFriendlyHpPct === null || low < lowestFriendlyHpPct)
      )
        lowestFriendlyHpPct = low;
    }

    results.push({
      fromSeconds: (fromMs - matchStartMs) / 1000,
      toSeconds: (effectiveToMs - matchStartMs) / 1000,
      durationSeconds: (effectiveToMs - fromMs) / 1000,
      freeCastSeconds: freeCastMs / 1000,
      mostDamagedName,
      mostDamagedSpec,
      mostDamagedAmount,
      lowestFriendlyHpPct,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatHealingGapsForContext(gaps: IHealingGap[]): string[] {
  const lines: string[] = [];
  // "free" wording made explicit (2026-07-14 audit): judges found coach responses
  // inverting its meaning — free = seconds NOT under CC/silence, i.e. time the
  // healer physically could have cast but didn't.
  lines.push(
    'HEALER INACTIVITY (intervals >3s where healer cast no spells while a teammate was under pressure; "free" = un-CC\'d seconds the healer COULD have cast):',
  );

  if (gaps.length === 0) {
    lines.push("  None detected.");
    return lines;
  }

  for (const g of gaps) {
    const dmgK = Math.round(g.mostDamagedAmount / 1000);
    const dur = g.durationSeconds.toFixed(1);
    const free = g.freeCastSeconds.toFixed(1);
    lines.push(
      `  [INACTIVITY] From ${fmtTime(g.fromSeconds)} to ${fmtTime(g.toSeconds)} (${dur}s total, ${free}s of it un-CC'd/free to cast), no heals or spells cast while ${g.mostDamagedSpec} (${g.mostDamagedName}) took ${dmgK}k damage.`,
    );
  }

  return lines;
}
