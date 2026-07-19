/**
 * positionAnalysis.ts — owner engagement-state analysis from real X/Y coordinates.
 *
 * Answers "when should I push in vs. stay back?" with positional evidence,
 * cross-referencing burst windows and cooldown availability already computed
 * elsewhere. All events are point-in-time distance facts — no free-form paths.
 *
 * Requires advanced combat logging (unit.advancedActions); silently returns no
 * events when positions are absent. Distances are in game yards (~1 unit).
 */

import { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ICCInstance } from "./ccTrinketAnalysis";
import {
  fmtTime,
  getUnitHpAtTimestamp,
  IMajorCooldownInfo,
  isHealerSpec,
  isMeleeSpec,
} from "./cooldowns";
import { IAlignedBurstWindow } from "./enemyCDs";
import {
  HealerExposureLabel,
  IHealerBurstExposure,
} from "./healerExposureAnalysis";
import { distanceBetween, getUnitPositionAtTime } from "./losAnalysis";
import { INTERP_MAX_GAP_MS } from "./positionSampling";

// Thresholds (yards / seconds) — starting values from the Feature 15 spec.
const CLOSE_RANGE_YARDS = 12; // "in range" of an enemy
const KITE_DELTA_YARDS = 10; // distance gained that counts as a successful kite
const STAY_DELTA_YARDS = 5; // distance gained below this = stayed in
const MISSED_PUSH_MELEE_YARDS = 20; // melee parked beyond this = disengaged
const MISSED_PUSH_RANGED_YARDS = 45; // ranged beyond this = disengaged (max cast range is 40yd — 35–40yd is normal max-range play)
const CD_RANGE_YARDS = 15; // offensive CD cast beyond this = out of position
const CD_RANGE_RECHECK_SECONDS = 5; // still out of range this long after the cast
const BURST_EVAL_SECONDS = 10; // evaluate kite/stay over at most this much of the window
const MISSED_PUSH_MIN_SECONDS = 10; // sustained disengagement required
const KILL_PROXIMITY_SECONDS = 15; // ignore disengagement right before an enemy death
const MAX_MISSED_PUSH_EVENTS = 3;
// Iter 3 thresholds
const PUSH_ON_TARGET_YARDS = 12; // melee DPS counted "on the push target" within this
const PUSH_AWOL_YARDS = 20; // melee DPS beyond this during a committed push = split
const HEALER_TRAINED_YARDS = 8; // enemy melee camping the healer within this
const HEALER_TRAINED_MIN_SECONDS = 8; // sustained camping required
const MAX_ITER3_EVENTS = 2; // per event type
// Position snapshots are event-driven; when the query time is further than this
// from the nearest snapshot, the interpolated position is fabricated (unit was
// idle/stealthed/drinking) — treat as unknown.
// T3 grounding 守卫:同 ccTrinketAnalysis——禁跨空窗中段插值(TRAINED 0.4yd 假主张实锤)
const POSITION_MAX_GAP_MS = INTERP_MAX_GAP_MS;

/** STAYED_IN「站桩到濒死」的阈值:低于它一定算付出了代价。 */
export const STAYED_IN_NEAR_DEATH_PCT = 35;
/** 「没有真实代价」判据:最低血仍在此之上,且相对起始血的跌幅小于 DROP。 */
export const STAYED_IN_NO_COST_MIN_HP_PCT = 85;
export const STAYED_IN_NO_COST_MAX_DROP_PCT = 15;

/**
 * 这次 STAYED_IN 是否付出了真实代价(单源谓词)。
 *
 * context formatter 用它决定要不要打 "(no real cost)" 标签,深挖的可教信号门
 * 用它决定要不要为这条走位开一轮模型调用 —— 同一个事实必须同一个谓词。
 * 此前门那边写着「STAYED_IN 已经只在掉血时触发」的注释,而事实上
 * computeOwnerPositionEvents 从未按 HP 过滤,判据是纯几何:于是 HP 100%→98%
 * 的干净窗口照样开门,白烧一轮调用还大概率产出套话(周度复核 P1#1)。
 *
 * 无 HP 数据时返回 true(视为有代价):保持改动前的行为,只切掉「可证明无代价」
 * 这一类,便于 eval 归因过门率的变化。
 */
