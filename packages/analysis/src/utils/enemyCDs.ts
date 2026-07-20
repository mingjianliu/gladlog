import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { spellEffectData } from "../data/spellEffectData";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import {
  fmtTime,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  IDamageBucket,
  isHealerSpec,
  specToString,
} from "./cooldowns";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;
import {
  computeDampening,
  dampeningDangerMultiplier,
  fmtDampening,
} from "./dampening";
import {
  dangerLabel,
  isOffensiveSpell,
  spellDangerWeight,
} from "./spellDanger";

const MIN_CD_SECONDS = 30;
/** Two offensive CD casts within this window are considered an aligned burst.
 * Shared with burstLedger (friendly-side burst grouping) — one clustering predicate for both teams. */
export const BURST_CLUSTER_SECONDS = 10;
/** A single CD with at least this danger weight forms a burst window on its own (≈ a 2-minute major) */
const SOLO_WINDOW_MIN_WEIGHT = 1.3;

export interface IEnemyCDCast {
  spellId: string;
  spellName: string;
  castTimeSeconds: number;
  cooldownSeconds: number;
  /** When this CD will be available again (may exceed match duration) */
  availableAgainAtSeconds: number;
  /**
   * When the buff granted by this CD expires. Computed from spellEffectData.durationSeconds
   * when available; falls back to castTimeSeconds when duration data is missing.
   */
  buffEndSeconds: number;
}

export interface IEnemyPlayerTimeline {
  playerName: string;
  specName: string;
  offensiveCDs: IEnemyCDCast[];
}

export interface IAlignedBurstWindow {
  fromSeconds: number;
  toSeconds: number;
  activeCDs: Array<{
    playerName: string;
    spellName: string;
    spellId: string;
    /** 该 CD 在窗口内的实际施放秒——渲染必须带上,否则列表被读成"窗口起点同时全开"(059 误读)。 */
    castSeconds: number;
  }>;
  /** Ex-ante threat from the stacked CDs alone (weights × alignment × dampening) — outcome-independent */
  threatScore: number;
  threatLabel: "Low" | "Moderate" | "High" | "Critical";
  /** Combined score including outcome factors (damage dealt, healer CC) — kept for existing consumers */
  dangerScore: number;
  dangerLabel: "Low" | "Moderate" | "High" | "Critical";
  dampeningPct: number; // 0–1
  damageInWindow: number;
  damageRatio: number;
  healerCCed: boolean;
  /** HP% of the most-pressured friendly at window start, midpoint, and end */
  mostPressuredTarget?: {
    unitName: string;
    startHpPct: number | null;
    midHpPct: number | null;
    endHpPct: number | null;
  };
}

export interface IEnemyCDTimeline {
  players: IEnemyPlayerTimeline[];
  /** Windows where 2+ enemy offensive CDs were used within BURST_CLUSTER_SECONDS of each other */
  alignedBurstWindows: IAlignedBurstWindow[];
}

/**
 * For each enemy player, reconstruct when their offensive cooldowns (>= 30s) were cast
 * and when each CD will be available again. Also identifies aligned burst windows where
 * multiple enemies stacked offensive CDs together.
 */
