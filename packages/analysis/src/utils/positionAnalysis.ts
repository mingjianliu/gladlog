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

import { abilityProfile } from "../data/abilityProfile";
import { SUMMON_SPELL_IDS } from "../data/summonGenerated";
import { ICCInstance } from "./ccTrinketAnalysis";
import {
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  IMajorCooldownInfo,
  isHealerSpec,
  isMeleeSpec,
} from "./cooldowns";
import { fmtTime } from "./renderGrid";
import { IAlignedBurstWindow } from "./enemyCDs";
import {
  HealerExposureLabel,
  IHealerBurstExposure,
} from "./healerExposureAnalysis";
import { distanceBetween, getUnitPositionAtTime } from "./losAnalysis";
import { HEALER_TRAINED_YARDS, INTERP_MAX_GAP_MS } from "./positionSampling";
import { spellReachToAccuse } from "./spellRange";

// Thresholds (yards / seconds) — starting values from the Feature 15 spec.
//
// 2026-08-26 分布体检(GH #34 第三批;S2 快照 300 文件 / 1,679 owner-回合,
// 归档 100% 带位置数据,全表在 GH #34 评论)。当年拍的起始值逐条对上了分布,
// 无一改值:
//  · KITE=10 / STAY=5 落在爆发窗口拉距分布(n=2,077,近身开局)的 p66 / p39 ——
//    KITED 33.9%、STAYED_IN 38.7%、中间 27.4% 划为模糊带不出事件,是三分法;
//  · CD_RANGE=15 落在进攻 CD 施放距离分布(n=3,282)的 p81(越界 19.1%),
//    且 5s 复查门再砍一半(628 越界 → 305 仍越界),终曝光 ~9%;
//  · MELEE=20 ≈ 近战距离采样(n=18,566)的 p95(仅 4.8% 超)—— 尾部阈值;
//  · RANGED=45 仅 0.6% 采样超过(40yd 也才 1.2%)—— 保守到几乎只剩真离场,
//    与行尾「35–40 是正常满射程走位」的设计意图一致。
// 改任何一条前先重跑 scratchpad pos.mts 形态的分布脚本拿前后数字。
export const CLOSE_RANGE_YARDS = 12; // "in range" of an enemy — shared with rootReachability.ts (melee reach)
const KITE_DELTA_YARDS = 10; // distance gained that counts as a successful kite(p66,见上)
const STAY_DELTA_YARDS = 5; // distance gained below this = stayed in(p39,见上)
const MISSED_PUSH_MELEE_YARDS = 20; // melee parked beyond this = disengaged(≈p95,见上)
const MISSED_PUSH_RANGED_YARDS = 45; // ranged beyond this = disengaged (max cast range is 40yd — 35–40yd is normal max-range play;实测 0.6% 采样超过,见上)
// CD_OUT_OF_RANGE: per-spell reach (`cdOutOfRangeReachYards`) since W1f
// 2026-09-26; the old pooled 15 yd (p81 above) accused ranged specs.
const CD_RANGE_RECHECK_SECONDS = 5; // beyond reach at every second through this long after the cast
const BURST_EVAL_SECONDS = 10; // evaluate kite/stay over at most this much of the window
const MISSED_PUSH_MIN_SECONDS = 10; // sustained disengagement required
const KILL_PROXIMITY_SECONDS = 15; // ignore disengagement right before an enemy death
const MAX_MISSED_PUSH_EVENTS = 3;
// Iter 3 thresholds
const PUSH_ON_TARGET_YARDS = 12; // melee DPS counted "on the push target" within this
const PUSH_AWOL_YARDS = 20; // melee DPS beyond this during a committed push = split
// HEALER_TRAINED_YARDS (the radius that defines an enemy melee sitting on the
// healer) is imported from the single source positionSampling — the
// G2_TRAINED_DEFINITION check in the positioningScan gate validates exactly
// this definition.
const HEALER_TRAINED_MIN_SECONDS = 8; // sustained camping required
const MAX_ITER3_EVENTS = 2; // per event type
// Position snapshots are event-driven; when the query time is further than this
// from the nearest snapshot, the interpolated position is fabricated (unit was
// idle/stealthed/drinking) — treat as unknown.
// T3 grounding guard, same as ccTrinketAnalysis: never interpolate across the
// middle of a sampling gap (proven by a fabricated TRAINED 0.4yd claim)
const POSITION_MAX_GAP_MS = INTERP_MAX_GAP_MS;