export function stayedInHadRealCost(
  hpMinPct: number | null | undefined,
  hpStartPct: number | null | undefined,
): boolean {
  if (hpMinPct === null || hpMinPct === undefined) return true;
  const noCost =
    hpMinPct >= STAYED_IN_NO_COST_MIN_HP_PCT &&
    (hpStartPct ?? 100) - hpMinPct < STAYED_IN_NO_COST_MAX_DROP_PCT;
  return !noCost;
}

export type PositionEventType =
  | "STAYED_IN"
  | "KITED"
  | "MISSED_PUSH"
  | "CD_OUT_OF_RANGE"
  | "SPLIT_PUSH"
  | "HEALER_TRAINED";

export interface IPositionEvent {
  type: PositionEventType;
  atSeconds: number;
  /** Window end for window-scoped events (STAYED_IN / KITED / MISSED_PUSH) */
  toSeconds?: number;
  startDistanceYards?: number;
  endDistanceYards?: number;
  nearestEnemyName?: string;
  /** Burst window threat label for STAYED_IN / KITED */
  dangerLabel?: string;
  /** Dampening during the window (0–1), for the "staying in may be correct" nuance */
  dampeningPct?: number;
  /** STAYED_IN only: whether a defensive CD was off cooldown at window start.
   *  undefined when no defensive CDs are tracked for this spec. */
  ownerDefensiveAvailable?: boolean;
  /** STAYED_IN / KITED: whether the burst's most-pressured target was the owner.
   *  undefined when the window has no pressure-target attribution. */
  burstTargetsOwner?: boolean;
  /** STAYED_IN / KITED: name of the burst's most-pressured target when it isn't the owner */
  burstTargetName?: string;
  /** STAYED_IN only: owner HP% at window start / minimum across the window — the
   *  OUTCOME that turns "stayed in" from a hedge into a fact (near-death vs no cost). */
  ownerHpStartPct?: number | null;
  ownerHpMinPct?: number | null;
  /** HEALER_TRAINED only: healer was hard-CC'd for most of the camp → could not
   *  self-reposition (team must peel), so don't advise "reposition". */
  ownerCcLocked?: boolean;
  /** CD_OUT_OF_RANGE only */
  spellName?: string;
  /** SPLIT_PUSH: melee DPS away from the push target; HEALER_TRAINED: the healer */
  playersInvolved?: string[];
  /** HEALER_TRAINED: true when the trained healer IS the log owner */
  ownerIsSubject?: boolean;
  /** Optional: Healer exposure status during the burst window (owner is healer only) */
  healerExposureLabel?: HealerExposureLabel;
}

interface INearestEnemy {
  distanceYards: number;
  enemyName: string;
}

/** True when the unit has died at or before the given timestamp. A corpse's
 *  last-known position is returned by getUnitPositionAtTime indefinitely, so
 *  dead enemies must be excluded from distance checks. */
function isDeadAt(unit: ICombatUnit, tMs: number): boolean {
  return (unit.deathRecords ?? []).some((d) => d.timestamp <= tMs);
}

function nearestEnemyAt(
  enemies: ICombatUnit[],
  ownerPos: { x: number; y: number } | null,
  tMs: number,
  ownerUnit: ICombatUnit,
): INearestEnemy | null {
  const pos =
    ownerPos ?? getUnitPositionAtTime(ownerUnit, tMs, POSITION_MAX_GAP_MS);
  if (!pos) return null;
  let best: INearestEnemy | null = null;
  for (const enemy of enemies) {
    if (isDeadAt(enemy, tMs)) continue;
    const enemyPos = getUnitPositionAtTime(enemy, tMs, POSITION_MAX_GAP_MS);
    if (!enemyPos) continue;
    const d = distanceBetween(pos, enemyPos);
    if (best === null || d < best.distanceYards) {
      best = { distanceYards: d, enemyName: enemy.name };
    }
  }
  return best;
}

/** Seconds of [fromSeconds, toSeconds] during which the owner was in hard CC.
 *  Overlapping CC instances (simultaneous stun + silence) are merged, not
 *  summed — otherwise stacked CCs could exceed the window length. */
