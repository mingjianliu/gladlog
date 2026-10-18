import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";

import { analyzeBurstLedger, auditWindowTargeting } from "./burstLedger";
import { analyzeKickAudit } from "./kickAudit";
import { computeOffensiveWindows } from "./offensiveWindows";

/** Criterion for a burst having "converted": the dominant target died inside the
 *  window, or its net HP drop was ≥ this many percentage points. */
export const CONVERTED_HP_DROP_PT = 20;

/**
 * Single source for the burst-conversion predicate: shared by the dpsMetrics
 * aggregation and candidateFindings' unconverted-burst candidate (a gate
 * predicate IS the spec).
 */
export function isBurstConverted(t: {
  died: boolean;
  hpStartPct: number | null;
  hpEndPct: number | null;
}): boolean {
  return (
    t.died ||
    (t.hpStartPct !== null &&
      t.hpEndPct !== null &&
      t.hpStartPct - t.hpEndPct >= CONVERTED_HP_DROP_PT)
  );
}

/**
 * DPS pro-comparison metrics (pro-comparison P1). Exactly the same predicates as
 * the burst ledger / report cards (analyzeBurstLedger / auditWindowTargeting /
 * analyzeKickAudit) — whatever is aggregated into a cell is what the user sees
 * in their ledger.
 * All values are bounded scalars (ratios 0–1, seconds, counts), so no
 * winsorizing is needed.
 */
export interface IDpsMetrics {
  /** Number of bursts (after grouping by offensive major CDs). */
  burstCount: number;
  /** Fraction of bursts that converted (dominant target died or lost ≥20
   *  percentage points of HP); no bursts → null. */
  burstConversionRate: number | null;
  /** Fraction of bursts where the dominant target had an immunity or major
   *  mitigation up; no bursts → null. */
  burstIntoDefensiveRatio: number | null;
  /** Fraction of bursts overlapping an ally's offensive CD; no bursts → null. */
  alignedBurstRatio: number | null;
  /** Fraction of damage inside kill windows that landed on the window's target
   *  (summed across windows); no windows → null. */
  onTargetPct: number | null;
  /** Interrupt landing rate (landed / kicks with a known outcome; unknown ones
   *  are excluded); no kicks → null. */
  kickLandedRate: number | null;
  /** Number of kicks baited by a fake cast. */
  kicksJukedCount: number;
  /** Seconds from the opener to the first burst; no bursts → null. */
  firstBurstSeconds: number | null;
}

export function computeDpsMetrics(
  combat: AtomicArenaCombat,
  playerName: string,
): IDpsMetrics {
  const allUnits = Object.values(combat.units) as ICombatUnit[];
  const players = allUnits.filter(
    (u) => u.type === CombatUnitType.Player && u.info,
  );
  const player = players.find((u) => u.name === playerName);
  const empty: IDpsMetrics = {
    burstCount: 0,
    burstConversionRate: null,
    burstIntoDefensiveRatio: null,
    alignedBurstRatio: null,
    onTargetPct: null,
    kickLandedRate: null,
    kicksJukedCount: 0,
    firstBurstSeconds: null,
  };
  if (!player) return empty;

  const allies = players.filter(
    (u) => u.reaction === player.reaction && u.id !== player.id,
  );
  const enemies = players.filter((u) => u.reaction !== player.reaction);
  if (enemies.length === 0) return empty;

  const bursts = analyzeBurstLedger(player, allies, enemies, combat);
  const burstCount = bursts.length;
  let converted = 0;
  let intoDefensive = 0;
  let aligned = 0;
  for (const b of bursts) {
    const t = b.dominantTarget;
    const dropped = t !== null && isBurstConverted(t);
    if (dropped) converted++;
    // the reference vectors were built on the cast-id set (F15 C10)
    if (t && t.defensivesHit.some((d) => !d.viaLoggedAura)) intoDefensive++;
    if (b.allyCDsOverlapping.length > 0) aligned++;
  }

  // Kill windows from the same reaction's point of view (same basis as the
  // report card's deriveBurstLedger)
  const windows = computeOffensiveWindows(
    enemies,
    players.filter((u) => u.reaction === player.reaction),
    combat,
  );
  const targeting = auditWindowTargeting(player, windows, enemies, combat);
  const dmgTotal = targeting.reduce((s, w) => s + w.playerDamageTotal, 0);
  const dmgOnTarget = targeting.reduce((s, w) => s + w.playerDamageToTarget, 0);

  const kicks = analyzeKickAudit(player, enemies, combat);
  const decided = kicks.filter((k) => k.result !== "unknown");
  const landed = decided.filter((k) => k.result === "landed").length;

  return {
    burstCount,
    burstConversionRate: burstCount > 0 ? converted / burstCount : null,
    burstIntoDefensiveRatio: burstCount > 0 ? intoDefensive / burstCount : null,
    alignedBurstRatio: burstCount > 0 ? aligned / burstCount : null,
    onTargetPct: dmgTotal > 0 ? dmgOnTarget / dmgTotal : null,
    kickLandedRate: decided.length > 0 ? landed / decided.length : null,
    kicksJukedCount: kicks.filter((k) => k.result === "juked").length,
    firstBurstSeconds: burstCount > 0 ? bursts[0].fromSeconds : null,
  };
}