/** STAYED_IN "有代价" 的唯一门(2026-08-20,GH #16 接地,用户裁定收紧):
 *  hpMin < 35 才算付出了真实代价。这是全库唯一有剂量-反应支撑的切点 ——
 *  n=2757 回合 / 821 条原始 STAYED_IN 实测:hpMin<35 桶 owner 15s 内死亡率
 *  15.6% / 回合败率 62.5%,而 35–85 区间死亡率 0–3%、败率不高于基线
 *  (49.8–43.6%),与 ≥85 桶(0.2%/50.1%)无法区分。旧豁免线 85/15
 *  (STAYED_IN_NO_COST_MIN_HP_PCT / MAX_DROP_PCT)因此退役:它放行的指控
 *  91%(314/346)落在无结果关联的区间。数字全文在 issue #16 的接地评论。 */
export const STAYED_IN_NEAR_DEATH_PCT = 35;

/**
 * Whether this STAYED_IN actually cost anything (single-source predicate).
 *
 * The context formatter uses it to decide whether to attach the
 * "(no real cost)" tag, and the deep-dive teachable-signal gate uses it to
 * decide whether to spend a model round on this positioning event — the same
 * fact must go through the same predicate.
 *
 * With no HP data we return true (assume there was a cost) — measured 0/821
 * occurrences on the grounding corpus (advanced logs always carry HP), so the
 * conservative default is behavior-neutral in practice.
 */
export function stayedInHadRealCost(
  hpMinPct: number | null | undefined,
  // hpStartPct 保留在签名里:旧判据用它算 drop,接地实测 drop 半件无增益
  // (p50=6,68.6% <15),新判据不再消费 —— 调用方无需改动。
  _hpStartPct?: number | null | undefined,
): boolean {
  if (hpMinPct === null || hpMinPct === undefined) return true;
  return hpMinPct < STAYED_IN_NEAR_DEATH_PCT;
}

export type PositionEventType =
  | "STAYED_IN"
  | "KITED"
  | "MISSED_PUSH"
  | "CD_OUT_OF_RANGE"
  | "SPLIT_PUSH"
  | "HEALER_TRAINED";

/**
 * The three positioning event types that are genuine mistakes (single-source
 * allowlist). Both deepDive.ts's teachable-signal gate and keyMoments.ts's
 * timeline filter consume this one Set — each of them used to hand-write its
 * own copy of the three literals, so adding/removing a type in one place let
 * the other drift silently (the gate predicate IS the spec).
 * KITED / SPLIT_PUSH / HEALER_TRAINED are NOT "mistakes" — they may be the
 * right call or simply unsalvageable. STAYED_IN additionally has to pass
 * `stayedInHadRealCost` (a real HP price was paid); that extra gate is applied
 * by each consumer and is deliberately not part of this Set.
 */
export const POSITION_MISTAKES: ReadonlySet<PositionEventType> = new Set([
  "STAYED_IN",
  "MISSED_PUSH",
  "CD_OUT_OF_RANGE",
]);