function ccOverlapSeconds(
  ccInstances: Array<Pick<ICCInstance, "atSeconds" | "durationSeconds">>,
  fromSeconds: number,
  toSeconds: number,
): number {
  const clipped = ccInstances
    .map((cc) => ({
      from: Math.max(fromSeconds, cc.atSeconds),
      to: Math.min(toSeconds, cc.atSeconds + cc.durationSeconds),
    }))
    .filter((iv) => iv.to > iv.from)
    .sort((a, b) => a.from - b.from);

  let total = 0;
  let curFrom = -Infinity;
  let curTo = -Infinity;
  for (const iv of clipped) {
    if (iv.from > curTo) {
      total += curTo - curFrom > 0 ? curTo - curFrom : 0;
      curFrom = iv.from;
      curTo = iv.to;
    } else {
      curTo = Math.max(curTo, iv.to);
    }
  }
  total += curTo - curFrom > 0 ? curTo - curFrom : 0;
  return total;
}

function isAvailableAt(cd: IMajorCooldownInfo, atSeconds: number): boolean {
  return cd.availableWindows.some(
    (w) => atSeconds >= w.fromSeconds && atSeconds <= w.toSeconds,
  );
}

export function computeOwnerPositionEvents(params: {
  owner: ICombatUnit;
  enemies: ICombatUnit[];
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime">;
  burstWindows: IAlignedBurstWindow[];
  ownerCooldowns: IMajorCooldownInfo[];
  ownerCCSummary?: {
    ccInstances: Array<Pick<ICCInstance, "atSeconds" | "durationSeconds">>;
  };
  isHealer: boolean;
  ownerIsMelee: boolean;
  /** Iter 3 (optional): full friendly team, used for SPLIT_PUSH / HEALER_TRAINED */
  friends?: ICombatUnit[];
  /** Iter 3 (optional): own-team offensive windows with their kill target */
  offensiveWindows?: Array<{
    fromSeconds: number;
    toSeconds: number;
    targetUnitId: string;
    targetName: string;
    friendlyOffensives: Array<{ playerName: string }>;
  }>;
  /** Iter 3 (optional): per-friend CC data so CC-locked players are not blamed */
  friendCCSummaries?: Array<{
    playerName: string;
    ccInstances: Array<Pick<ICCInstance, "atSeconds" | "durationSeconds">>;
  }>;
  healerExposures?: IHealerBurstExposure[];
  /** B4 fix (optional): damage-spike windows (pre-filtered to >= DMG_SPIKE_THRESHOLD by the
   * caller). When a spike overlaps a burst window, its targetName is the burst-target claim —
   * the SAME source the [OFFENSIVE WINDOW] timeline header renders — so the POSITIONING line
   * can never contradict the timeline about who the burst hit. */
  spikeWindows?: Array<{
    fromSeconds: number;
    toSeconds: number;
    targetName: string;
  }>;
}): IPositionEvent[] {
  const {
    owner,
    enemies,
    combat,
    burstWindows,
    ownerCooldowns,
    ownerCCSummary,
    isHealer,
    ownerIsMelee,
    friends,
    offensiveWindows,
    friendCCSummaries,
    healerExposures,
    spikeWindows,
  } = params;
  const matchStartMs = combat.startTime;
  const durationSeconds = (combat.endTime - combat.startTime) / 1000;
  const events: IPositionEvent[] = [];

  if ((owner.advancedActions ?? []).length === 0) return [];

  const ccInstances = ownerCCSummary?.ccInstances ?? [];
  const defensiveCDs = ownerCooldowns.filter((cd) => cd.tag === "Defensive");
  const offensiveCDs = ownerCooldowns.filter((cd) => cd.tag === "Offensive");

  // ── 1. Burst-window engagement: STAYED_IN / KITED ─────────────────────────
  for (const w of burstWindows) {
    const evalEnd = Math.min(w.toSeconds, w.fromSeconds + BURST_EVAL_SECONDS);
    const evalSpan = evalEnd - w.fromSeconds;
    if (evalSpan <= 0) continue;

    const exposure =
      isHealer && healerExposures
        ? healerExposures.find(
            (e) => Math.abs(e.atSeconds - w.fromSeconds) < 0.1,
          )
        : undefined;
    const healerExposureLabel = exposure?.exposureLabel;

    // CC'd for most of the window → could not choose to kite; not a decision
    if (ccOverlapSeconds(ccInstances, w.fromSeconds, evalEnd) >= evalSpan / 2)
      continue;

    const start = nearestEnemyAt(
      enemies,
      null,
      matchStartMs + w.fromSeconds * 1000,
      owner,
    );
    const end = nearestEnemyAt(
      enemies,
      null,
      matchStartMs + evalEnd * 1000,
      owner,
    );
    if (!start || !end) continue;
    if (start.distanceYards > CLOSE_RANGE_YARDS) continue; // was not in range to begin with

    // Sample every second across the window: hit-and-run kiting (out and back)
    // shows up as a mid-window peak that endpoint-only checks would miss.
    let maxDistance = Math.max(start.distanceYards, end.distanceYards);
    for (let t = Math.ceil(w.fromSeconds) + 1; t < evalEnd; t += 1) {
      const sample = nearestEnemyAt(
        enemies,
        null,
        matchStartMs + t * 1000,
        owner,
      );
      if (sample) maxDistance = Math.max(maxDistance, sample.distanceYards);
    }

    const delta = end.distanceYards - start.distanceYards;
    // B4 fix: prefer the overlapping damage-spike's target (identical ±5s overlap rule to the
    // [OFFENSIVE WINDOW] header in matchTimeline) so this line and the timeline can never
    // disagree about who the burst hit; fall back to the whole-window most-pressured unit.
    const overlappingSpike = spikeWindows?.find(
      (pw) =>
        pw.fromSeconds >= w.fromSeconds - 5 &&
        pw.fromSeconds <= w.toSeconds + 5,
    );
    const targetName =
      overlappingSpike?.targetName ?? w.mostPressuredTarget?.unitName;
    const burstTargetsOwner =
      targetName !== undefined ? targetName === owner.name : undefined;
    if (maxDistance - start.distanceYards >= KITE_DELTA_YARDS) {
      events.push({
        type: "KITED",
        atSeconds: w.fromSeconds,
        toSeconds: evalEnd,
        startDistanceYards: Math.round(start.distanceYards * 10) / 10,
        // Peak distance, not endpoint — a hit-and-run kite re-engages before the window ends
        endDistanceYards: Math.round(maxDistance * 10) / 10,
        nearestEnemyName: start.enemyName,
        dangerLabel: w.dangerLabel,
        dampeningPct: w.dampeningPct,
        burstTargetsOwner,
        burstTargetName: burstTargetsOwner === false ? targetName : undefined,
        healerExposureLabel,
      });
    } else if (delta < STAY_DELTA_YARDS) {
      // Who was the burst actually aimed at? A melee DPS staying on their target
      // while the burst hits a teammate is normal offense, not a mistake — suppress.
      // Healers/ranged near an enemy during any burst remain worth surfacing, annotated.
      if (ownerIsMelee && !isHealer && burstTargetsOwner === false) continue;

      // The OUTCOME: did staying in actually cost HP? This is what turns STAYED_IN
      // from a hedge-pileup into a checkable finding — a coach should only fault a
      // stay that dropped the owner low, not one that cost nothing.
      const hpStart = getUnitHpAtTimestamp(
        owner,
        matchStartMs + w.fromSeconds * 1000,
        POSITION_MAX_GAP_MS,
      );
      let hpMin = hpStart;
      for (let t = Math.ceil(w.fromSeconds); t <= evalEnd; t += 1) {
        const hp = getUnitHpAtTimestamp(
          owner,
          matchStartMs + t * 1000,
          POSITION_MAX_GAP_MS,
        );
        if (hp !== null && (hpMin === null || hp < hpMin)) hpMin = hp;
      }

      events.push({
        type: "STAYED_IN",
        atSeconds: w.fromSeconds,
        toSeconds: evalEnd,
        startDistanceYards: Math.round(start.distanceYards * 10) / 10,
        endDistanceYards: Math.round(end.distanceYards * 10) / 10,
        nearestEnemyName: start.enemyName,
        dangerLabel: w.dangerLabel,
        dampeningPct: w.dampeningPct,
        ownerDefensiveAvailable:
          defensiveCDs.length > 0
            ? defensiveCDs.some((cd) => isAvailableAt(cd, w.fromSeconds))
            : undefined,
        burstTargetsOwner,
        burstTargetName: burstTargetsOwner === false ? targetName : undefined,
        ownerHpStartPct: hpStart === null ? null : Math.round(hpStart),
        ownerHpMinPct: hpMin === null ? null : Math.round(hpMin),
        healerExposureLabel,
      });
    }
    // deltas in [STAY_DELTA, KITE_DELTA) are ambiguous — no event
  }

  // ── 2. MISSED_PUSH: offensive CDs up, no enemy burst, parked far away ─────
  if (!isHealer && offensiveCDs.length > 0) {
    const threshold = ownerIsMelee
      ? MISSED_PUSH_MELEE_YARDS
      : MISSED_PUSH_RANGED_YARDS;
    const enemyDeathTimes = enemies.flatMap((e) =>
      (e.deathRecords ?? []).map((d) => (d.timestamp - matchStartMs) / 1000),
    );

    let runStart: number | null = null;
    let runMinDist = Infinity;
    let missedPushCount = 0;

    const closeRun = (endSeconds: number) => {
      if (
        runStart !== null &&
        endSeconds - runStart >= MISSED_PUSH_MIN_SECONDS &&
        missedPushCount < MAX_MISSED_PUSH_EVENTS
      ) {
        events.push({
          type: "MISSED_PUSH",
          atSeconds: runStart,
          toSeconds: endSeconds,
          startDistanceYards: Math.round(runMinDist * 10) / 10,
        });
        missedPushCount++;
      }
      runStart = null;
      runMinDist = Infinity;
    };

    // MISSED_PUSH asserts ">threshold from ALL enemies" — that claim needs every
    // living enemy's position to be known. A stealthed/idle enemy (no recent
    // snapshots) could be anywhere, including on top of the owner.
    const allLivingEnemiesKnownAt = (tMs: number) =>
      enemies.every(
        (e) =>
          isDeadAt(e, tMs) ||
          getUnitPositionAtTime(e, tMs, POSITION_MAX_GAP_MS) !== null,
      );

    for (let t = 0; t <= durationSeconds; t += 1) {
      const tMs = matchStartMs + t * 1000;
      const allOffensivesReady = offensiveCDs.every((cd) =>
        isAvailableAt(cd, t),
      );
      const inBurst = burstWindows.some(
        (w) => t >= w.fromSeconds && t <= w.toSeconds,
      );
      const nearKill = enemyDeathTimes.some(
        (d) => t >= d - KILL_PROXIMITY_SECONDS && t <= d,
      );
      const nearest =
        allOffensivesReady &&
        !inBurst &&
        !nearKill &&
        allLivingEnemiesKnownAt(tMs)
          ? nearestEnemyAt(enemies, null, tMs, owner)
          : null;

      if (nearest && nearest.distanceYards > threshold) {
        if (runStart === null) runStart = t;
        runMinDist = Math.min(runMinDist, nearest.distanceYards);
      } else {
        closeRun(t);
      }
    }
    closeRun(durationSeconds);
  }

  // ── 3. CD_OUT_OF_RANGE: offensive CD cast far from every enemy ────────────
  if (!isHealer) {
    for (const cd of offensiveCDs) {
      for (const cast of cd.casts) {
        const atCast = nearestEnemyAt(
          enemies,
          null,
          matchStartMs + cast.timeSeconds * 1000,
          owner,
        );
        if (!atCast || atCast.distanceYards <= CD_RANGE_YARDS) continue;
        const later = nearestEnemyAt(
          enemies,
          null,
          matchStartMs + (cast.timeSeconds + CD_RANGE_RECHECK_SECONDS) * 1000,
          owner,
        );
        // Only flag when still out of range shortly after — a cast mid-approach that
        // connects within seconds is normal play, not wasted uptime.
        if (later && later.distanceYards > CD_RANGE_YARDS) {
          events.push({
            type: "CD_OUT_OF_RANGE",
            atSeconds: cast.timeSeconds,
            startDistanceYards: Math.round(atCast.distanceYards * 10) / 10,
            nearestEnemyName: atCast.enemyName,
            spellName: cd.spellName,
          });
        }
      }
    }
  }

  // ── 4. Iter 3: SPLIT_PUSH — a melee DPS away from the target during a committed push ──
  if (friends && offensiveWindows) {
    const ccByName = new Map(
      (friendCCSummaries ?? []).map((c) => [c.playerName, c.ccInstances]),
    );
    let splitCount = 0;
    for (const w of offensiveWindows) {
      if (splitCount >= MAX_ITER3_EVENTS) break;
      if ((w.friendlyOffensives ?? []).length < 2) continue; // not a committed push

      const target =
        enemies.find((e) => e.id === w.targetUnitId) ??
        enemies.find((e) => e.name === w.targetName);
      if (!target || isDeadAt(target, matchStartMs + w.fromSeconds * 1000))
        continue;

      const meleeDps = friends.filter(
        (f) => isMeleeSpec(f.spec) && !isHealerSpec(f.spec),
      );
      if (meleeDps.length < 2) continue; // convergence is only positionally checkable for melee

      const evalEnd = Math.min(w.toSeconds, w.fromSeconds + BURST_EVAL_SECONDS);
      const sampleTimes = [w.fromSeconds + 2, (w.fromSeconds + evalEnd) / 2];
      const onTarget: string[] = [];
      const awol: string[] = [];
      for (const dps of meleeDps) {
        if (isDeadAt(dps, matchStartMs + w.fromSeconds * 1000)) continue;
        // CC-locked for most of the evaluated span → could not converge; not a decision
        const cc = ccByName.get(dps.name) ?? [];
        if (
          ccOverlapSeconds(cc, w.fromSeconds, evalEnd) >=
          (evalEnd - w.fromSeconds) / 2
        )
          continue;

        const dists = sampleTimes.map((t) => {
          const tMs = matchStartMs + t * 1000;
          // A mid-window death (successful kill, or this DPS dying) leaves a corpse
          // position — distances to/from it would falsely read as abandoning the push.
          if (isDeadAt(target, tMs) || isDeadAt(dps, tMs)) return null;
          const dpsPos = getUnitPositionAtTime(dps, tMs, POSITION_MAX_GAP_MS);
          const tgtPos = getUnitPositionAtTime(
            target,
            tMs,
            POSITION_MAX_GAP_MS,
          );
          return dpsPos && tgtPos ? distanceBetween(dpsPos, tgtPos) : null;
        });
        if (dists.some((d) => d === null)) continue; // unreliable positions — no claim
        if (dists.every((d) => (d as number) <= PUSH_ON_TARGET_YARDS))
          onTarget.push(dps.name);
        else if (dists.every((d) => (d as number) > PUSH_AWOL_YARDS))
          awol.push(dps.name);
      }

      if (onTarget.length >= 1 && awol.length >= 1) {
        events.push({
          type: "SPLIT_PUSH",
          atSeconds: w.fromSeconds,
          toSeconds: w.toSeconds,
          nearestEnemyName: w.targetName,
          playersInvolved: awol,
        });
        splitCount++;
      }
    }
  }

  // ── 5. Iter 3: HEALER_TRAINED — enemy melee camping the friendly healer ───
  if (friends) {
    const healerUnit = friends.find((f) => isHealerSpec(f.spec));
    const enemyMelee = enemies.filter(
      (e) => isMeleeSpec(e.spec) && !isHealerSpec(e.spec),
    );
    if (
      healerUnit &&
      enemyMelee.length > 0 &&
      (healerUnit.advancedActions ?? []).length > 0
    ) {
      // The healer's own CC — a healer CC-locked through the camp can't self-peel
      // or reposition, so "reposition opportunity" would be a false criticism.
      const healerCC =
        (friendCCSummaries ?? []).find((c) => c.playerName === healerUnit.name)
          ?.ccInstances ?? [];
      let runStart: number | null = null;
      const trainerSeconds = new Map<string, number>();
      // T3 grounding:"camped by X (closest N yd)" 的 N 必须是 X 自己的最近距离——
      // 此前 N 取任意近战的全局最小,与具名 trainer 张冠李戴(扫描器实锤 2 例)。
      const trainerMinDist = new Map<string, number>();
      let trainedCount = 0;

      const closeTrainRun = (endSeconds: number) => {
        if (
          runStart !== null &&
          endSeconds - runStart >= HEALER_TRAINED_MIN_SECONDS &&
          trainedCount < MAX_ITER3_EVENTS
        ) {
          let topTrainer = "";
          let topSeconds = -1;
          for (const [name, secs] of trainerSeconds) {
            if (secs > topSeconds) {
              topTrainer = name;
              topSeconds = secs;
            }
          }
          events.push({
            type: "HEALER_TRAINED",
            atSeconds: runStart,
            toSeconds: endSeconds,
            nearestEnemyName: topTrainer,
            startDistanceYards:
              Math.round((trainerMinDist.get(topTrainer) ?? Infinity) * 10) /
              10,
            playersInvolved: [healerUnit.name],
            ownerIsSubject: healerUnit.id === owner.id,
            ownerCcLocked:
              ccOverlapSeconds(healerCC, runStart, endSeconds) >=
              (endSeconds - runStart) / 2,
          });
          trainedCount++;
        }
        runStart = null;
        trainerSeconds.clear();
        trainerMinDist.clear();
      };

      for (let t = 0; t <= durationSeconds; t += 1) {
        const tMs = matchStartMs + t * 1000;
        const healerPos = getUnitPositionAtTime(
          healerUnit,
          tMs,
          POSITION_MAX_GAP_MS,
        );
        let camped = false;
        if (healerPos && !isDeadAt(healerUnit, tMs)) {
          let bestDist = Infinity;
          let bestName = "";
          const perEnemyDist = new Map<string, number>();
          for (const e of enemyMelee) {
            if (isDeadAt(e, tMs)) continue;
            const ePos = getUnitPositionAtTime(e, tMs, POSITION_MAX_GAP_MS);
            if (!ePos) continue;
            const d = distanceBetween(healerPos, ePos);
            perEnemyDist.set(e.name, d);
            if (d < bestDist) {
              bestDist = d;
              bestName = e.name;
            }
          }
          if (bestDist <= HEALER_TRAINED_YARDS) {
            camped = true;
            if (runStart === null) runStart = t;
            trainerSeconds.set(
              bestName,
              (trainerSeconds.get(bestName) ?? 0) + 1,
            );
            // 每个近战都记「自己」的窗口最近距离——具名 trainer 的 closest 不能
            // 被"当秒另有更近者"挡掉(扫描器实锤 5.7 vs 实际 2.7)
            for (const [name, d] of perEnemyDist) {
              trainerMinDist.set(
                name,
                Math.min(trainerMinDist.get(name) ?? Infinity, d),
              );
            }
          }
        }
        if (!camped) closeTrainRun(t);
      }
      closeTrainRun(durationSeconds);
    }
  }

  return events.sort((a, b) => a.atSeconds - b.atSeconds);
}