export function reconstructEnemyCDTimeline(
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
  owner?: ICombatUnit,
  friendlies?: ICombatUnit[],
): IEnemyCDTimeline {
  const matchStartMs = combat.startTime;
  const matchDurationSeconds = (combat.endTime - matchStartMs) / 1000;

  const players: IEnemyPlayerTimeline[] = [];

  // Max CD to consider a "real" cooldown (filters out 999.999s passive procs)
  const MAX_CD_SECONDS = 360;

  for (const enemy of enemies) {
    const offensiveCDs: IEnemyCDCast[] = [];

    for (const cast of enemy.spellCastEvents) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const { spellId } = cast;
      if (!spellId) continue;
      if (!isOffensiveSpell(spellId)) continue;
      const effectData = spellEffectData[spellId];
      if (!effectData) continue;
      const cooldownSeconds =
        effectData.cooldownSeconds ??
        effectData.charges?.chargeCooldownSeconds ??
        0;
      if (cooldownSeconds < MIN_CD_SECONDS || cooldownSeconds > MAX_CD_SECONDS)
        continue;

      const castTimeSeconds = (cast.logLine.timestamp - matchStartMs) / 1000;
      const buffDuration = effectData.durationSeconds ?? 0;

      // Deduplicate: same player + same spellName within 1s = one cast (guards against double-parsed events and multi-target buffs)
      const isDuplicate = offensiveCDs.some(
        (existing) =>
          existing.spellName === effectData.name &&
          Math.abs(castTimeSeconds - existing.castTimeSeconds) < 1,
      );
      if (isDuplicate) continue;

      offensiveCDs.push({
        spellId,
        spellName: effectData.name,
        castTimeSeconds,
        cooldownSeconds,
        availableAgainAtSeconds: castTimeSeconds + cooldownSeconds,
        buffEndSeconds: castTimeSeconds + buffDuration,
      });
    }

    offensiveCDs.sort((a, b) => a.castTimeSeconds - b.castTimeSeconds);

    if (offensiveCDs.length > 0) {
      players.push({
        playerName: enemy.name,
        specName: specToString(enemy.spec),
        offensiveCDs,
      });
    }
  }

  // Find aligned burst windows: clusters of 2+ casts within BURST_CLUSTER_SECONDS
  const allCastsRaw = players
    .flatMap((p) =>
      p.offensiveCDs.map((cd) => ({
        time: cd.castTimeSeconds,
        buffEndSeconds: cd.buffEndSeconds,
        playerName: p.playerName,
        spellName: cd.spellName,
        spellId: cd.spellId,
        cooldownSeconds: cd.cooldownSeconds,
      })),
    )
    .sort((a, b) => a.time - b.time);

  const allCasts = allCastsRaw;

  // Compute the match-average friendly damage RATE for ratio calculation. Rates (not fixed-width
  // sums) so windows of different spans compare fairly — the old ±10s sample around the window START
  // mis-measured the damage of 69% of windows by >25% (91% of windows outlast 10s; 2026-07-03 audit).
  const allFriendlyDamage = (friendlies ?? []).flatMap((u) => u.damageIn);
  const totalFriendlyDamage = allFriendlyDamage.reduce(
    (sum, e) => sum + Math.abs(e.effectiveAmount),
    0,
  );
  const avgDamageRate =
    matchDurationSeconds > 0 ? totalFriendlyDamage / matchDurationSeconds : 0;

  // Group casts by ACTIVE-PRESSURE OVERLAP: a cast joins the current group if it lands while any of
  // the group's buffs is still running OR within BURST_CLUSTER_SECONDS of a group cast (superset of the
  // old cast-proximity clustering). Catches rolling bursts and staggered stacks the old 10s cast-cluster
  // missed (audit: 376 overlapping pairs across 249 games). A group becomes a window when it has 2+ CDs,
  // or a single CD heavy enough to be a solo kill-window (fixes the 122 zero-window games with deaths —
  // 2v2/Shuffle single-threat comps).
  const groups: (typeof allCasts)[] = [];
  {
    let current: typeof allCasts = [];
    let reach = -Infinity;
    for (const c of allCasts) {
      if (current.length === 0 || c.time <= reach) {
        current.push(c);
      } else {
        groups.push(current);
        current = [c];
      }
      reach = Math.max(reach, c.buffEndSeconds, c.time + BURST_CLUSTER_SECONDS);
    }
    if (current.length > 0) groups.push(current);
  }

  const alignedBurstWindows: IAlignedBurstWindow[] = [];
  for (const inWindow of groups) {
    const qualifies =
      inWindow.length >= 2 ||
      inWindow.some(
        (c) =>
          spellDangerWeight(c.spellId, c.cooldownSeconds) >=
          SOLO_WINDOW_MIN_WEIGHT,
      );
    if (qualifies) {
      const windowStart = inWindow[0].time;
      // toSeconds = when the last buff in this window actually expires, not just when it was cast.
      // Uses buffEndSeconds (cast + durationSeconds) when available; falls back to cast time.
      const windowEnd = Math.max(...inWindow.map((c) => c.buffEndSeconds));

      // Compute CD-based danger score
      const cdScore = inWindow.reduce(
        (sum, c) => sum + spellDangerWeight(c.spellId, c.cooldownSeconds),
        0,
      );
      const alignmentMultiplier = inWindow.length >= 3 ? 1.5 : 1.0;

      // Damage over the ACTUAL window span [start, end], compared as a rate to the match average.
      const windowDamage = allFriendlyDamage
        .filter((e) => {
          const t = (e.logLine.timestamp - matchStartMs) / 1000;
          return t >= windowStart && t <= windowEnd;
        })
        .reduce((sum, e) => sum + Math.abs(e.effectiveAmount), 0);

      const windowSpan = Math.max(windowEnd - windowStart, 1);
      const damageRatio =
        avgDamageRate > 0
          ? Math.min(
              6.0,
              Math.max(windowDamage / windowSpan / avgDamageRate, 0.5),
            )
          : 0.5;

      // Dampening at window start
      const bracket = combat.startInfo?.bracket ?? "3v3";
      const allPlayers = [...enemies, ...(friendlies ?? [])];
      const dampening = computeDampening(
        windowStart * 1000 + matchStartMs,
        bracket,
        allPlayers,
      );
      const dampeningMult = dampeningDangerMultiplier(dampening);

      // Hoist window timestamps here so both the healer CC block and HP sampling share the same values
      const windowStartMs = matchStartMs + windowStart * 1000;
      const windowEndMs = matchStartMs + windowEnd * 1000;
      const windowDuration = windowEnd - windowStart;

      // Healer CC explicit check: find if the healer had an active CC aura during this window
      let healerCCed = false;
      let ccDurationMs = 0;

      if (owner && isHealerSpec(owner.spec)) {
        const ccStartBySpell = new Map<string, number>();
        const ccIntervals: { start: number; end: number }[] = [];
        for (const a of owner.auraEvents) {
          if (!a.spellId) continue;
          const entry = SPELLS[a.spellId];
          if (entry?.type === "cc") {
            if (
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH
            ) {
              ccStartBySpell.set(a.spellId, a.logLine.timestamp);
            } else if (
              a.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
              a.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
              a.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
            ) {
              const ccStart = ccStartBySpell.get(a.spellId) ?? 0;
              const ccEnd = a.logLine.timestamp;
              if (
                ccStart > 0 &&
                ccStart < windowEndMs &&
                ccEnd > windowStartMs
              ) {
                ccIntervals.push({
                  start: Math.max(ccStart, windowStartMs),
                  end: Math.min(ccEnd, windowEndMs),
                });
              }
              ccStartBySpell.delete(a.spellId);
            }
          }
        }

        // Active CCs at match end
        for (const ccStart of ccStartBySpell.values()) {
          if (ccStart < windowEndMs && combat.endTime > windowStartMs) {
            ccIntervals.push({
              start: Math.max(ccStart, windowStartMs),
              end: Math.min(combat.endTime, windowEndMs),
            });
          }
        }

        if (ccIntervals.length > 0) {
          ccIntervals.sort((a, b) => a.start - b.start);
          const merged: { start: number; end: number }[] = [];
          let current = ccIntervals[0];
          for (let i = 1; i < ccIntervals.length; i++) {
            const next = ccIntervals[i];
            if (next.start <= current.end) {
              current.end = Math.max(current.end, next.end);
            } else {
              merged.push(current);
              current = next;
            }
          }
          merged.push(current);

          ccDurationMs = merged.reduce(
            (sum, interval) => sum + (interval.end - interval.start),
            0,
          );
        }

        healerCCed = ccDurationMs > 0;

        // Fallback: pseudo-CCed (long window, cast nothing)
        if (!healerCCed && windowDuration >= 5) {
          const ownerCastsInWindow = owner.spellCastEvents.filter((e) => {
            const t = (e.logLine.timestamp - matchStartMs) / 1000;
            return t >= windowStart && t <= windowEnd;
          });
          if (ownerCastsInWindow.length === 0) {
            healerCCed = true;
            ccDurationMs = windowDuration * 1000;
          }
        }
      }

      const ccFraction = ccDurationMs / Math.max(windowDuration * 1000, 1);
      const healerMult = 1.0 + ccFraction * 0.8;

      // Threat (ex-ante: what the stacked CDs could do) is kept separate from outcome factors
      // (damageRatio, healer CC) so a perfectly-defended Critical burst still reads as Critical
      // threat — otherwise the coach never sees (or reinforces) the player's best defensive play.
      const threatScore = cdScore * alignmentMultiplier * dampeningMult;
      const score = threatScore * damageRatio * healerMult;

      // Find the most-pressured friendly unit (highest damageIn during the burst window).
      // B4 fix: HP endpoint readings must be sampled NEAR the endpoint they claim to
      // represent. The old radius (half the burst duration, up to ±9s+) let a "start HP"
      // reading come from mid-window, contradicting the [STATE] snapshots at the same
      // timestamp and feeding coach errors. ±3s matches the [DMG SPIKE] sampling (±2s)
      // closely; when no sample exists that near, render nothing instead of a wrong number.
      const hpLookupRadiusMs = HP_SAMPLE_RADIUS_MS;
      let mostPressuredTarget: IAlignedBurstWindow["mostPressuredTarget"];
      if (friendlies && friendlies.length > 0) {
        let topUnit: ICombatUnit | null = null;
        let topDmg = 0;
        for (const f of friendlies) {
          const dmg = f.damageIn
            .filter(
              (d) =>
                d.logLine.timestamp >= windowStartMs &&
                d.logLine.timestamp <= windowEndMs,
            )
            .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
          if (dmg > topDmg) {
            topDmg = dmg;
            topUnit = f;
          }
        }
        if (topUnit && topDmg > 0) {
          const midMs = windowStartMs + (windowEndMs - windowStartMs) / 2;
          mostPressuredTarget = {
            unitName: topUnit.name,
            startHpPct: getUnitHpAtTimestamp(
              topUnit,
              windowStartMs,
              hpLookupRadiusMs,
            ),
            midHpPct: getUnitHpAtTimestamp(topUnit, midMs, hpLookupRadiusMs),
            endHpPct: getUnitHpAtTimestamp(
              topUnit,
              windowEndMs,
              hpLookupRadiusMs,
            ),
          };
        }
      }

      alignedBurstWindows.push({
        fromSeconds: windowStart,
        toSeconds: windowEnd,
        activeCDs: inWindow.map((c) => ({
          playerName: c.playerName,
          spellName: c.spellName,
          spellId: c.spellId,
          castSeconds: c.time,
        })),
        threatScore,
        threatLabel: dangerLabel(threatScore),
        dangerScore: score,
        dangerLabel: dangerLabel(score),
        dampeningPct: dampening,
        damageInWindow: windowDamage,
        damageRatio,
        healerCCed,
        mostPressuredTarget,
      });
    }
  }

  return { players, alignedBurstWindows };
}

