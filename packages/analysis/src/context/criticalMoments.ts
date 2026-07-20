import { ICombatUnit } from "@gladlog/parser-compat";

import { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  fmtTime,
  FORBEARANCE_GATED_IDS,
  IMajorCooldownInfo,
  IOverlappedDefensive,
  IPanicDefensive,
  isAllyCastableDefensive,
  selfForbearanceActiveAt,
  specToString,
  toRenderSecond,
} from "../utils/cooldowns";
import { IEnemyCDTimeline } from "../utils/enemyCDs";
import { IHealingGap } from "../utils/healingGaps";
import {
  getHpPercentAtTime,
  getLowestHpPercentInWindow,
} from "../utils/killWindowTargetSelection";
import { countActiveAtonements } from "./resourceSnapshot";
import { getTopDamageSourcesInWindow, lastCastBefore } from "./timelineHelpers";

const DEATH_LOOKFORWARD_SECONDS = 45;

export type MomentRole =
  "Constraint" | "Kill" | "Trade" | "Setup" | "Consequence" | "Standalone";

export interface CriticalMoment {
  timeSeconds: number;
  impactScore: number;
  impactLabel: "Critical" | "High" | "Moderate";
  roleLabel: MomentRole;
  title: string;
  enemyState: string;
  friendlyState: string;
  whatHappened: string;
  /** For Constraint moments: what the trade locked out going forward */
  implication?: string[];
  /** Mechanical CD/trinket availability at this moment — anti-hallucination guard */
  mechanicalAvailability: string[];
  /** Interpretive decision space — actual alternatives that existed */
  interpretation: string[];
  /** Only on Kill moments: three-tier option availability */
  tieredOptions?: {
    realistic: string[];
    limited: string[];
    unavailable: string[];
  };
  /** Only on Kill moments: structural context and micro-level mistakes (facts only — no verdict) */
  finalAssessment?: { macroOutcome: string; microMistakes: string[] };
  /** Legacy field — used for Trade/Setup/Pressure moments */
  availableOptions: string;
  uncertainty: string;
  isDeath?: boolean;
  contributingDeathSpec?: string;
  contributingDeathAtSeconds?: number;
  /** Backward causal trace from death: what CDs were unavailable and why, plus CC context */
  rootCauseTrace?: string[];
}

/**
 * 死亡回溯的 CC 回看窗口(秒):death-trace 与 death-setup 候选共用
 * (谓词即规范 —— 两边判定「死亡窗口内的 CC」必须同一窗口)。
 */
export const DEATH_CC_LOOKBACK_S = 12;

export function getEnemyStateAtTime(
  timeSeconds: number,
  enemyCDTimeline: IEnemyCDTimeline,
  peakDamagePressure5s?: number,
): string {
  // Prefer aligned burst windows: look for a burst that started within 15s before or 5s after the moment
  const relevant = enemyCDTimeline.alignedBurstWindows.filter(
    (w) => w.fromSeconds <= timeSeconds + 5 && w.toSeconds >= timeSeconds - 15,
  );
  if (relevant.length > 0) {
    const best = [...relevant].sort((a, b) => b.dangerScore - a.dangerScore)[0];
    const cdNames = best.activeCDs
      .map((c) => `${c.playerName}: ${c.spellName}`)
      .join(", ");
    return `Aligned burst (${best.dangerLabel} threat) — ${cdNames}`;
  }
  // Fall back to individual offensive CDs cast near this time (≥90s cooldown only)
  const nearCDs: string[] = [];
  for (const player of enemyCDTimeline.players) {
    for (const cd of player.offensiveCDs) {
      if (
        cd.castTimeSeconds >= timeSeconds - 15 &&
        cd.castTimeSeconds <= timeSeconds + 5 &&
        cd.cooldownSeconds >= 90
      ) {
        nearCDs.push(
          `${player.playerName}: ${cd.spellName} at ${fmtTime(cd.castTimeSeconds)}`,
        );
      }
    }
  }
  if (nearCDs.length > 0)
    return `Individual offensive CDs near this window: ${nearCDs.join(", ")}`;
  if (peakDamagePressure5s !== undefined) {
    const peakK = Math.round(peakDamagePressure5s / 1000);
    return `No coordinated burst detected — sustained/DoT or single-target pressure (peak: ${peakK}k in 5s)`;
  }
  return "No coordinated burst detected in this window";
}

