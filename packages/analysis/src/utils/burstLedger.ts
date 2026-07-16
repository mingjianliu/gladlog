import { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import spellIdListsData from "../data/spellIdLists";
import { getUnitHpAtTimestamp, HP_SAMPLE_RADIUS_MS } from "./cooldowns";
import {
  BURST_CLUSTER_SECONDS,
  IEnemyCDCast,
  reconstructEnemyCDTimeline,
} from "./enemyCDs";
import { MIN_WINDOW_SECONDS } from "./killWindowTargetSelection";
import { IOffensiveWindow } from "./offensiveWindows";
import { buildAuraIntervals } from "./utils";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** Immunity + major-defensive ids a burst can be wasted into (same list the kill-window
 * target snapshot uses for "defensives spent"). */
const DEF_OR_IMMUNE_IDS = new Set<string>([
  ...((
    spellIdListsData as unknown as {
      externalOrBigDefensiveSpellIds?: string[];
    }
  ).externalOrBigDefensiveSpellIds ?? []),
  ...Object.keys(SPELLS).filter((id) => SPELLS[id]?.type === "immunities"),
]);

/** A burst with no buff-duration data still gets this measurement span (= the grouping reach). */
const MIN_BURST_SPAN_S = BURST_CLUSTER_SECONDS;
/** A target death up to this long after the burst ends still credits the burst. */
const KILL_CREDIT_SLACK_S = 5;
/** Defensive overlaps shorter than this are noise (aura edge vs burst edge). */
const MIN_DEFENSIVE_OVERLAP_S = 0.5;

export interface IBurstDefensiveHit {
  spellId: string;
  spellName: string;
  /** Seconds the defensive/immunity was active inside the burst span. */
  overlapSeconds: number;
  /** true = full immunity (Divine Shield / Turtle class); false = major damage reduction. */
  isImmunity: boolean;
}

export interface IBurstTargetDamage {
  unitId: string;
  unitName: string;
  damage: number;
}

export interface IBurstLedgerEntry {
  fromSeconds: number;
  toSeconds: number;
  /** Offensive CDs opening this burst, cast order. */
  spells: Array<{
    spellId: string;
    spellName: string;
    castTimeSeconds: number;
  }>;
  /** Player damage to enemy players inside the span (pets excluded from targeting). */
  totalDamage: number;
  damageByTarget: IBurstTargetDamage[];
  /** Enemy player that received the most damage; null when the burst hit nothing. */
  dominantTarget: {
    unitId: string;
    unitName: string;
    hpStartPct: number | null;
    hpEndPct: number | null;
    damage: number;
    defensivesHit: IBurstDefensiveHit[];
    /** Target died inside [from, to + KILL_CREDIT_SLACK_S]. */
    died: boolean;
  } | null;
  /** Ally offensive CDs whose active span overlaps this burst (alignment evidence). */
  allyCDsOverlapping: Array<{ playerName: string; spellName: string }>;
}

/** Active span of one offensive CD cast: buff duration when known, grouping reach otherwise.
 * Exported for the replay burst visual — the pulse must cover exactly the span the ledger audits. */
export function burstCastSpan(cd: IEnemyCDCast): { from: number; to: number } {
  const to = Math.max(cd.buffEndSeconds, cd.castTimeSeconds + MIN_BURST_SPAN_S);
  return { from: cd.castTimeSeconds, to };
}

/**
 * Groups one player's offensive CD casts into bursts and audits each one:
 * where the damage went, whether the dominant target had an immunity/major
 * defensive running, whether any ally CD overlapped, and whether the target died.
 *
 * CD detection and clustering share the enemy-side predicates
 * (reconstructEnemyCDTimeline / BURST_CLUSTER_SECONDS) — same facts, one spec.
 */
export function analyzeBurstLedger(
  player: ICombatUnit,
  allies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IBurstLedgerEntry[] {
  const matchStartMs = combat.startTime;
  const matchEndS = (combat.endTime - matchStartMs) / 1000;

  const ownCDs =
    reconstructEnemyCDTimeline([player], combat).players[0]?.offensiveCDs ?? [];
  if (ownCDs.length === 0) return [];

  // Ally offensive CD spans, computed once (player excluded).
  const allyCDSpans = allies
    .filter((a) => a.id !== player.id)
    .flatMap((a) =>
      (
        reconstructEnemyCDTimeline([a], combat).players[0]?.offensiveCDs ?? []
      ).map((cd) => ({
        playerName: a.name,
        spellName: cd.spellName,
        ...burstCastSpan(cd),
      })),
    );

  const enemyPlayers = enemies.filter((e) => e.info);
  const enemyById = new Map(enemyPlayers.map((e) => [e.id, e]));

  // Group own casts by active-span overlap — same reach rule as enemyCDs' aligned windows.
  const groups: IEnemyCDCast[][] = [];
  {
    let current: IEnemyCDCast[] = [];
    let reach = -Infinity;
    for (const cd of ownCDs) {
      if (current.length === 0 || cd.castTimeSeconds <= reach) {
        current.push(cd);
      } else {
        groups.push(current);
        current = [cd];
      }
      reach = Math.max(reach, burstCastSpan(cd).to);
    }
    if (current.length > 0) groups.push(current);
  }

  const entries: IBurstLedgerEntry[] = [];
  for (const group of groups) {
    const fromSeconds = group[0].castTimeSeconds;
    const toSeconds = Math.min(
      Math.max(...group.map((cd) => burstCastSpan(cd).to)),
      matchEndS,
    );
    const fromMs = matchStartMs + fromSeconds * 1000;
    const toMs = matchStartMs + toSeconds * 1000;

    // Player damage (pet damage is merged into damageOut upstream) to enemy players.
    const damageMap = new Map<string, number>();
    for (const d of player.damageOut) {
      if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs) continue;
      if (!enemyById.has(d.destUnitId)) continue;
      damageMap.set(
        d.destUnitId,
        (damageMap.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
      );
    }
    const damageByTarget: IBurstTargetDamage[] = [...damageMap.entries()]
      .map(([unitId, damage]) => ({
        unitId,
        unitName: enemyById.get(unitId)?.name ?? unitId,
        damage,
      }))
      .sort((a, b) => b.damage - a.damage);
    const totalDamage = damageByTarget.reduce((s, t) => s + t.damage, 0);

    let dominantTarget: IBurstLedgerEntry["dominantTarget"] = null;
    const top = damageByTarget[0];
    if (top) {
      const target = enemyById.get(top.unitId)!;

      // Defensive/immunity auras actually ACTIVE on the target during the span
      // (real aura intervals, not cast+duration estimates).
      const defensivesHit: IBurstDefensiveHit[] = [];
      for (const iv of buildAuraIntervals(
        target,
        DEF_OR_IMMUNE_IDS,
        combat.endTime,
      )) {
        const overlapMs =
          Math.min(iv.endMs, toMs) - Math.max(iv.startMs, fromMs);
        if (overlapMs / 1000 < MIN_DEFENSIVE_OVERLAP_S) continue;
        defensivesHit.push({
          spellId: iv.spellId,
          spellName: iv.spellName,
          overlapSeconds: Math.round(overlapMs / 100) / 10,
          isImmunity: SPELLS[iv.spellId]?.type === "immunities",
        });
      }
      defensivesHit.sort((a, b) => b.overlapSeconds - a.overlapSeconds);

      const died = target.deathRecords.some(
        (dr) =>
          dr.timestamp >= fromMs &&
          dr.timestamp <= toMs + KILL_CREDIT_SLACK_S * 1000,
      );

      dominantTarget = {
        unitId: top.unitId,
        unitName: top.unitName,
        hpStartPct: getUnitHpAtTimestamp(target, fromMs, HP_SAMPLE_RADIUS_MS),
        hpEndPct: getUnitHpAtTimestamp(target, toMs, HP_SAMPLE_RADIUS_MS),
        damage: top.damage,
        defensivesHit,
        died,
      };
    }

    const allyCDsOverlapping = allyCDSpans
      .filter((s) => s.from <= toSeconds && s.to >= fromSeconds)
      .map((s) => ({ playerName: s.playerName, spellName: s.spellName }));

    entries.push({
      fromSeconds,
      toSeconds,
      spells: group.map((cd) => ({
        spellId: cd.spellId,
        spellName: cd.spellName,
        castTimeSeconds: cd.castTimeSeconds,
      })),
      totalDamage,
      damageByTarget,
      dominantTarget,
      allyCDsOverlapping,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Kill-window targeting audit (per player)
// ---------------------------------------------------------------------------

export interface IWindowTargetingAudit {
  windowFromSeconds: number;
  windowToSeconds: number;
  windowTargetId: string;
  windowTargetName: string;
  /** Player damage to all enemy players inside the window. */
  playerDamageTotal: number;
  playerDamageToTarget: number;
  /** 0–100, rounded. */
  onTargetPct: number;
  /** Biggest non-window-target recipient of the player's damage, if any. */
  topOffTarget: IBurstTargetDamage | null;
}

/**
 * For each offensive window (computeOffensiveWindows output), splits this player's
 * damage by enemy target and reports how much landed on the window's target.
 * Windows where the player dealt no damage are skipped — usually CC/death, which
 * the CC and death analyses already own.
 */
export function auditWindowTargeting(
  player: ICombatUnit,
  windows: IOffensiveWindow[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IWindowTargetingAudit[] {
  const matchStartMs = combat.startTime;
  const enemyById = new Map(
    enemies.filter((e) => e.info).map((e) => [e.id, e]),
  );
  const audits: IWindowTargetingAudit[] = [];

  for (const w of windows) {
    if (w.durationSeconds < MIN_WINDOW_SECONDS) continue;
    const fromMs = matchStartMs + w.fromSeconds * 1000;
    const toMs = matchStartMs + w.toSeconds * 1000;

    const damageMap = new Map<string, number>();
    for (const d of player.damageOut) {
      if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs) continue;
      if (!enemyById.has(d.destUnitId)) continue;
      damageMap.set(
        d.destUnitId,
        (damageMap.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
      );
    }
    const total = [...damageMap.values()].reduce((s, v) => s + v, 0);
    if (total <= 0) continue;

    const onTarget = damageMap.get(w.targetUnitId) ?? 0;
    let topOffTarget: IBurstTargetDamage | null = null;
    for (const [unitId, damage] of damageMap) {
      if (unitId === w.targetUnitId) continue;
      if (!topOffTarget || damage > topOffTarget.damage) {
        topOffTarget = {
          unitId,
          unitName: enemyById.get(unitId)?.name ?? unitId,
          damage,
        };
      }
    }

    audits.push({
      windowFromSeconds: w.fromSeconds,
      windowToSeconds: w.toSeconds,
      windowTargetId: w.targetUnitId,
      windowTargetName: w.targetName,
      playerDamageTotal: total,
      playerDamageToTarget: onTarget,
      onTargetPct: Math.round((100 * onTarget) / total),
      topOffTarget,
    });
  }

  return audits;
}