/**
 * Renders the enemy CD timeline as plain text lines for inclusion in the AI context prompt.
 * Outputs burst window summaries only — individual per-player cast timestamps are captured
 * by MATCH ARC and would dilute LLM attention if repeated here.
 */
export function formatEnemyCDTimelineForContext(
  timeline: IEnemyCDTimeline,
  matchDurationSeconds: number,
): string[] {
  const lines: string[] = [];

  lines.push("## Enemy Cooldown Timeline");

  if (timeline.alignedBurstWindows.length === 0) {
    lines.push(
      timeline.players.length === 0
        ? "  No enemy offensive cooldown data found."
        : "  No coordinated enemy burst windows detected — sustained/individual pressure only.",
    );
    return lines;
  }

  lines.push(
    "  (Threat = strength of the stacked CDs before outcome; Outcome = what actually happened. High threat with below-average damage usually means the burst was well defended — worth crediting.)",
  );
  timeline.alignedBurstWindows.forEach((w, idx) => {
    const dampStr = fmtDampening(w.dampeningPct);
    // 每个 CD 带自己的施放时刻:窗口是"最早施放→最晚 buff 结束"的并集,
    // 不带时刻的列表曾被读成窗口起点同时全开(059)。
    const cdNames = w.activeCDs
      .map(
        (c) =>
          `${c.spellName} (${c.playerName}, cast ${fmtTime(c.castSeconds)})`,
      )
      .join(" + ");
    const dmgM = (w.damageInWindow / 1_000_000).toFixed(2);
    const ratioStr = `${w.damageRatio.toFixed(1)}× match avg rate`;
    const healerStr = w.healerCCed ? "healer CCed" : "healer free";
    lines.push(
      `  #${idx + 1} — ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} | Threat: ${w.threatLabel} (${w.threatScore.toFixed(1)}) | Dampening: ${dampStr}`,
    );
    lines.push(`    CDs: ${cdNames}`);
    lines.push(`    Outcome: ${dmgM}M damage (${ratioStr}) | ${healerStr}`);
    if (w.mostPressuredTarget) {
      const t = w.mostPressuredTarget;
      const hpStr = [
        t.startHpPct !== null ? `${t.startHpPct}% start` : null,
        t.midHpPct !== null ? `${t.midHpPct}% mid` : null,
        t.endHpPct !== null ? `${t.endHpPct}% end` : null,
      ]
        .filter(Boolean)
        .join(" → ");
      if (hpStr) lines.push(`    Most pressured: ${t.unitName} HP: ${hpStr}`);
    }
  });

  // Include never-used offensive CDs as hallucination guard: if an enemy CD never appeared
  // in a burst window, Claude should not claim it was used as part of a coordinated burst.
  const unusedByCDId = new Set<string>();
  for (const player of timeline.players) {
    for (const cd of player.offensiveCDs) {
      if (cd.availableAgainAtSeconds > matchDurationSeconds) {
        unusedByCDId.add(
          `${player.specName}: ${cd.spellName} — not used again after ${fmtTime(cd.castTimeSeconds)}`,
        );
      }
    }
  }
  if (unusedByCDId.size > 0) {
    // Observational wording only: static CDs are often shortened by talents/procs (2026-07-03 audit:
    // 2062 earlier-than-static recasts across the corpus), so never claim a CD "was still unavailable" —
    // only that it was not SEEN again.
    lines.push(
      "  Not cast again before the match ended (note: talents/procs often shorten real cooldowns, so availability is not implied): " +
        [...unusedByCDId].join("; "),
    );
  }

  return lines;
}

