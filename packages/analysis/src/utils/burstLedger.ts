import { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdListsData from "../data/spellIdLists";
import {
  fmtTime,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
} from "./cooldowns";
import {
  BURST_CLUSTER_SECONDS,
  IEnemyCDCast,
  reconstructEnemyCDTimeline,
} from "./enemyCDs";
import type { IKickAuditEntry } from "./kickAudit";
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
          // 中文客户端日志的 aura 名是本地化文本 —— prompt/facts 必须英文(CJK 泄漏审计教训)
          spellName: getEnglishSpellName(iv.spellId, iv.spellName),
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
    // 窗口目标死后的伤害占比无意义 —— 评估截断在目标死亡时刻
    // (2026-07-16 DPS baseline:≥8 场 responder/judge 点名该 artifact)。
    const target = enemyById.get(w.targetUnitId);
    // 取窗口后**最早**的一次死亡。用 .find() 取「数组序第一个」等于假设
    // deathRecords 已按时间升序 —— 那是上游的实现细节,不是契约;一旦乱序会
    // 截到更晚的死亡,窗口被拉长、on-target 占比被稀释。min 不依赖顺序。
    const deathsAfter = (target?.deathRecords ?? [])
      .map((d) => d.timestamp)
      .filter((t) => t > fromMs);
    const targetDeathMs =
      deathsAfter.length > 0 ? Math.min(...deathsAfter) : undefined;
    const toMs = Math.min(
      matchStartMs + w.toSeconds * 1000,
      targetDeathMs ?? Infinity,
    );
    if ((toMs - fromMs) / 1000 < MIN_WINDOW_SECONDS) continue;

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
      windowToSeconds: (toMs - matchStartMs) / 1000,
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

/** On-target share below this = off-target discipline problem.
 * Shared by the report card chip, the prompt block, and the off-target finding. */
export const ON_TARGET_GOOD_PCT = 50;

// ---------------------------------------------------------------------------
// Prompt formatter (DPS owner — timeline path <burst_ledger> block)
// ---------------------------------------------------------------------------

const fmtM = (n: number): string => `${(n / 1_000_000).toFixed(2)}M`;

/**
 * Renders the burst ledger as plain text for the AI context (DPS owners).
 * Times via fmtTime (floored render grid), percentages as ints — any future
 * gate re-parsing these lines re-derives the same values.
 */
export function formatBurstLedgerForContext(
  bursts: IBurstLedgerEntry[],
  targeting: IWindowTargetingAudit[],
  kicks: IKickAuditEntry[],
): string[] {
  if (bursts.length + targeting.length + kicks.length === 0) return [];
  const lines: string[] = ["## BURST LEDGER (your offensive audit)"];

  bursts.forEach((b, i) => {
    lines.push(
      `  Burst #${i + 1} — ${fmtTime(b.fromSeconds)}–${fmtTime(b.toSeconds)} | ${b.spells.map((s) => s.spellName).join(" + ")}`,
    );
    const t = b.dominantTarget;
    if (t) {
      const hpStr =
        t.hpStartPct !== null && t.hpEndPct !== null
          ? ` ${Math.round(t.hpStartPct)}% → ${Math.round(t.hpEndPct)}%`
          : "";
      lines.push(
        `    Target: ${t.unitName}${hpStr} | your damage ${fmtM(t.damage)}${t.died ? " | target DIED" : ""}`,
      );
      for (const d of t.defensivesHit) {
        // 2026-07-16 冒烟实测:不写明"挂在目标身上",responder 会误读成
        // 己方外置(PS 只能给队友 → 推理成"不算目标减伤")。主语必须显式。
        lines.push(
          `    ${d.isImmunity ? "⚠ Target was IMMUNE" : "Target had a major defensive up"}: ${d.spellName} active ON THE TARGET ${d.overlapSeconds.toFixed(1)}s of this burst`,
        );
      }
    } else {
      lines.push(`    No damage dealt to enemy players during this burst.`);
    }
    lines.push(
      b.allyCDsOverlapping.length > 0
        ? `    Aligned with: ${b.allyCDsOverlapping.map((a) => `${a.playerName} (${a.spellName})`).join(", ")}`
        : `    Solo burst — no ally offensive CD overlapped.`,
    );
  });

  const offTarget = targeting.filter((w) => w.onTargetPct < ON_TARGET_GOOD_PCT);
  for (const w of offTarget) {
    lines.push(
      `  Off-target: window ${fmtTime(w.windowFromSeconds)}–${fmtTime(w.windowToSeconds)} target ${w.windowTargetName} — only ${w.onTargetPct}% of your damage on target` +
        (w.topOffTarget
          ? ` (largest off-target: ${w.topOffTarget.unitName} ${fmtM(w.topOffTarget.damage)})`
          : ""),
    );
  }

  if (kicks.length > 0) {
    const parts = kicks.map((k) => {
      const at = fmtTime(k.atSeconds);
      switch (k.result) {
        case "landed":
          return `${at} ${k.kickSpellName} → interrupted ${k.interruptedSpellName}`;
        case "juked":
          return `${at} ${k.kickSpellName} → JUKED by fake ${k.jukedBySpellName}`;
        case "missed":
          return `${at} ${k.kickSpellName} → hit nothing`;
        default:
          return `${at} ${k.kickSpellName} → outcome unknown (no cast-start data)`;
      }
    });
    lines.push(`  Kicks: ${parts.join(" | ")}`);
  }

  return lines;
}