export function getOwnerCDsAvailable(
  timeSeconds: number,
  cooldowns: IMajorCooldownInfo[],
): string {
  const available: string[] = [];
  const onCD: string[] = [];
  for (const cd of cooldowns) {
    if (cd.neverUsed) {
      available.push(
        `${cd.spellName} (never used — available since match start)`,
      );
      continue;
    }
    const castsBeforeNow = cd.casts.filter((c) => c.timeSeconds <= timeSeconds);
    if (castsBeforeNow.length === 0) {
      available.push(`${cd.spellName} (not yet used)`);
    } else {
      const lastCast = castsBeforeNow[castsBeforeNow.length - 1];
      const readyAt = lastCast.timeSeconds + cd.cooldownSeconds;
      if (readyAt <= timeSeconds) {
        available.push(`${cd.spellName} (ready since ${fmtTime(readyAt)})`);
      } else {
        onCD.push(`${cd.spellName} (on CD until ~${fmtTime(readyAt)})`);
      }
    }
  }
  const parts: string[] = [];
  if (available.length > 0) parts.push(`Available: ${available.join(", ")}`);
  if (onCD.length > 0) parts.push(`On cooldown: ${onCD.join(", ")}`);
  return parts.join(" | ") || "No major CD data for log owner";
}

/**
 * Traces backward from a death to identify root causes:
 * - Which owner CDs were on cooldown at death time, and whether the last use was panic/suboptimal
 * - Which owner CDs were available but never pressed
 * - Whether the dying player was CC'd in the window before death, and if it was avoidable
 */
export function buildDeathRootCauseTrace(
  deathTimeSeconds: number,
  ownerCooldowns: IMajorCooldownInfo[],
  dyingPlayerCC: IPlayerCCTrinketSummary | undefined,
  dyingUnit: ICombatUnit | undefined,
  matchStartMs: number,
  isOwnerDeath = true,
  friends: ICombatUnit[] = [],
): string[] {
  const traces: string[] = [];

  // 0a. HP trajectory leading to death
  if (dyingUnit) {
    const checkpoints = [15, 10, 5, 3];
    const trajectory: string[] = [];
    for (const secondsBefore of checkpoints) {
      const pct = getHpPercentAtTime(
        dyingUnit,
        toRenderSecond(deathTimeSeconds - secondsBefore),
        matchStartMs,
      );
      if (pct !== null) {
        trajectory.push(`${Math.round(pct)}% at T-${secondsBefore}s`);
      }
    }
    if (trajectory.length > 0) {
      traces.push(
        `HP trajectory before death: ${trajectory.join(" → ")} → dead (each checkpoint sampled within ±3s of its instant; checkpoints with no near reading are omitted)`,
      );
    }
  }

  // 0b. Top damage contributors in the 10s kill window
  if (dyingUnit) {
    const deathMs = matchStartMs + deathTimeSeconds * 1000;
    const topSources = getTopDamageSourcesInWindow(dyingUnit, deathMs, 10_000);
    if (topSources.length > 0) {
      traces.push(`Top damage sources in final 10s: ${topSources.join(", ")}`);
    }
  }

  // 1. Check each owner major CD: on CD (and why) vs available-but-not-pressed
  const forbearanceActive = dyingUnit
    ? selfForbearanceActiveAt(
        dyingUnit,
        friends,
        deathTimeSeconds,
        matchStartMs,
      )
    : false;
  const forbearanceNote = `unavailable at death — Forbearance-locked (a shared-Forbearance ability was self-applied within 30s)`;
  for (const cd of ownerCooldowns) {
    // A self-only owner defensive (Barkskin, Frenzied Regen, Divine Protection, …) cannot save a
    // TEAMMATE — drop it from a teammate's death trace (only ally-castable externals help someone else).
    if (
      !isOwnerDeath &&
      cd.tag === "Defensive" &&
      !isAllyCastableDefensive(cd.spellId)
    )
      continue;
    // Don't report a Forbearance-gated tool (Spellwarding/BoP/Lay on Hands/Divine Shield) as available
    // when the paladin self-applied Forbearance within 30s — it was mechanically uncastable.
    const forbearanceLocked =
      forbearanceActive && FORBEARANCE_GATED_IDS.has(cd.spellId);
    if (cd.neverUsed) {
      traces.push(
        forbearanceLocked
          ? `${cd.spellName} [${cd.tag}]: ${forbearanceNote}`
          : `${cd.spellName} [${cd.tag}]: NEVER USED — was available throughout the match`,
      );
      continue;
    }
    const castsBeforeDeath = cd.casts.filter(
      (c) => c.timeSeconds <= deathTimeSeconds,
    );
    if (castsBeforeDeath.length === 0) {
      // Never used before this death — was available (unless Forbearance-locked)
      traces.push(
        forbearanceLocked
          ? `${cd.spellName} [${cd.tag}]: ${forbearanceNote}`
          : `${cd.spellName} [${cd.tag}]: not yet used — was available at death time`,
      );
      continue;
    }
    const lastCast = castsBeforeDeath[castsBeforeDeath.length - 1];
    const readyAt = lastCast.timeSeconds + cd.cooldownSeconds;
    if (readyAt > deathTimeSeconds) {
      // On cooldown at death — trace why
      const timeAgo = Math.round(deathTimeSeconds - lastCast.timeSeconds);
      const timing =
        lastCast.timingLabel && lastCast.timingLabel !== "Unknown"
          ? ` [last use: ${lastCast.timingLabel.toUpperCase()}${lastCast.timingContext ? ` — ${lastCast.timingContext}` : ""}]`
          : "";
      traces.push(
        `${cd.spellName} [${cd.tag}]: ON COOLDOWN at death — last used ${fmtTime(lastCast.timeSeconds)} (${timeAgo}s before death)${timing}`,
      );
    } else {
      // Ready at death but not pressed (unless Forbearance-locked)
      traces.push(
        forbearanceLocked
          ? `${cd.spellName} [${cd.tag}]: ${forbearanceNote}`
          : `${cd.spellName} [${cd.tag}]: available at death time — not pressed`,
      );
    }
  }

  // 2. CC active on the dying player in the 12s window before/at death
  if (dyingPlayerCC) {
    const relevantCC = dyingPlayerCC.ccInstances.filter(
      (cc) =>
        cc.atSeconds <= deathTimeSeconds &&
        cc.atSeconds + cc.durationSeconds >=
          deathTimeSeconds - DEATH_CC_LOOKBACK_S,
    );
    for (const cc of relevantCC) {
      const endAt = cc.atSeconds + cc.durationSeconds;
      const avoidNote =
        cc.losBlocked === true
          ? ` — Positioning: ${cc.distanceYards?.toFixed(0) ?? "X"} yd from Pillar LoS`
          : cc.distanceYards !== null && cc.distanceYards <= 8
            ? ` — applied at ${cc.distanceYards.toFixed(0)}yd (melee range)`
            : "";
      traces.push(
        `CC on dying player: ${cc.spellName} by ${cc.sourceSpec} (${cc.sourceName}) at ${fmtTime(cc.atSeconds)}–${fmtTime(endAt)} — trinket: ${cc.trinketState}${avoidNote}`,
      );
    }
  }

  return traces;
}