/** Minimum total damage in a 10-second window to treat a burst window as a confirmed kill attempt */
const KILL_ATTEMPT_SPIKE_THRESHOLD = 300_000;

/**
 * Synthesizes aligned enemy burst windows with actual damage spikes to label
 * explicit kill attempt windows. A "confirmed" kill attempt = burst window that
 * overlaps with a pressure spike above threshold. Unconfirmed burst windows
 * (likely baits or log gaps) are counted and noted separately.
 */
export function formatKillAttemptWindowsForContext(
  alignedBurstWindows: IAlignedBurstWindow[],
  pressureWindows: IDamageBucket[],
): string[] {
  if (alignedBurstWindows.length === 0) {
    return [
      "## Kill Attempt Windows",
      "  None detected (no aligned enemy burst windows).",
    ];
  }

  const lines: string[] = ["## Kill Attempt Windows"];
  let unconfirmedCount = 0;

  for (const burst of alignedBurstWindows) {
    // Spike's start time must fall within [burstStart-5s, burstEnd+5s] — covers lead-in and trailing damage
    // 取伤害最大的那条。此前用 .find(),拿到最大值靠的是 pressureWindows 恰好按
    // totalDamage 降序这一**隐式行为** —— 同一个坑本仓已中过三次(matchTimeline
    // 的 qualifyingSpikes、OFFENSIVE WINDOW,以及这里)。判据写明,排序变了语义不变。
    const spikeCandidates = pressureWindows.filter(
      (pw) =>
        pw.totalDamage >= KILL_ATTEMPT_SPIKE_THRESHOLD &&
        pw.fromSeconds >= burst.fromSeconds - 5 &&
        pw.fromSeconds <= burst.toSeconds + 5,
    );
    const spike = spikeCandidates.reduce<
      (typeof spikeCandidates)[number] | undefined
    >(
      (best, pw) => (!best || pw.totalDamage > best.totalDamage ? pw : best),
      undefined,
    );
    if (!spike) {
      unconfirmedCount++;
      continue;
    }
    const dmgM = (spike.totalDamage / 1_000_000).toFixed(2);
    const cdNames = burst.activeCDs
      .map((c) => `${c.spellName}@${fmtTime(c.castSeconds)}`)
      .join(" + ");
    lines.push(
      // 伤害数字属于那条 spike 自己的窗口,不是本 burst 窗口内的总伤害 ——
      // 两个区间不同,只印 burst 起止会被读成「这段窗口内的伤害」(同 I 类)。
      `  ${fmtTime(burst.fromSeconds)}–${fmtTime(burst.toSeconds)}  peak spike ${dmgM}M on ${spike.targetSpec} over ${fmtTime(spike.fromSeconds)}–${fmtTime(spike.toSeconds)} | CDs: ${cdNames}`,
    );
  }

  if (lines.length === 1) {
    lines.push(
      "  No burst windows had a confirmed damage spike above threshold.",
    );
  }
  if (unconfirmedCount > 0) {
    lines.push(
      `  Note: ${unconfirmedCount} burst window(s) had no confirmed spike — possible bait, spiked below threshold, or log gap.`,
    );
  }

  return lines;
}