// ─── Formatter ───────────────────────────────────────────────────────────────

export function formatPositionEventsForContext(
  events: IPositionEvent[],
): string[] {
  if (events.length === 0) return [];

  const lines: string[] = [];
  lines.push(
    "POSITIONING (log owner only; distances from advanced-logging coordinates):",
  );

  const stayedIn = events.filter((e) => e.type === "STAYED_IN");
  const kited = events.filter((e) => e.type === "KITED");
  const missedPush = events.filter((e) => e.type === "MISSED_PUSH");
  const outOfRange = events.filter((e) => e.type === "CD_OUT_OF_RANGE");

  if (stayedIn.length > 0) {
    lines.push(
      "  STAYED IN during enemy burst (close range, little distance gained):",
    );
    for (const e of stayedIn) {
      const defStr =
        e.ownerDefensiveAvailable === undefined
          ? ""
          : e.ownerDefensiveAvailable
            ? " — a defensive CD was available"
            : " — no defensive CD available";
      const targetStr =
        e.burstTargetsOwner === true
          ? " — you were the burst target"
          : e.burstTargetName
            ? ` — burst targeted ${e.burstTargetName}, staying in may be deliberate`
            : "";
      // Lead with the HP OUTCOME when we have it — it's the fact that decides
      // whether the stay was a mistake, replacing the old hedge-pileup.
      let hpStr = "";
      if (e.ownerHpMinPct !== null && e.ownerHpMinPct !== undefined) {
        const tag =
          e.ownerHpMinPct <= STAYED_IN_NEAR_DEATH_PCT
            ? " (near-death — the stay was costly)"
            : !stayedInHadRealCost(e.ownerHpMinPct, e.ownerHpStartPct)
              ? " (no real cost)"
              : "";
        hpStr = ` — your HP ${e.ownerHpStartPct}%→${e.ownerHpMinPct}% (min over window)${tag}`;
      } else {
        // No HP data — fall back to the dampening context hedge.
        hpStr =
          (e.dampeningPct ?? 0) >= 0.2
            ? " (high dampening — staying in may be correct)"
            : "";
      }
      const exposureStr = e.healerExposureLabel
        ? ` — healer exposure: ${e.healerExposureLabel}`
        : "";
      // Render the full window span: the HP outcome is the MIN over
      // [atSeconds, toSeconds], and a bare start-time reads as "HP was X→Y at
      // that instant" — two separate LLM reviewers mis-anchored the min-HP to
      // the start second and called it a misattribution (2026-07-15).
      const spanStr =
        e.toSeconds !== undefined && e.toSeconds > e.atSeconds
          ? `${fmtTime(e.atSeconds)}–${fmtTime(e.toSeconds)}`
          : fmtTime(e.atSeconds);
      lines.push(
        `    ${spanStr} [${e.dangerLabel} burst] ${e.startDistanceYards}→${e.endDistanceYards}yd from ${e.nearestEnemyName}${targetStr}${exposureStr}${hpStr}${defStr}`,
      );
    }
  }

  if (kited.length > 0) {
    lines.push("  KITED during enemy burst (opened distance):");
    for (const e of kited) {
      const targetStr =
        e.burstTargetsOwner === true
          ? " — you were the burst target"
          : e.burstTargetName
            ? ` — burst targeted ${e.burstTargetName}, who may have needed heals/peels`
            : "";
      const exposureStr = e.healerExposureLabel
        ? ` — healer exposure: ${e.healerExposureLabel}`
        : "";
      lines.push(
        `    ${fmtTime(e.atSeconds)} [${e.dangerLabel} burst] opened ${e.startDistanceYards}→${e.endDistanceYards}yd from ${e.nearestEnemyName}${targetStr}${exposureStr}`,
      );
    }
  }

  if (missedPush.length > 0) {
    lines.push(
      "  MISSED PUSH (your offensive CDs available, no enemy burst, but disengaged):",
    );
    for (const e of missedPush) {
      lines.push(
        `    ${fmtTime(e.atSeconds)}–${fmtTime(e.toSeconds ?? e.atSeconds)} stayed >${e.startDistanceYards}yd from all enemies`,
      );
    }
  }

  if (outOfRange.length > 0) {
    lines.push(
      "  OFFENSIVE CD OUT OF RANGE (cast while far from every enemy):",
    );
    for (const e of outOfRange) {
      lines.push(
        `    ${fmtTime(e.atSeconds)} ${e.spellName} cast ${e.startDistanceYards}yd from nearest enemy (still >${CD_RANGE_YARDS}yd ${CD_RANGE_RECHECK_SECONDS}s later)`,
      );
    }
  }

  const splitPush = events.filter((e) => e.type === "SPLIT_PUSH");
  if (splitPush.length > 0) {
    lines.push(
      "  SPLIT PUSH (a melee DPS was away from the push target while offensive CDs were committed):",
    );
    for (const e of splitPush) {
      lines.push(
        `    ${fmtTime(e.atSeconds)}\u2013${fmtTime(e.toSeconds ?? e.atSeconds)} push on ${e.nearestEnemyName}: ${(e.playersInvolved ?? []).join(", ")} stayed >${PUSH_AWOL_YARDS}yd away \u2014 split pressure can be deliberate; verify intent`,
      );
    }
  }

  const trained = events.filter((e) => e.type === "HEALER_TRAINED");
  if (trained.length > 0) {
    lines.push(
      `  HEALER TRAINED (enemy melee camped the healer within ${HEALER_TRAINED_YARDS}yd):`,
    );
    for (const e of trained) {
      const subject = e.ownerIsSubject
        ? "you were"
        : `your healer (${(e.playersInvolved ?? [])[0] ?? "healer"}) was`;
      // A healer CC-locked through the camp can't self-reposition \u2014 team must peel.
      const advice = e.ownerCcLocked
        ? "CC-locked through this \u2014 team must peel (could not self-reposition)"
        : "peel or reposition opportunity";
      lines.push(
        `    ${fmtTime(e.atSeconds)}\u2013${fmtTime(e.toSeconds ?? e.atSeconds)} ${subject} camped by ${e.nearestEnemyName} (closest ${e.startDistanceYards}yd) \u2014 ${advice}`,
      );
    }
  }

  lines.push(
    "  Note: melee and ranged expected distances differ; treat these as engagement-state evidence, not verdicts.",
  );

  return lines;
}