export interface IPositionEvent {
  type: PositionEventType;
  atSeconds: number;
  /** Window end for window-scoped events (STAYED_IN / KITED / MISSED_PUSH) */
  toSeconds?: number;
  startDistanceYards?: number;
  endDistanceYards?: number;
  /** STAYED_IN only (GH #103 A7): nearest-enemy distance range over the
   * window's whole-second samples plus both endpoints — the endpoints alone
   * ("8→3.3yd") read as "stayed within 3.3–8yd" when the owner had been at
   * 15yd mid-window. Nearest ENEMY, not the named one: the sweep asks who is
   * closest at each second, and that can change. */
  minDistanceYards?: number;
  maxDistanceYards?: number;
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
  /** HEALER_TRAINED only: merged hard-CC seconds inside the camp window
   *  (`ccOverlapSeconds`). GH #103: the line used to say "CC-locked through
   *  this" whenever this was ≥ half the window, and the responder quoted it as
   *  "CC-locked the whole time" beside the owner's own 1:08 Apotheosis. */
  ownerCcSeconds?: number;
  /** CD_OUT_OF_RANGE only */
  spellName?: string;
  /** CD_OUT_OF_RANGE only: the reach the claim was measured against
   *  (`cdOutOfRangeReachYards`, hitbox slack included) */
  reachYards?: number;
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
/** Shared with rootReachability.ts (2026-08-30). */
export function isDeadAt(unit: ICombatUnit, tMs: number): boolean {
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

/** Every living enemy has a known position at `tMs` — the precondition of any
 *  "far from ALL enemies" claim: a stealthed / idle enemy with no recent
 *  snapshot could be anywhere, including on top of the owner. Shared by
 *  MISSED_PUSH and CD_OUT_OF_RANGE. */
function allLivingEnemiesKnown(enemies: ICombatUnit[], tMs: number): boolean {
  return enemies.every(
    (e) =>
      isDeadAt(e, tMs) ||
      getUnitPositionAtTime(e, tMs, POSITION_MAX_GAP_MS) !== null,
  );
}

/**
 * The reach an out-of-range accusation may use for offensive cooldown X, or
 * null — abstain (reliability round 2 W1f, codex astra start review):
 *  - a summon (`SUMMON_SPELL_IDS`, DB2 SpellEffect 28): the payoff is a pet
 *    that walks or casts from range (ba44: Grimoire: Imp Lord at 21 yd, its
 *    Felbolts landing 2.3 s later);
 *  - a spell that does not itself hit an enemy (self / pet buff: Avatar,
 *    Combustion, Dark Transformation): distance at the press does not prove
 *    the buff was wasted;
 *  - a targeted / placed spell: its caster-aware reach plus the hitbox slack
 *    (`spellReachToAccuse`), null when range talents are unreadable.
 * The old single 15 yd (p81 of pooled melee + ranged casts) accused ranged
 * specs casting from normal range.
 */
export function cdOutOfRangeReachYards(
  owner: ICombatUnit,
  spellId: string,
): number | null {
  if (SUMMON_SPELL_IDS.has(spellId)) return null;
  if (!abilityProfile(spellId).hitsEnemy) return null;
  return spellReachToAccuse(owner, spellId);
}

/**
 * The instants CD_OUT_OF_RANGE samples for a press at `castSeconds`: the press
 * itself, every half-second grid point after it through
 * CD_RANGE_RECHECK_SECONDS later (so every rendered whole second is included,
 * and a connection between two of them is not skipped), and that endpoint.
 * codex astra review, W1f: sampling `cast + 1, cast + 2 …` from a 10.5 s press
 * never looked at 11.0 and missed a connection there.
 */
export function cdRangeSweepSeconds(castSeconds: number): number[] {
  const end = castSeconds + CD_RANGE_RECHECK_SECONDS;
  const out = [castSeconds];
  for (let t = Math.floor(castSeconds * 2 + 1) / 2; t < end; t += 0.5)
    if (t > castSeconds) out.push(t);
  out.push(end);
  return out;
}

/**
 * Every enemy stays beyond `reach` for the WHOLE of [castSeconds, castSeconds
 * + CD_RANGE_RECHECK_SECONDS] — not only at sampled instants (codex astra
 * review, W1f: a 0.25 s dip into reach between two half-second samples was
 * missed). Positions are linear between position events
 * (`getUnitPositionAtTime`), so the window is cut at every position event of
 * the owner and every enemy plus the rendered grid (`cdRangeSweepSeconds`);
 * on each piece both units move linearly and their closest approach is exact.
 * Any unknown position on the way (or an unpositioned living enemy at a
 * breakpoint) → false: the claim needs every enemy observed.
 */
export function beyondReachThroughout(
  owner: ICombatUnit,
  enemies: ICombatUnit[],
  matchStartMs: number,
  castSeconds: number,
  reach: number,
): boolean {
  const endSeconds = castSeconds + CD_RANGE_RECHECK_SECONDS;
  const cuts = new Set<number>(cdRangeSweepSeconds(castSeconds));
  const inWindow = (t: number) => t > castSeconds && t < endSeconds;
  const gapS = POSITION_MAX_GAP_MS / 1000;
  for (const u of [owner, ...enemies]) {
    const ts = (u.advancedActions ?? []).map(
      (a) => (a.timestamp - matchStartMs) / 1000,
    );
    for (let i = 0; i < ts.length; i++) {
      if (inWindow(ts[i]!)) cuts.add(ts[i]!);
      // An unknown stretch inside the window must be sampled, not bridged
      // (codex astra review): the middle of a gap longer than 2 × maxGap has
      // no position, nor has anything past the last event + maxGap — a cut
      // there makes getUnitPositionAtTime return null and the claim abstain.
      const next = ts[i + 1];
      if (next !== undefined && next - ts[i]! > 2 * gapS) {
        const mid = (ts[i]! + next) / 2;
        if (inWindow(mid)) cuts.add(mid);
      }
      if (next === undefined && inWindow(ts[i]! + gapS + 0.001))
        cuts.add(ts[i]! + gapS + 0.001);
    }
  }
  const times = [...cuts].sort((a, b) => a - b);
  for (const t of times)
    if (!allLivingEnemiesKnown(enemies, matchStartMs + t * 1000)) return false;
  for (let i = 1; i < times.length; i++) {
    const t0Ms = matchStartMs + times[i - 1]! * 1000;
    const t1Ms = matchStartMs + times[i]! * 1000;
    const a0 = getUnitPositionAtTime(owner, t0Ms, POSITION_MAX_GAP_MS);
    const a1 = getUnitPositionAtTime(owner, t1Ms, POSITION_MAX_GAP_MS);
    if (!a0 || !a1) return false;
    for (const e of enemies) {
      if (isDeadAt(e, t0Ms)) continue;
      const b0 = getUnitPositionAtTime(e, t0Ms, POSITION_MAX_GAP_MS);
      const b1 = getUnitPositionAtTime(e, t1Ms, POSITION_MAX_GAP_MS);
      if (!b0 || !b1) return false;
      // relative position r(s) = r0 + s·d, s ∈ [0, 1]: closest point to 0
      const r0x = b0.x - a0.x;
      const r0y = b0.y - a0.y;
      const dx = b1.x - a1.x - r0x;
      const dy = b1.y - a1.y - r0y;
      const dd = dx * dx + dy * dy;
      const sMin =
        dd > 0 ? Math.min(1, Math.max(0, -(r0x * dx + r0y * dy) / dd)) : 0;
      if (Math.hypot(r0x + sMin * dx, r0y + sMin * dy) <= reach) return false;
    }
  }
  return true;
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
  burstWindows: readonly IAlignedBurstWindow[];
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
    let minDistance = Math.min(start.distanceYards, end.distanceYards);
    for (let t = Math.ceil(w.fromSeconds) + 1; t < evalEnd; t += 1) {
      const sample = nearestEnemyAt(
        enemies,
        null,
        matchStartMs + t * 1000,
        owner,
      );
      if (sample) {
        maxDistance = Math.max(maxDistance, sample.distanceYards);
        minDistance = Math.min(minDistance, sample.distanceYards);
      }
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
      // HP freshness is NOT the position-interpolation grounding guard: this
      // renders "HP fell from X% to Y%" into the prompt, so it must use the
      // one shared radius every other rendered HP claim uses. Passing
      // POSITION_MAX_GAP_MS here (1.5s, a guard against fabricating a
      // coordinate across a sampling gap) was a 2026-07-14 copy-paste that the
      // same day's shared-sampler commit did not sweep.
      const hpStart = getUnitHpAtTimestamp(
        owner,
        matchStartMs + w.fromSeconds * 1000,
        HP_SAMPLE_RADIUS_MS,
      );
      let hpMin = hpStart;
      for (let t = Math.ceil(w.fromSeconds); t <= evalEnd; t += 1) {
        const hp = getUnitHpAtTimestamp(
          owner,
          matchStartMs + t * 1000,
          HP_SAMPLE_RADIUS_MS,
        );
        if (hp !== null && (hpMin === null || hp < hpMin)) hpMin = hp;
      }

      events.push({
        type: "STAYED_IN",
        atSeconds: w.fromSeconds,
        toSeconds: evalEnd,
        startDistanceYards: Math.round(start.distanceYards * 10) / 10,
        endDistanceYards: Math.round(end.distanceYards * 10) / 10,
        minDistanceYards: Math.round(minDistance * 10) / 10,
        maxDistanceYards: Math.round(maxDistance * 10) / 10,
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
    // living enemy's position to be known (`allLivingEnemiesKnown`).
    const allLivingEnemiesKnownAt = (tMs: number) =>
      allLivingEnemiesKnown(enemies, tMs);

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

  // ── 3. CD_OUT_OF_RANGE: offensive CD cast beyond its own reach ───────────
  // Out of reach of EVERY enemy at every whole second from the press through
  // CD_RANGE_RECHECK_SECONDS later (a connection at any sample in between is
  // normal play, not a wasted press), with every living enemy positioned at
  // each sample; the reach is the spell's own (`cdOutOfRangeReachYards`).
  if (!isHealer) {
    for (const cd of offensiveCDs) {
      const reach = cdOutOfRangeReachYards(owner, cd.spellId);
      if (reach === null) continue;
      for (const cast of cd.casts) {
        const castMs = matchStartMs + cast.timeSeconds * 1000;
        const atCast = allLivingEnemiesKnown(enemies, castMs)
          ? nearestEnemyAt(enemies, null, castMs, owner)
          : null;
        if (
          atCast &&
          beyondReachThroughout(
            owner,
            enemies,
            matchStartMs,
            cast.timeSeconds,
            reach,
          )
        ) {
          events.push({
            type: "CD_OUT_OF_RANGE",
            atSeconds: cast.timeSeconds,
            startDistanceYards: Math.round(atCast.distanceYards * 10) / 10,
            nearestEnemyName: atCast.enemyName,
            spellName: cd.spellName,
            reachYards: Math.round(reach * 10) / 10,
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
      // T3 grounding: the N in "camped by X (closest N yd)" must be X's own
      // closest distance — it used to be the global minimum over ANY melee,
      // pinning another unit's number on the named trainer (2 cases proven by
      // the scanner).
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
            ownerCcSeconds: ccOverlapSeconds(healerCC, runStart, endSeconds),
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
            // Every melee records ITS OWN closest distance for the window —
            // the named trainer's closest must not be masked by "someone else
            // was nearer that second" (scanner proof: 5.7 reported vs 2.7
            // actual)
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

/** STAYED_IN's nearest-enemy range, only when the window left the endpoint
 * span (GH #103 A7); `from <name>` stays adjacent to "yd" for the G4 gate. */
function rangeStr(e: IPositionEvent): string {
  if (
    e.minDistanceYards === undefined ||
    e.maxDistanceYards === undefined ||
    e.startDistanceYards === undefined ||
    e.endDistanceYards === undefined
  )
    return "";
  const lo = Math.min(e.startDistanceYards, e.endDistanceYards);
  const hi = Math.max(e.startDistanceYards, e.endDistanceYards);
  if (e.minDistanceYards >= lo && e.maxDistanceYards <= hi) return "";
  return ` (nearest enemy ${e.minDistanceYards}–${e.maxDistanceYards}yd over the window)`;
}

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
        `    ${spanStr} [${e.dangerLabel} burst] ${e.startDistanceYards}→${e.endDistanceYards}yd from ${e.nearestEnemyName}${rangeStr(e)}${targetStr}${exposureStr}${hpStr}${defStr}`,
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
      "  OFFENSIVE CD OUT OF RANGE (cast beyond its own reach from every enemy):",
    );
    for (const e of outOfRange) {
      lines.push(
        `    ${fmtTime(e.atSeconds)} ${e.spellName} cast ${e.startDistanceYards}yd from nearest enemy (its reach ${e.reachYards}yd; beyond it through ${CD_RANGE_RECHECK_SECONDS}s later)`,
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
    // GH #36 item 3 (user ruling 2026-08-29): the per-line prescription
    // "peel or reposition opportunity" is replaced by the fact ("no CC on the
    // healer during this window") plus this ONE general rule under the
    // header. Probe (agy, 40 matches × 2): the prescription steered a
    // peel/reposition suggestion in ~1 match in 10; the fact wording alone
    // lost that (5 → 1 matches), the fact + this rule recovered it
    // (3 → 5 matches, window discussed 26 → 29) — same steering, one
    // judgment sentence instead of one per line (line-probe R2).
    lines.push(
      "    (rule: a healer camped by melee for this long, with no CC on them, is a peel / reposition opportunity for the team)",
    );
    for (const e of trained) {
      const subject = e.ownerIsSubject
        ? "you were"
        : `your healer (${(e.playersInvolved ?? [])[0] ?? "healer"}) was`;
      // A healer CC-locked through the camp can't self-reposition \u2014 team must peel.
      // The CC share is printed, not summarised: the lock predicate is "at
      // least half the window", and "CC-locked through this" read as all of it.
      const span = Math.round((e.toSeconds ?? e.atSeconds) - e.atSeconds);
      const ccRaw = e.ownerCcSeconds ?? 0;
      const ccS = ccRaw > 0 && ccRaw < 0.5 ? "<1" : String(Math.round(ccRaw));
      // "no CC" only when there was none: a 3 s stun inside the camp used to
      // render the same "no CC on the healer during this window" as zero.
      const advice = e.ownerCcLocked
        ? `CC'd ${ccS}s of ${span}s \u2014 team must peel (mostly could not self-reposition)`
        : ccRaw > 0
          ? `CC'd ${ccS}s of ${span}s`
          : "no CC on the healer during this window";
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