export function findContributingDeath(
  momentTimeSeconds: number,
  friendlyDeaths: Array<{ spec: string; name: string; atSeconds: number }>,
): { spec: string; atSeconds: number } | undefined {
  return friendlyDeaths.find(
    (d) =>
      d.atSeconds > momentTimeSeconds &&
      d.atSeconds <= momentTimeSeconds + DEATH_LOOKFORWARD_SECONDS,
  );
}

export function buildKillMomentFields(
  deathTimeSeconds: number,
  cooldowns: IMajorCooldownInfo[],
  dyingPlayerCC: IPlayerCCTrinketSummary | undefined,
  constrainedTradePreceded: boolean,
  dyingHpPct: number | null,
): {
  mechanicalAvailability: string[];
  interpretation: string[];
  tieredOptions: {
    realistic: string[];
    limited: string[];
    unavailable: string[];
  };
  finalAssessment:
    { macroOutcome: string; microMistakes: string[] } | undefined;
} {
  const mechAvail: string[] = [];
  const interp: string[] = [];

  // Mechanical: list all defensive CDs and their state at death
  for (const cd of cooldowns) {
    if (cd.tag !== "Defensive") continue;
    const lastCast = lastCastBefore(cd, deathTimeSeconds);
    if (!lastCast) {
      mechAvail.push(
        cd.neverUsed
          ? `${cd.spellName}: never used — available`
          : `${cd.spellName}: not yet used — available`,
      );
    } else {
      const readyAt = lastCast.timeSeconds + cd.cooldownSeconds;
      if (readyAt > deathTimeSeconds) {
        mechAvail.push(
          `${cd.spellName}: on CD (last used ${fmtTime(lastCast.timeSeconds)})`,
        );
      } else {
        mechAvail.push(`${cd.spellName}: available since ${fmtTime(readyAt)}`);
      }
    }
  }

  // Mechanical: trinket near death
  const CC_LOOKBACK = 15;
  const nearDeathTrinketAvailable = dyingPlayerCC?.ccInstances.find(
    (cc) =>
      cc.atSeconds <= deathTimeSeconds &&
      cc.atSeconds >= deathTimeSeconds - CC_LOOKBACK &&
      cc.trinketState === "available_unused",
  );
  if (nearDeathTrinketAvailable) {
    mechAvail.push(
      `Trinket available at ${fmtTime(nearDeathTrinketAvailable.atSeconds)} during ${nearDeathTrinketAvailable.spellName} — not used`,
    );
  } else {
    mechAvail.push("Trinket: on cooldown or already spent");
  }

  // Interpretation
  if (constrainedTradePreceded) {
    interp.push(
      "No direct defensive response possible at death — resource exhausted by opening burst trade",
    );
  } else {
    const spentCDs = cooldowns.filter((cd) => {
      if (cd.tag !== "Defensive") return false;
      const lastCast = lastCastBefore(cd, deathTimeSeconds);
      if (!lastCast) return false;
      return lastCast.timeSeconds + cd.cooldownSeconds > deathTimeSeconds;
    });
    if (spentCDs.length > 0) {
      interp.push(
        `Major defensives spent: ${spentCDs.map((cd) => cd.spellName).join(", ")}`,
      );
    }
  }
  if (nearDeathTrinketAvailable) {
    interp.push(
      `Trinket during ${nearDeathTrinketAvailable.spellName} at ${fmtTime(nearDeathTrinketAvailable.atSeconds)} could have created a short survival window`,
    );
  }
  const nearDeathMeleeCC = dyingPlayerCC?.ccInstances.find(
    (cc) =>
      cc.atSeconds <= deathTimeSeconds &&
      cc.atSeconds >= deathTimeSeconds - CC_LOOKBACK &&
      cc.distanceYards !== null &&
      cc.distanceYards <= 8,
  );
  if (nearDeathMeleeCC) {
    interp.push(
      `Melee-range CC (${nearDeathMeleeCC.spellName} at ${nearDeathMeleeCC.distanceYards?.toFixed(0)}yd) may indicate positioning contributed to exposure (uncertain)`,
    );
  }

  // Three-tier option breakdown
  const tieredOptions = {
    realistic: [] as string[],
    limited: [] as string[],
    unavailable: [] as string[],
  };
  if (nearDeathTrinketAvailable) {
    tieredOptions.realistic.push(
      `Trinket during ${nearDeathTrinketAvailable.spellName} at ${fmtTime(nearDeathTrinketAvailable.atSeconds)} — only immediate actionable response`,
    );
  }
  if (nearDeathMeleeCC) {
    tieredOptions.limited.push(
      `Minor positioning adjustments to avoid melee-range CC (uncertain feasibility)`,
    );
  }
  const defensiveCDs = cooldowns.filter((cd) => cd.tag === "Defensive");
  const allDefensivesSpent =
    defensiveCDs.length > 0 &&
    defensiveCDs.every((cd) => {
      const lastCast = lastCastBefore(cd, deathTimeSeconds);
      if (!lastCast) return false; // never-used = available, not spent
      return lastCast.timeSeconds + cd.cooldownSeconds > deathTimeSeconds;
    });
  if (constrainedTradePreceded || allDefensivesSpent) {
    tieredOptions.unavailable.push(
      `No major defensive CDs available (all committed earlier in the match)`,
    );
  }

  // Final assessment: structural context + micro-level facts (no pre-drawn verdict)
  let finalAssessment:
    { macroOutcome: string; microMistakes: string[] } | undefined;
  if (constrainedTradePreceded) {
    const microMistakes: string[] = [];
    if (nearDeathTrinketAvailable) {
      microMistakes.push(
        `Trinket not used at ${fmtTime(nearDeathTrinketAvailable.atSeconds)} (minor survival extension possible)`,
      );
    }
    if (nearDeathMeleeCC) {
      microMistakes.push(
        `Positioning allowed melee-range ${nearDeathMeleeCC.spellName} (uncertain impact)`,
      );
    }
    const hpNote =
      dyingHpPct !== null
        ? ` (player was at ${Math.round(dyingHpPct)}% HP 5s before death)`
        : "";
    finalAssessment = {
      macroOutcome: `All major defensive CDs committed in opening trade with no recovery window before this death${hpNote}`,
      microMistakes,
    };
  }

  return {
    mechanicalAvailability: mechAvail,
    interpretation: interp,
    tieredOptions,
    finalAssessment,
  };
}

export function identifyCriticalMoments(
  isHealer: boolean,
  cooldowns: IMajorCooldownInfo[],
  enemyCDTimeline: IEnemyCDTimeline,
  friendlyDeaths: Array<{ spec: string; name: string; atSeconds: number }>,
  healingGaps: IHealingGap[],
  panicDefensives: IPanicDefensive[],
  overlappedDefensives: IOverlappedDefensive[],
  ccTrinketSummaries: IPlayerCCTrinketSummary[],
  peakDamagePressure5s: number,
  durationSeconds: number,
  friends: ICombatUnit[],
  matchStartMs: number,
  owner?: ICombatUnit,
): { moments: CriticalMoment[]; constrainedTrade: boolean } {
  const moments: CriticalMoment[] = [];
  const unitsByName = new Map(friends.map((u) => [u.name, u]));
  const unitsById = new Map(friends.map((u) => [u.id, u]));
  function hpPctNote(unit: ICombatUnit | undefined, atSeconds: number): string {
    if (!unit) return "";
    // 归到渲染网格再采样:这条注解与同秒 [STATE] 必须一致(见 toRenderSecond)。
    const pct = getHpPercentAtTime(
      unit,
      toRenderSecond(atSeconds),
      matchStartMs,
    );
    return pct !== null ? ` (${Math.round(pct)}% HP)` : "";
  }

  // 0. ConstrainedTrade — opening burst correctly traded but match too short for CD recovery
  // Gate: burst score ≥ 5.0 AND owner defensive CD traded into it AND match duration < that CD's
  //       cooldown (no recovery window) AND a friendly death follows
  const burstsSorted = [...enemyCDTimeline.alignedBurstWindows].sort(
    (a, b) => a.fromSeconds - b.fromSeconds,
  );
  const firstBurst = burstsSorted[0];
  let constrainedTradePreceded = false;

  if (
    firstBurst &&
    firstBurst.dangerScore >= 5.0 &&
    friendlyDeaths.length > 0
  ) {
    const tradedDefCDs = cooldowns.filter((cd) => {
      if (cd.tag !== "Defensive") return false;
      return cd.casts.some(
        (c) =>
          c.timeSeconds >= firstBurst.fromSeconds - 5 &&
          c.timeSeconds <= firstBurst.toSeconds + 5,
      );
    });
    if (tradedDefCDs.length > 0) {
      const minCooldown = Math.min(
        ...tradedDefCDs.map((cd) => cd.cooldownSeconds),
      );
      if (durationSeconds < minCooldown) {
        constrainedTradePreceded = true;
        const cdNames = tradedDefCDs.map((cd) => cd.spellName).join(" + ");
        const enemyStateRaw = getEnemyStateAtTime(
          firstBurst.fromSeconds,
          enemyCDTimeline,
          peakDamagePressure5s,
        );
        const enemyState = enemyStateRaw.replace(
          / \((Low|Moderate|High|Critical) threat\)/,
          "",
        );

        // Find the lowest HP friendly unit during the burst window to quantify pressure.
        // Scan the full window (not midpoint) so we capture the actual trough even if the
        // player is CC'd and not casting during the first half of the burst.
        let burstTargetHpNote = "";
        let lowestHpPct: number | null = null;
        let lowestHpName = "";
        for (const friend of friends) {
          const pct = getLowestHpPercentInWindow(
            friend,
            firstBurst.fromSeconds,
            firstBurst.toSeconds,
            matchStartMs,
          );
          if (pct !== null && (lowestHpPct === null || pct < lowestHpPct)) {
            lowestHpPct = pct;
            lowestHpName = friend.name;
          }
        }
        if (lowestHpPct !== null) {
          burstTargetHpNote = ` Most pressured player (${lowestHpName}) reached ${Math.round(lowestHpPct)}% HP during burst window.`;
        }

        moments.push({
          timeSeconds: firstBurst.fromSeconds,
          impactScore: 90,
          impactLabel: "Moderate",
          roleLabel: "Constraint",
          title: "Opening burst forced full defensive trade",
          enemyState,
          friendlyState: `${cdNames} committed to survive the burst`,
          whatHappened: `${cdNames} committed at ~${fmtTime(firstBurst.fromSeconds + 2)} to survive burst (${Math.round(peakDamagePressure5s / 1000)}k peak).${burstTargetHpNote} Trade was likely correct given burst strength.`,
          implication: [
            `All major defensive CDs committed with no recovery window in a ${fmtTime(durationSeconds)} match`,
            "Any subsequent burst window would have no defensive answer available",
          ],
          mechanicalAvailability: tradedDefCDs.map(
            (cd) =>
              `${cd.spellName}: committed — on CD until ~${fmtTime(firstBurst.fromSeconds + cd.cooldownSeconds)}`,
          ),
          interpretation: [
            `Trade was likely correct — burst score ${firstBurst.dangerScore.toFixed(1)}, peak ${Math.round(peakDamagePressure5s / 1000)}k`,
            "Holding any single CD risked death; the constraint is the match duration, not the decision",
          ],
          availableOptions: "",
          uncertainty:
            lowestHpPct !== null
              ? "Log confirms HP% at burst midpoint. Whether a partial CD hold was viable depends on HP trajectory, which is directional only (HP sampled from caster advanced data, not per-hit)."
              : "Cannot confirm HP% during burst or whether a partial CD hold was viable.",
        });
      }
    }
  }

  // 1. Friendly deaths — highest impact
  for (const death of friendlyDeaths) {
    const enemyStateRaw = getEnemyStateAtTime(
      death.atSeconds,
      enemyCDTimeline,
      peakDamagePressure5s,
    );
    const enemyState = enemyStateRaw.replace(
      / \((Low|Moderate|High|Critical) threat\)/,
      "",
    );
    const cdState = getOwnerCDsAvailable(death.atSeconds, cooldowns);
    const nearbyGap = healingGaps.find(
      (g) =>
        g.fromSeconds <= death.atSeconds && g.toSeconds >= death.atSeconds - 10,
    );
    const dyingUnit = unitsByName.get(death.name);
    const dyingHpBefore = dyingUnit
      ? getHpPercentAtTime(
          dyingUnit,
          toRenderSecond(death.atSeconds - 5),
          matchStartMs,
        )
      : null;
    const hpContext =
      dyingHpBefore !== null
        ? ` Player was at ${Math.round(dyingHpBefore)}% HP 5s before death.`
        : "";
    const whatHappened = nearbyGap
      ? `${death.spec} died at ${fmtTime(death.atSeconds)}.${hpContext} A ${nearbyGap.durationSeconds.toFixed(1)}s healing gap (${nearbyGap.freeCastSeconds.toFixed(1)}s free-cast) was active from ${fmtTime(nearbyGap.fromSeconds)} — healer was not CC'd during this time.`
      : `${death.spec} died at ${fmtTime(death.atSeconds)}.${hpContext}`;
    const dyingPlayerCC = ccTrinketSummaries.find(
      (s) => s.playerName === death.name,
    );
    const isOwnerDeath = !owner || owner.name === death.name;
    const rootCauseTrace = buildDeathRootCauseTrace(
      death.atSeconds,
      cooldowns,
      dyingPlayerCC,
      dyingUnit,
      matchStartMs,
      isOwnerDeath,
      friends,
    );
    // The trace lists the LOG OWNER's cooldowns. If the owner already died before this (teammate)
    // death, those cooldowns were not castable — flag it so a later death isn't blamed on a dead healer.
    const ownerDeadBefore =
      !!owner &&
      owner.name !== death.name &&
      owner.deathRecords.some(
        (d) => (d.timestamp - matchStartMs) / 1000 < death.atSeconds - 0.5,
      );
    if (ownerDeadBefore) {
      rootCauseTrace.unshift(
        "NOTE: the log owner (healer) was already dead at this time — no healer cooldown play was possible; the owner-CD lines below are not actionable for this death.",
      );
    }
    // F169 port: Disc Priest healing scales with active Atonement count — surface how ramped the
    // healer was at the death (a low count during a kill window means under-ramped Atonement).
    if (owner && specToString(owner.spec) === "Discipline Priest") {
      const atCount = countActiveAtonements(
        friends,
        matchStartMs + death.atSeconds * 1000,
      );
      rootCauseTrace.push(
        `Active Atonements at death: ${atCount} (Disc healing scales with Atonement count; a low count in a kill window means under-ramped).`,
      );
    }
    const {
      mechanicalAvailability,
      interpretation,
      tieredOptions,
      finalAssessment,
    } = buildKillMomentFields(
      death.atSeconds,
      cooldowns,
      dyingPlayerCC,
      constrainedTradePreceded,
      dyingHpBefore,
    );
    moments.push({
      timeSeconds: death.atSeconds,
      impactScore: 100,
      impactLabel: "Critical",
      roleLabel: "Kill",
      title: `${death.spec} death`,
      enemyState,
      friendlyState: cdState,
      whatHappened,
      mechanicalAvailability,
      interpretation,
      tieredOptions,
      finalAssessment,
      availableOptions: cdState,
      uncertainty:
        dyingHpBefore !== null
          ? "Log cannot confirm healer position or line-of-sight at time of death. Cause of death may involve prior damage not reflected in the nearest pressure window."
          : "Log cannot confirm healer position, line-of-sight, or exact HP% at time of death. Cause of death may involve prior damage not reflected in the nearest pressure window.",
      isDeath: true,
      rootCauseTrace,
    });
  }

  // 2. Free-cast healing gaps during pressure (healer only — not already tied to a death)
  if (isHealer) {
    for (const gap of healingGaps) {
      const tiedToDeath = friendlyDeaths.some(
        (d) =>
          gap.fromSeconds <= d.atSeconds && gap.toSeconds >= d.atSeconds - 10,
      );
      if (tiedToDeath) continue;
      const midpoint = gap.fromSeconds + gap.durationSeconds / 2;
      const enemyStateRaw = getEnemyStateAtTime(midpoint, enemyCDTimeline);
      const enemyState = enemyStateRaw.replace(
        / \((Low|Moderate|High|Critical) threat\)/,
        "",
      );
      const cdState = getOwnerCDsAvailable(gap.fromSeconds, cooldowns);
      const dmgK = Math.round(gap.mostDamagedAmount / 1000);
      const score = Math.min(85, 40 + gap.mostDamagedAmount / 150_000);
      const gapContributingDeath = findContributingDeath(
        gap.fromSeconds,
        friendlyDeaths,
      );
      moments.push({
        timeSeconds: gap.fromSeconds,
        impactScore: score,
        impactLabel: "Moderate",
        roleLabel: gapContributingDeath ? "Setup" : "Trade",
        title: `Healer inactivity — ${gap.mostDamagedSpec} took ${dmgK}k while healer was free to cast`,
        enemyState,
        friendlyState: `Healer had ${gap.freeCastSeconds.toFixed(1)}s free-cast time in a ${gap.durationSeconds.toFixed(1)}s window. ${cdState}`,
        whatHappened: `Healer cast no heals or spells from ${fmtTime(gap.fromSeconds)} to ${fmtTime(gap.toSeconds)} (${gap.durationSeconds.toFixed(1)}s total, ${gap.freeCastSeconds.toFixed(1)}s free). ${gap.mostDamagedSpec} (${gap.mostDamagedName}) took ${dmgK}k damage.`,
        mechanicalAvailability: [],
        interpretation: [],
        availableOptions: `Healer was free to cast — instant-cast heals and available CDs were options. ${cdState}`,
        uncertainty:
          "Log cannot confirm healer position or LoS. Mana state is not tracked. This window may reflect intentional repositioning not visible in combat events.",
        contributingDeathSpec: gapContributingDeath?.spec,
        contributingDeathAtSeconds: gapContributingDeath?.atSeconds,
      });
    }
  }

  // 3. Panic defensives — CD used during no real pressure
  for (const panic of panicDefensives) {
    const enemyStateRaw = getEnemyStateAtTime(
      panic.timeSeconds,
      enemyCDTimeline,
    );
    const enemyState = enemyStateRaw.replace(
      / \((Low|Moderate|High|Critical) threat\)/,
      "",
    );
    const cdState = getOwnerCDsAvailable(panic.timeSeconds, cooldowns);
    const panicContributingDeath = findContributingDeath(
      panic.timeSeconds,
      friendlyDeaths,
    );
    const panicTargetHpNote = hpPctNote(
      unitsByName.get(panic.targetName),
      panic.timeSeconds,
    );
    moments.push({
      timeSeconds: panic.timeSeconds,
      impactScore: 60,
      impactLabel: "Moderate",
      roleLabel: panicContributingDeath ? "Setup" : "Trade",
      title: `Defensive commit — ${panic.spellName} used with no coordinated enemy burst detected`,
      enemyState,
      friendlyState: cdState,
      whatHappened: `${panic.casterSpec} (${panic.casterName}) cast ${panic.spellName} on ${panic.targetSpec} (${panic.targetName})${panicTargetHpNote} at ${fmtTime(panic.timeSeconds)}, but no coordinated enemy offensive CDs were active in the surrounding 7-second window.`,
      mechanicalAvailability: [],
      interpretation: [],
      availableOptions: `Holding ${panic.spellName} for an aligned burst window would provide stronger coverage at the cost of a potentially risky undefended interval.`,
      uncertainty: panicTargetHpNote
        ? "Log may miss absorbed damage or individual enemy pressure that preceded the cast. Enemy intent cannot be fully confirmed from combat log events alone."
        : "Log may miss absorbed damage or individual enemy pressure that preceded the cast. Enemy intent and exact HP% cannot be confirmed from combat log events alone.",
      contributingDeathSpec: panicContributingDeath?.spec,
      contributingDeathAtSeconds: panicContributingDeath?.atSeconds,
    });
  }

  // 4. Overlapped defensives
  for (const overlap of overlappedDefensives) {
    const enemyStateRaw = getEnemyStateAtTime(
      overlap.timeSeconds,
      enemyCDTimeline,
    );
    const enemyState = enemyStateRaw.replace(
      / \((Low|Moderate|High|Critical) threat\)/,
      "",
    );
    const overlapContributingDeath = findContributingDeath(
      overlap.timeSeconds,
      friendlyDeaths,
    );
    const overlapTargetHpNote = hpPctNote(
      unitsById.get(overlap.targetUnitId),
      overlap.timeSeconds,
    );
    moments.push({
      timeSeconds: overlap.timeSeconds,
      impactScore: 50,
      impactLabel: "Moderate",
      roleLabel: overlapContributingDeath ? "Setup" : "Trade",
      title: `Defensive overlap — ${overlap.firstSpellName} + ${overlap.secondSpellName} simultaneously on ${overlap.targetName}`,
      enemyState,
      friendlyState: `${overlap.firstCasterSpec} used ${overlap.firstSpellName} at ${fmtTime(overlap.timeSeconds)}; ${overlap.secondCasterSpec} used ${overlap.secondSpellName} at ${fmtTime(overlap.secondCastTimeSeconds)} — simultaneous for ${overlap.simultaneousSeconds.toFixed(1)}s.`,
      whatHappened: `Two major defensives were stacked on ${overlap.targetName}${overlapTargetHpNote} for ${overlap.simultaneousSeconds.toFixed(1)}s of overlapping coverage, wasting effective duration of one CD.`,
      mechanicalAvailability: [],
      interpretation: [],
      availableOptions: `Staggering the CDs would extend total coverage by ~${Math.round(overlap.simultaneousSeconds)}s. Optimal: ${overlap.secondCasterSpec} waits for ${overlap.firstSpellName} to expire before pressing ${overlap.secondSpellName}.`,
      uncertainty: overlapTargetHpNote
        ? "Assess whether simultaneous stacking was necessary given target HP% shown above. Absorbed damage before the second cast is not tracked."
        : "Cannot determine if simultaneous stacking was required to survive a spike — HP values during this window are not fully tracked in the log.",
      contributingDeathSpec: overlapContributingDeath?.spec,
      contributingDeathAtSeconds: overlapContributingDeath?.atSeconds,
    });
  }

  // Sort and limit before role refinement so we work on the final set
  const sorted = moments
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 5);

  // Refine roles on the final sorted set:
  // - Trade with no contributingDeathAtSeconds → Standalone
  // - Setup: first moment pointing to a given death timestamp keeps Setup; subsequent ones → Consequence
  const claimedDeathTimestamps = new Set<number>();
  for (const m of sorted) {
    if (m.roleLabel === "Trade") {
      if (m.contributingDeathAtSeconds === undefined) {
        m.roleLabel = "Standalone";
      }
      // Trade with contributingDeathAtSeconds stays as Setup (already assigned in event loops above)
    }
    if (m.roleLabel === "Setup") {
      const key = Math.round(m.contributingDeathAtSeconds ?? -1);
      if (claimedDeathTimestamps.has(key)) {
        m.roleLabel = "Consequence";
      } else {
        claimedDeathTimestamps.add(key);
      }
    }
  }

  return {
    moments: sorted,
    constrainedTrade: constrainedTradePreceded,
  };
}
