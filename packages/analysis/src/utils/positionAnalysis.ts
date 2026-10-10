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
import { buildAuraIntervals } from "./auraIntervals";
import {
  buildCannotCastIntervals,
  coveredMsWithin,
  enemySourceIds,
} from "./cannotCastIntervals";
import { ICCInstance } from "./ccTrinketAnalysis";
import {
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  hpTroughInWindow,
  IMajorCooldownInfo,
  isHealerSpec,
  isMeleeSpec,
} from "./cooldowns";
import { IAlignedBurstWindow } from "./enemyCDs";
import { isOwnImmunityInterval } from "./enemyDefensives";
import {
  HealerExposureLabel,
  IHealerBurstExposure,
} from "./healerExposureAnalysis";
import { sumIncomingPressure } from "./incomingPressure";
import { distanceBetween, getUnitPositionAtTime } from "./losAnalysis";
import { HEALER_TRAINED_YARDS, INTERP_MAX_GAP_MS } from "./positionSampling";
import { fmtTime, toRenderSecond } from "./renderGrid";
import { buildRosterSides, type RosterSides } from "./rosterSide";
import { spellReachToAccuse } from "./spellRange";
import { isDeadAt } from "./unitDeath";

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
//
// FT-T12 D2 (2026-10-10): KITE / STAY / CLOSE_RANGE now read the distance to
// the span's MEASURED enemy (`spanMeasuredEnemy`: the enemy that hit the owner
// most, else the nearest), not to the nearest of any enemy at each instant.
// The values are unchanged and the p66 / p39 placement above was measured on
// the old quantity — it has NOT been re-measured on the new one.
export const CLOSE_RANGE_YARDS = 12; // "in range" of an enemy — shared with rootReachability.ts (melee reach)
const KITE_DELTA_YARDS = 10; // distance gained that counts as a successful kite(p66,见上)
const STAY_DELTA_YARDS = 5; // distance gained below this = stayed in(p39,见上)
/** KITED is the owner's doing only when the owner's Shapley share of the gap
 *  change to the start enemy (window start → peak second: the owner's move
 *  measured against the enemy's start spot and its peak spot, averaged) is
 *  at least this share of the distance opened — codex reviews of batch 10
 *  replaced the raw displacement and a one-ended difference, both of which
 *  credited a chase. Reliability round 2 F13 (c540): a Subtlety Rogue
 *  Hammer-of-Justice'd 92.69–97.18 s stood at (-282.4, -284.8) while the
 *  Paladin walked 10 yd away — rendered "KITED … opened 7→24.8yd". */
export const KITE_OWN_SHARE = 0.5;
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
   * 15yd mid-window. Nearest of ANY enemy, not the named one: the sweep asks
   * who is closest at each second, and that can change. It keeps that meaning
   * after FT-T12 D2 — the endpoints follow the measured enemy
   * (`spanMeasuredEnemy`), this range does not, so it can sit below both
   * endpoints when another enemy stood closer than the measured one. */
  minDistanceYards?: number;
  maxDistanceYards?: number;
  /** STAYED_IN / KITED: the enemy `startDistanceYards` is measured to. Since
   *  FT-T12 D2 (user ruling 2026-10-10) that is the span's measured enemy —
   *  the enemy player who dealt the most landed damage to the owner over the
   *  span (`spanMeasuredEnemy`) — and `endEnemyName` / `peakEnemyName` are
   *  then the same player. Only on the fallback (no enemy damage, a tie, no
   *  distance at an endpoint) is it what the name says: the enemy nearest at
   *  the span start. (CD_OUT_OF_RANGE / SPLIT_PUSH / HEALER_TRAINED reuse the
   *  field for their own subject.) */
  nearestEnemyName?: string;
  /** Burst window threat label for STAYED_IN / KITED */
  dangerLabel?: string;
  /** Dampening during the window (0–1), for the "staying in may be correct"
   * nuance. `null` = none stated at the window's start (a 2v2 round before
   * its first logged stack) — the nuance is then not printed. */
  dampeningPct?: number | null;
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
  /** STAYED_IN only: the TRUE minimum of the owner's HP inside the window
   *  (`hpTroughInWindow`: every sample, not only the whole-second readings)
   *  — FT-T03, user ruling 2026-10-10 (D7). Never above `ownerHpMinPct`.
   *
   *  This is the number the prompt PRINTS (the POSITIONING line's `A%→B%
   *  (min over window)`, position-mistake's `hpMin` fact). `ownerHpMinPct`
   *  stays the whole-second minimum and stays what every DECISION reads:
   *  `stayedInHadRealCost` for the menu gate and its ordering / cap, the
   *  "(near-death — the stay was costly)" tag, the desktop key moment, the
   *  deep-dive item and its teachable gate — so no position-mistake
   *  candidate appears or disappears with the ruling. */
  ownerHpLowPct?: number | null;
  /** HEALER_TRAINED only: healer was hard-CC'd for most of the camp → could not
   *  self-reposition (team must peel), so don't advise "reposition". */
  ownerCcLocked?: boolean;
  /** HEALER_TRAINED / STAYED_IN: merged hard-CC seconds inside the window
   *  (`ccOverlapSeconds`). GH #103: the HEALER TRAINED line used to say
   *  "CC-locked through this" whenever this was ≥ half the window, and the
   *  responder quoted it as "CC-locked the whole time" beside the owner's own
   *  1:08 Apotheosis. STAYED_IN (triage position F-S2): movement coaching was
   *  generated for spans the owner spent stunned. `undefined` = no CC summary
   *  was passed (unknown), never 0. */
  ownerCcSeconds?: number;
  /** STAYED_IN (F-S2): merged seconds of the span the owner was rooted
   *  (`analyzePlayerCCAndTrinket`'s `rootInstances`, same merge). `undefined`
   *  = no root summary was passed. */
  ownerRootSeconds?: number;
  /** STAYED_IN: merged seconds of the span the owner was hard-CC'd OR rooted
   *  — the union the two figures above overlap into (a root inside a stun
   *  counts in both). Set only when both summaries were passed. */
  ownerCcOrRootSeconds?: number;
  /** STAYED_IN (F-S5): merged seconds of the span the owner could not cast
   *  (`buildCannotCastIntervals` — CC, silence, kick lockout: the one
   *  feasibility predicate), read beside "a defensive CD was available". */
  ownerCannotCastSeconds?: number;
  /** STAYED_IN: the enemy `endDistanceYards` is measured to, and — when it
   *  is not `nearestEnemyName` — that start enemy's own distance at the end.
   *  The two names can differ only on the nearest-enemy fallback; a span
   *  measured to one enemy (`spanMeasuredEnemy`) names it at both ends. */
  endEnemyName?: string;
  startEnemyEndYards?: number;
  /** STAYED_IN (B-tier B24b): the enemy player who dealt the most landed
   *  damage to the owner over the span's rendered seconds, and that damage
   *  (`topEnemyDamagerInSpan`). The nearest enemy is often the enemy healer
   *  (2abc9185 @81: nearest = a Holy Priest with 8k of the 1.9M taken).
   *  Since FT-T12 D2 this is also the enemy the span's distances are
   *  measured to, unless the span fell back (`spanMeasuredEnemy`): a tie
   *  still prints its name-order pick here, and so does a top damager with
   *  no distance at an endpoint. */
  topDamagerName?: string;
  topDamagerDamage?: number;
  /** STAYED_IN: the owner's own straight-line displacement between the span's
   *  first and last render seconds. Reliability round 2 F13 (06bb): the owner
   *  walked ~18.5 yd while a Death Knight kept up, and "STAYED IN … little
   *  distance gained" was retold as "stood still" (原地硬抗). */
  ownerMovedYards?: number;
  /** KITED: when and from whom the peak distance (`endDistanceYards`) was
   *  measured — the measured enemy's peak (`spanMeasuredEnemy`), so
   *  `peakEnemyName` is `nearestEnemyName`; on the fallback, the peak of the
   *  nearest enemy at each second, who may be another one */
  peakSeconds?: number;
  peakEnemyName?: string;
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

/** Shared with rootReachability.ts (2026-08-30); the definition moved to the
 * leaf module `unitDeath.ts` (triage G4) so the modules below this one in the
 * import graph read the same predicate. */
export { isDeadAt };

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
 * B-tier B24b (user ruling 2026-10-06): the enemy PLAYER who dealt the most
 * landed damage to `owner` over the rendered seconds [fromRenderS, toRenderS]
 * (both whole seconds in full — the span a STAYED IN line prints), with that
 * damage. A pet's or summon's damage counts for its owner (`ownerId`); a
 * source that is neither an enemy player nor owned by one is ignored (a
 * charmed teammate, the owner's own deferred damage). Landed damage only —
 * what a shield absorbed is not in it. null when no enemy damage landed.
 * Ties go to the name that sorts first, so the two readers cannot differ.
 *
 * ONE predicate, two readers: the STAYED IN producer below (the rendered
 * line and the menu's `topDamager`) and the positioning gate's G4c, which
 * re-reads the rendered span and name and calls this again.
 */
export function topEnemyDamagerInSpan(
  owner: Pick<ICombatUnit, "damageIn">,
  enemies: ReadonlyArray<Pick<ICombatUnit, "id" | "name">>,
  allUnits: ReadonlyArray<Pick<ICombatUnit, "id" | "ownerId">>,
  matchStartMs: number,
  fromRenderS: number,
  toRenderS: number,
): { name: string; damage: number } | null {
  const enemyNameById = new Map(enemies.map((e) => [e.id, e.name]));
  const ownerOf = new Map(
    allUnits
      .filter((u) => u.ownerId && enemyNameById.has(u.ownerId))
      .map((u) => [u.id, u.ownerId as string]),
  );
  const fromMs = matchStartMs + fromRenderS * 1000;
  const toMs = matchStartMs + (toRenderS + 1) * 1000;
  const byEnemy = new Map<string, number>();
  for (const d of owner.damageIn ?? []) {
    const ts = d.logLine.timestamp;
    if (ts < fromMs || ts >= toMs) continue;
    const dmg = Math.abs(d.effectiveAmount);
    if (!(dmg > 0) || !d.srcUnitId) continue;
    const enemyId = enemyNameById.has(d.srcUnitId)
      ? d.srcUnitId
      : ownerOf.get(d.srcUnitId);
    if (!enemyId) continue;
    byEnemy.set(enemyId, (byEnemy.get(enemyId) ?? 0) + dmg);
  }
  let top: { name: string; damage: number } | null = null;
  for (const [id, damage] of byEnemy) {
    const name = enemyNameById.get(id)!;
    if (
      !top ||
      damage > top.damage ||
      (damage === top.damage && name < top.name)
    )
      top = { name, damage };
  }
  return top;
}

/** The rendered clause of a STAYED IN line for `topEnemyDamagerInSpan` — the
 *  producer writes it and the positioning gate's G4c parses it back. */
export const topDamagerClause = (name: string, damage: number): string =>
  ` — most damage to you in the span: ${name} (${Math.round(damage / 1000)}k)`;

/**
 * FT-T12 D2 (user ruling 2026-10-10, "option C"): the ONE enemy a STAYED IN /
 * KITED span measures its distances to — the enemy player who dealt the most
 * landed damage to the owner over the span's rendered seconds
 * (`topEnemyDamagerInSpan`, the B24b reading the STAYED IN line prints).
 *
 * null — the caller falls back, for the WHOLE span, to the nearest enemy at
 * each instant (the rule before the ruling) — when:
 *  - no enemy damage landed on the owner in the span;
 *  - two enemies tie for the most (a tie has no "the one who hit you most";
 *    `topEnemyDamagerInSpan`'s name-order tie-break is a rendering
 *    convention, not a reason to measure one of the two);
 *  - that enemy has no distance at the span's first or last rendered second
 *    (dead, or no position sample within POSITION_MAX_GAP_MS — the owner's
 *    own missing position counts too, and then the fallback has none either).
 *
 * Why: start, end and every mid-span sample used to read whoever stood
 * nearest at that instant, so "A→B yd" paired two enemies' distances (605
 * capture: 974 of 2,156 STAYED IN lines, 582 of 1,121 KITED lines; s0/1-6-16:
 * a druid went 3 → 21.9 yd while a paladin closed to 1.2 yd, read "stayed in
 * 3→1.2"). The 12 yd entry gate reads the measured enemy as well: a span
 * whose top damager starts beyond `CLOSE_RANGE_YARDS` yields no event — and
 * no position-mistake candidate — however close another enemy stood. The
 * user was shown that consequence on the 605 capture and accepted it:
 * position-mistake 341 rows → +8 / −150, every one `stayed-in`.
 *
 * ONE predicate, two readers: the producer below and the positioning gate's
 * G4d, which re-reads a STAYED IN line's rendered span and the name after
 * "from" and calls this again.
 */
export function spanMeasuredEnemy<E extends ICombatUnit>(
  owner: ICombatUnit,
  enemies: readonly E[],
  allUnits: ReadonlyArray<Pick<ICombatUnit, "id" | "ownerId">>,
  matchStartMs: number,
  fromRenderS: number,
  toRenderS: number,
): E | null {
  const read = (among: readonly E[]) =>
    topEnemyDamagerInSpan(
      owner,
      among,
      allUnits,
      matchStartMs,
      fromRenderS,
      toRenderS,
    );
  const top = read(enemies);
  const unit = top ? enemies.find((e) => e.name === top.name) : undefined;
  if (!top || !unit) return null;
  const runnerUp = read(enemies.filter((e) => e !== unit));
  if (runnerUp && runnerUp.damage === top.damage) return null;
  const hasDistanceAt = (renderS: number) =>
    nearestEnemyAt([unit], null, matchStartMs + renderS * 1000, owner) !== null;
  return hasDistanceAt(fromRenderS) && hasDistanceAt(toRenderS) ? unit : null;
}

/** The owner's straight-line displacement between two rendered seconds,
 *  one decimal — the "you moved N yd yourself (span start→end)" fact. The
 *  producer (STAYED IN) and the positioning gate's G4b both call this, at the
 *  rendered endpoints with the analysis' position gap (codex review of batch
 *  10: the gate checked every pairing within ±2 s at a 3 s gap, so a claim
 *  mutated 20 → 12 yd still passed). undefined when either end is unknown. */
export function ownerDisplacementYards(
  owner: ICombatUnit,
  matchStartMs: number,
  fromRenderS: number,
  toRenderS: number,
): number | undefined {
  const a = getUnitPositionAtTime(
    owner,
    matchStartMs + fromRenderS * 1000,
    POSITION_MAX_GAP_MS,
  );
  const b = getUnitPositionAtTime(
    owner,
    matchStartMs + toRenderS * 1000,
    POSITION_MAX_GAP_MS,
  );
  return a && b ? Math.round(distanceBetween(a, b) * 10) / 10 : undefined;
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

/**
 * "X" when the enemy measured at the end is still the start's, else "X→Y"
 * plus the start enemy's own end distance — the two distances of
 * "A→B yd from …" name whoever they were measured to (audit eb80: "10→2.1yd
 * from Pressbro" while Pressbro was 22.7 yd away and 2.1 yd was Mastutinho).
 * Since FT-T12 D2 a span measured to one enemy (`spanMeasuredEnemy`) always
 * prints the bare "X"; "X→Y" is left to the nearest-enemy fallback.
 * positioningScan G4 parses this form.
 */
export function stayedEndpointNames(
  e: Pick<
    IPositionEvent,
    "nearestEnemyName" | "endEnemyName" | "startEnemyEndYards"
  >,
): string {
  if (!e.endEnemyName || e.endEnemyName === e.nearestEnemyName)
    return `${e.nearestEnemyName}`;
  const own =
    e.startEnemyEndYards !== undefined
      ? ` (${e.nearestEnemyName} ${e.startEnemyEndYards}yd at the end)`
      : "";
  return `${e.nearestEnemyName}→${e.endEnemyName}${own}`;
}

/** KITED's B is the PEAK distance — to the span's measured enemy
 *  (`spanMeasuredEnemy`), or on the fallback to the nearest enemy at each
 *  second: say when, and from whom
 *  when it is not the start enemy. positioningScan G4 parses this form. */
export function kitedPeakStr(
  e: Pick<IPositionEvent, "nearestEnemyName" | "peakSeconds" | "peakEnemyName">,
): string {
  if (e.peakSeconds === undefined) return "";
  const who =
    e.peakEnemyName && e.peakEnemyName !== e.nearestEnemyName
      ? `, from ${e.peakEnemyName}`
      : "";
  return ` (peak at ${fmtTime(e.peakSeconds)}${who})`;
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

/** A header spike names the burst target of a POSITIONING line only when it
 *  covers at least this share of the line's own span (user ruling 2026-09-30,
 *  A′12; 4446729d: 1.26 s of 10 s is not "the burst of this span"). */
export const SPIKE_SPAN_MIN_SHARE = 0.5;

/** The friendly under the most incoming pressure in [fromMs, toMs] —
 *  `sumIncomingPressure` (damage taken + absorbed, same-side redistribution
 *  out), the one "how hard was this unit hit" predicate. `undefined` when no
 *  friendlies were passed or nobody was hit. Ties keep the roster order. */
export function mostPressuredInSpan(
  friends: readonly ICombatUnit[] | undefined,
  fromMs: number,
  toMs: number,
  sides?: RosterSides,
): string | undefined {
  let best: { name: string; pressure: number } | undefined;
  for (const f of friends ?? []) {
    const pressure = sumIncomingPressure(f, fromMs, toMs, sides);
    if (pressure > 0 && (!best || pressure > best.pressure))
      best = { name: f.name, pressure };
  }
  return best?.name;
}

function isAvailableAt(cd: IMajorCooldownInfo, atSeconds: number): boolean {
  return cd.availableWindows.some(
    (w) => atSeconds >= w.fromSeconds && atSeconds <= w.toSeconds,
  );
}

export function computeOwnerPositionEvents(params: {
  owner: ICombatUnit;
  enemies: ICombatUnit[];
  /** `units` (every AtomicArenaCombat has them) feeds the roster side and the
   *  enemy summons' ids; absent in bare fixtures, where the flag fallback and
   *  the enemy players alone are used. */
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime"> & {
    units?: Readonly<Record<string, ICombatUnit>>;
  };
  burstWindows: readonly IAlignedBurstWindow[];
  ownerCooldowns: IMajorCooldownInfo[];
  /** The owner's `analyzePlayerCCAndTrinket` summary. `rootInstances` (same
   *  summary) feed the STAYED_IN / KITED skip rule and the root seconds. */
  ownerCCSummary?: {
    ccInstances: Array<Pick<ICCInstance, "atSeconds" | "durationSeconds">>;
    rootInstances?: Array<{ atSeconds: number; durationSeconds: number }>;
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
  /** CC landed on each enemy (`analyzePlayerCCAndTrinket(enemy, friends…)`):
   *  a CC'd melee standing next to the healer is not camping them. */
  enemyCCSummaries?: Array<{
    playerName: string;
    ccInstances: Array<Pick<ICCInstance, "atSeconds" | "durationSeconds">>;
  }>;
  healerExposures?: IHealerBurstExposure[];
  /** B4 fix (optional): damage-spike windows (pre-filtered to >= DMG_SPIKE_THRESHOLD by the
   * caller) — the SAME source the [OFFENSIVE WINDOW] timeline header renders. A spike that
   * covers at least `SPIKE_SPAN_MIN_SHARE` of the line's own span names the burst target;
   * below that the target is the friendly under the most pressure in the span (ruling A′12),
   * so the POSITIONING line and the header CAN name different units for a short overlap. */
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
    enemyCCSummaries,
    healerExposures,
    spikeWindows,
  } = params;
  const matchStartMs = combat.startTime;
  const durationSeconds = (combat.endTime - combat.startTime) / 1000;
  const events: IPositionEvent[] = [];

  if ((owner.advancedActions ?? []).length === 0) return [];

  const ccInstances = ownerCCSummary?.ccInstances ?? [];
  const rootInstances = ownerCCSummary?.rootInstances;
  // The owner's OWN all-school immunities (Ice Block, Divine Shield, Aspect
  // of the Turtle): `isOwnImmunityInterval`.
  // (bare fixtures carry no aura stream)
  const ownImmunities = (
    owner.auraEvents ? buildAuraIntervals(owner, combat) : []
  )
    .filter((iv) => isOwnImmunityInterval(owner, iv))
    .map((iv) => ({ atSeconds: iv.fromS, durationSeconds: iv.toS - iv.fromS }));
  // No free choice of where to stand (user ruling 2026-09-30, A′13 = C):
  // hard CC, roots, and the owner's own immunity all enter the skip rule.
  const noChoiceIntervals = [
    ...ccInstances,
    ...(rootInstances ?? []),
    ...ownImmunities,
  ];
  const combatUnits = Object.values(combat.units ?? {});
  const rosterSides: RosterSides | undefined = combatUnits.length
    ? buildRosterSides(combatUnits)
    : undefined;
  const ownerCannotCast = buildCannotCastIntervals(
    owner,
    enemySourceIds(enemies, combatUnits),
  );
  // baseline-only rows are cd-hoarded's alone (ruling P-W6): "a defensive CD
  // was available" reads only buttons the owner showed this round
  const defensiveCDs = ownerCooldowns.filter(
    (cd) => cd.tag === "Defensive" && !cd.baselineOnly,
  );
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

    // CC'd, rooted or inside their own immunity for most of the window →
    // could not choose to kite (or had nothing to kite from); not a decision.
    // Dropped before the branch, so STAYED_IN and KITED both skip (A′13 = C:
    // dfcccbf2 2:54 Storm Bolt 3.0 s + own Ice Block 2.3 s of 10 s; fe1a9355
    // 1:03 rooted 6.0 of 10 s). A school-limited immunity does not count
    // (`isOwnImmunityInterval`): 06bb9860 3:17 own Spellwarding 6.0 of 10 s
    // keeps its line until the A30 / E24 damage-share predicate lands.
    if (
      ccOverlapSeconds(noChoiceIntervals, w.fromSeconds, evalEnd) >=
      evalSpan / 2
    )
      continue;

    // Every distance this line renders is sampled ON the render grid (whole
    // seconds, floored like fmtTime) — the gate re-checks the rendered second
    // (CLAUDE.md shared-predicate rule; codex astra review 2026-09-26: a
    // raw-instant sample plus the gate's 2 s slack let a moving enemy's 40 yd
    // pass for a 60 yd second).
    const tStart = toRenderSecond(w.fromSeconds);
    const tEnd = toRenderSecond(evalEnd);
    if (tEnd <= tStart) continue;
    // FT-T12 D2 (user ruling 2026-10-10): the start, the end and every
    // mid-span sample of this span read ONE enemy — the one that hit the
    // owner most over it (`spanMeasuredEnemy`, which also states the three
    // fallback cases) — so the STAYED_IN / KITED verdict, both rendered lines
    // and the position-mistake candidate built from the event cannot pair two
    // enemies' distances. On the fallback the WHOLE span reads the nearest
    // enemy at each instant, as it did before; the two rules are never mixed
    // inside one span.
    const nearestAt = (t: number) =>
      nearestEnemyAt(enemies, null, matchStartMs + t * 1000, owner);
    const measured = spanMeasuredEnemy(
      owner,
      enemies,
      combatUnits,
      matchStartMs,
      tStart,
      tEnd,
    );
    const sampleAt = measured
      ? (t: number) =>
          nearestEnemyAt([measured], null, matchStartMs + t * 1000, owner)
      : nearestAt;
    const start = sampleAt(tStart);
    const end = sampleAt(tEnd);
    if (!start || !end) continue;
    // The entry gate reads the measured enemy too (D2): the enemy hitting the
    // owner most was not in close range to begin with ⇒ no event, even with
    // another enemy on top of the owner.
    if (start.distanceYards > CLOSE_RANGE_YARDS) continue;

    // Sample every second across the window: hit-and-run kiting (out and back)
    // shows up as a mid-window peak that endpoint-only checks would miss.
    let maxDistance = Math.max(start.distanceYards, end.distanceYards);
    // `maxDistance` (the KITED peak) follows the sampled enemy; the STAYED IN
    // line's "(nearest enemy A–B yd over the window)" (`minDistance` /
    // `nearestMax`) keeps its own meaning — the nearest of ANY enemy at each
    // second — whichever rule measured the span.
    const nearestEnds = [nearestAt(tStart), nearestAt(tEnd)].flatMap((n) =>
      n ? [n.distanceYards] : [],
    );
    let nearestMax = Math.max(...nearestEnds);
    let minDistance = Math.min(...nearestEnds);
    // the peak's own identity and time (KITED renders it; audit 483f / eb80:
    // "A→B yd from X" used to pair X with another enemy's distance)
    let peak =
      end.distanceYards > start.distanceYards
        ? { d: end.distanceYards, enemy: end.enemyName, t: tEnd }
        : { d: start.distanceYards, enemy: start.enemyName, t: tStart };
    for (let t = tStart + 1; t < tEnd; t += 1) {
      const sample = sampleAt(t);
      const near = nearestAt(t);
      if (near) {
        nearestMax = Math.max(nearestMax, near.distanceYards);
        minDistance = Math.min(minDistance, near.distanceYards);
      }
      if (sample) {
        maxDistance = Math.max(maxDistance, sample.distanceYards);
        if (sample.distanceYards > peak.d)
          peak = { d: sample.distanceYards, enemy: sample.enemyName, t };
      }
    }
    // the start enemy's own distance at the end, when someone else is nearest
    // (fallback rule only: a measured span has one enemy at both ends)
    const startEnemy = enemies.find((e) => e.name === start.enemyName);
    const startEnemyEndPos =
      startEnemy && end.enemyName !== start.enemyName
        ? getUnitPositionAtTime(
            startEnemy,
            matchStartMs + tEnd * 1000,
            POSITION_MAX_GAP_MS,
          )
        : null;
    const ownerEndPos = getUnitPositionAtTime(
      owner,
      matchStartMs + tEnd * 1000,
      POSITION_MAX_GAP_MS,
    );
    const startEnemyEndYards =
      startEnemyEndPos && ownerEndPos
        ? Math.round(distanceBetween(ownerEndPos, startEnemyEndPos) * 10) / 10
        : undefined;

    const delta = end.distanceYards - start.distanceYards;
    // B4 fix: prefer the overlapping damage-spike's target (the ±5 s rule the
    // [OFFENSIVE WINDOW] header used until T12 ③ — the header now names a
    // spike through `creditSpikesToWindows`; this line keeps its own rule and
    // the A′12 half-span limit below, both feeding position-mistake);
    // fall back to the whole-window most-pressured unit.
    const overlappingSpike = spikeWindows?.find(
      (pw) =>
        pw.fromSeconds >= w.fromSeconds - 5 &&
        pw.fromSeconds <= w.toSeconds + 5,
    );
    // …but only while that spike is about THIS line's span (triage sync-burst
    // F-L2 + F-L2b, user ruling 2026-09-30 A′12): the spike array is not
    // time-ordered and the ±5 s rule admits a spike that starts after the
    // span ended (f4eb8c87 1:27–1:37 named a teammate hit at 1:42 while the
    // owner took 1.04M in the span). A spike covering less than half of the
    // span yields to the friendly under the most incoming pressure inside it.
    const spikeOverlapS = overlappingSpike
      ? Math.min(overlappingSpike.toSeconds, evalEnd) -
        Math.max(overlappingSpike.fromSeconds, w.fromSeconds)
      : -1;
    const spanTarget =
      overlappingSpike && spikeOverlapS >= evalSpan * SPIKE_SPAN_MIN_SHARE
        ? undefined
        : mostPressuredInSpan(
            friends,
            matchStartMs + w.fromSeconds * 1000,
            matchStartMs + evalEnd * 1000,
            rosterSides,
          );
    const targetName =
      spanTarget ??
      overlappingSpike?.targetName ??
      w.mostPressuredTarget?.unitName;
    const burstTargetsOwner =
      targetName !== undefined ? targetName === owner.name : undefined;
    // The owner's own displacement, on the same render-grid seconds.
    const ownerStartPos = getUnitPositionAtTime(
      owner,
      matchStartMs + tStart * 1000,
      POSITION_MAX_GAP_MS,
    );
    const ownerPeakPos =
      peak.t === tEnd
        ? ownerEndPos
        : getUnitPositionAtTime(
            owner,
            matchStartMs + peak.t * 1000,
            POSITION_MAX_GAP_MS,
          );
    // The distance the OWNER opened: from the start enemy's starting spot to
    // where the owner stood at the peak, minus the starting gap — the gap had
    // the enemy stood still. Displacement magnitude alone credited a chase
    // (codex review of batch 10: owner 0→10 yd after an enemy running 5→35
    // read "KITED 5→25yd"); on the fallback rule the peak is measured to the
    // nearest enemy, which may be another one, so this is the owner's own
    // share of the opening.
    const startEnemyStartPos = startEnemy
      ? getUnitPositionAtTime(
          startEnemy,
          matchStartMs + tStart * 1000,
          POSITION_MAX_GAP_MS,
        )
      : null;
    // …as the owner's Shapley share of the gap change: the average of what
    // the owner's move did with the enemy at its start spot and with the
    // enemy at its peak spot. Either end alone credits a chase (codex
    // re-check: owner 0→20 after an enemy 5→40 passed the old spot and read
    // +10), and a projection on the start direction zeroed lateral kites
    // around a pillar (KITED 1,056 → 512 on 605 files — pulled).
    const startEnemyPeakPos = startEnemy
      ? getUnitPositionAtTime(
          startEnemy,
          matchStartMs + peak.t * 1000,
          POSITION_MAX_GAP_MS,
        )
      : null;
    const ownerOpened =
      ownerStartPos && ownerPeakPos && startEnemyStartPos && startEnemyPeakPos
        ? (distanceBetween(ownerPeakPos, startEnemyStartPos) -
            distanceBetween(ownerStartPos, startEnemyStartPos) +
            (distanceBetween(ownerPeakPos, startEnemyPeakPos) -
              distanceBetween(ownerStartPos, startEnemyPeakPos))) /
          2
        : undefined;
    const ownerMovedToEnd = ownerDisplacementYards(
      owner,
      matchStartMs,
      tStart,
      tEnd,
    );
    const opened = maxDistance - start.distanceYards;
    if (opened >= KITE_DELTA_YARDS) {
      // Who moved (F13 c540): the enemy walking away from a stunned owner is
      // not a kite. Unknown owner position ⇒ no claim either way.
      if (ownerOpened === undefined || ownerOpened < opened * KITE_OWN_SHARE)
        continue;
      events.push({
        type: "KITED",
        atSeconds: w.fromSeconds,
        toSeconds: evalEnd,
        startDistanceYards: Math.round(start.distanceYards * 10) / 10,
        // Peak distance, not endpoint — a hit-and-run kite re-engages before the window ends
        endDistanceYards: Math.round(maxDistance * 10) / 10,
        nearestEnemyName: start.enemyName,
        peakSeconds: peak.t,
        peakEnemyName: peak.enemy,
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
      // FT-T03 (user ruling 2026-10-10, D7): the minimum a line or the menu
      // PRINTS is a trough — the true minimum of every sample inside the
      // window, not the lowest whole-second reading (`hpMin`, which stays
      // the decision's: see `ownerHpLowPct`). Same ticks as the loop above
      // (the whole seconds inside the window), plus every sample from the
      // window's start to its end.
      const trough =
        hpMin === null
          ? null
          : hpTroughInWindow(
              owner,
              matchStartMs,
              Math.ceil(w.fromSeconds),
              Math.floor(evalEnd),
              undefined,
              {
                fromMs: matchStartMs + Math.round(w.fromSeconds * 1000),
                toMs: matchStartMs + Math.round(evalEnd * 1000),
              },
            );
      const hpLow =
        hpMin === null
          ? null
          : trough === null
            ? hpMin
            : Math.min(hpMin, trough.pct);

      // B24b: who actually hit the owner over the rendered span
      const topDamager = topEnemyDamagerInSpan(
        owner,
        enemies,
        combatUnits,
        matchStartMs,
        tStart,
        tEnd,
      );
      events.push({
        type: "STAYED_IN",
        atSeconds: w.fromSeconds,
        toSeconds: evalEnd,
        startDistanceYards: Math.round(start.distanceYards * 10) / 10,
        endDistanceYards: Math.round(end.distanceYards * 10) / 10,
        minDistanceYards: Math.round(minDistance * 10) / 10,
        maxDistanceYards: Math.round(nearestMax * 10) / 10,
        nearestEnemyName: start.enemyName,
        endEnemyName: end.enemyName,
        ...(startEnemyEndYards !== undefined ? { startEnemyEndYards } : {}),
        ...(topDamager
          ? {
              topDamagerName: topDamager.name,
              topDamagerDamage: topDamager.damage,
            }
          : {}),
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
        ownerHpLowPct: hpLow === null ? null : Math.round(hpLow),
        ...(ownerMovedToEnd !== undefined
          ? { ownerMovedYards: ownerMovedToEnd }
          : {}),
        // three-state: no summary passed ⇒ unknown, not 0
        ...(ownerCCSummary
          ? {
              ownerCcSeconds: ccOverlapSeconds(
                ccInstances,
                w.fromSeconds,
                evalEnd,
              ),
            }
          : {}),
        ...(rootInstances
          ? {
              ownerRootSeconds: ccOverlapSeconds(
                rootInstances,
                w.fromSeconds,
                evalEnd,
              ),
              ownerCcOrRootSeconds: ccOverlapSeconds(
                [...ccInstances, ...rootInstances],
                w.fromSeconds,
                evalEnd,
              ),
            }
          : {}),
        ownerCannotCastSeconds:
          coveredMsWithin(
            ownerCannotCast,
            matchStartMs + w.fromSeconds * 1000,
            matchStartMs + evalEnd * 1000,
          ) / 1000,
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
      // each camper's own first / last second inside the radius this run:
      // the named camper's span, not the run's (codex review of batch 10 —
      // a warrior there 2 s was named for a 12 s run a rogue kept going)
      const trainerSpan = new Map<string, { from: number; to: number }>();
      // T3 grounding: the N in "camped by X (closest N yd)" must be X's own
      // closest distance — it used to be the global minimum over ANY melee,
      // pinning another unit's number on the named trainer (2 cases proven by
      // the scanner).
      const trainerMinDist = new Map<string, number>();
      let trainedCount = 0;
      const friendIds = new Set(friends.map((f) => f.id));
      const healerWasTopTarget = (
        trainerName: string,
        fromS: number,
        toS: number,
      ): boolean => {
        const trainer = enemyMelee.find((e) => e.name === trainerName);
        if (!trainer) return false;
        const fromMs = matchStartMs + fromS * 1000;
        const toMs = matchStartMs + toS * 1000;
        const byTarget = new Map<string, number>();
        for (const d of trainer.damageOut ?? []) {
          if (d.timestamp < fromMs || d.timestamp > toMs) continue;
          if (!d.destUnitId || !friendIds.has(d.destUnitId)) continue;
          byTarget.set(
            d.destUnitId,
            (byTarget.get(d.destUnitId) ?? 0) + Math.abs(d.amount),
          );
        }
        const onHealer = byTarget.get(healerUnit.id) ?? 0;
        if (onHealer <= 0) return false;
        for (const [id, dmg] of byTarget)
          if (id !== healerUnit.id && dmg > onHealer) return false;
        return true;
      };
      // A melee under our CC is not camping anyone (539f: Chaos Nova held the
      // rogue 114.84–119.35 s, half the "camp").
      const enemyCcOf = new Map(
        (enemyCCSummaries ?? []).map((c) => [c.playerName, c.ccInstances]),
      );
      const ccdAt = (name: string, tS: number): boolean =>
        (enemyCcOf.get(name) ?? []).some(
          (cc) => tS >= cc.atSeconds && tS < cc.atSeconds + cc.durationSeconds,
        );

      const closeTrainRun = (endSeconds: number) => {
        if (
          runStart !== null &&
          endSeconds - runStart >= HEALER_TRAINED_MIN_SECONDS &&
          trainedCount < MAX_ITER3_EVENTS
        ) {
          // the camper with the most seconds inside the radius among those
          // whose main target over the run was the healer
          const topTrainer =
            [...trainerSeconds]
              .filter(([, s]) => s >= HEALER_TRAINED_MIN_SECONDS)
              .sort((a, b) => b[1] - a[1])
              .map(([name]) => name)
              .find((name) => {
                const sp = trainerSpan.get(name)!;
                return healerWasTopTarget(name, sp.from, sp.to + 1);
              }) ?? "";
          // Proximity is not training (reliability round 2 F13, 539f): the
          // Assassination Rogue stood 3–9 yd from the Evoker while doing
          // 209k to the Havoc DH and 48k to the Evoker. The named camper
          // must have hit the healer at least as hard as any other friendly
          // over the run.
          if (!topTrainer) {
            runStart = null;
            trainerSeconds.clear();
            trainerSpan.clear();
            trainerMinDist.clear();
            return;
          }
          const span = trainerSpan.get(topTrainer)!;
          const spanFrom = span.from;
          const spanTo = Math.min(span.to + 1, endSeconds);
          events.push({
            type: "HEALER_TRAINED",
            atSeconds: spanFrom,
            toSeconds: spanTo,
            nearestEnemyName: topTrainer,
            startDistanceYards:
              Math.round((trainerMinDist.get(topTrainer) ?? Infinity) * 10) /
              10,
            playersInvolved: [healerUnit.name],
            ownerIsSubject: healerUnit.id === owner.id,
            ownerCcLocked:
              ccOverlapSeconds(healerCC, spanFrom, spanTo) >=
              (spanTo - spanFrom) / 2,
            ownerCcSeconds: ccOverlapSeconds(healerCC, spanFrom, spanTo),
          });
          trainedCount++;
        }
        runStart = null;
        trainerSeconds.clear();
        trainerSpan.clear();
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
          const perEnemyDist = new Map<string, number>();
          for (const e of enemyMelee) {
            if (isDeadAt(e, tMs)) continue;
            if (ccdAt(e.name, t)) continue;
            const ePos = getUnitPositionAtTime(e, tMs, POSITION_MAX_GAP_MS);
            if (!ePos) continue;
            const d = distanceBetween(healerPos, ePos);
            perEnemyDist.set(e.name, d);
            if (d < bestDist) bestDist = d;
          }
          if (bestDist <= HEALER_TRAINED_YARDS) {
            camped = true;
            if (runStart === null) runStart = t;
            // every melee within the radius counts its own seconds — not only
            // the nearest: a nearer melee hitting someone else must not hide
            // the one actually training the healer (codex review 2026-09-26
            // of batch 10: warrior on the healer + rogue at 2 yd hitting the
            // DH → no event at all)
            for (const [name, d] of perEnemyDist)
              if (d <= HEALER_TRAINED_YARDS) {
                trainerSeconds.set(name, (trainerSeconds.get(name) ?? 0) + 1);
                const sp = trainerSpan.get(name);
                if (sp) sp.to = t;
                else trainerSpan.set(name, { from: t, to: t });
              }
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

/** STAYED_IN: the owner's own displacement (render-grid span ends). The
 *  positioning gate re-derives it (G4 "you moved"). */
function movedStr(e: IPositionEvent): string {
  return e.ownerMovedYards === undefined
    ? ""
    : ` — you moved ${e.ownerMovedYards} yd yourself (span start→end)`;
}

/** STAYED_IN's nearest-enemy range, only when the window left the endpoint
 * span (GH #103 A7); `from <name>` stays adjacent to "yd" for the G4 gate. */
/** Seconds as the HEALER TRAINED line prints them: `<1` below half a second. */
function lockSeconds(s: number): string {
  return s > 0 && s < 0.5 ? "<1" : String(Math.round(s));
}

/** STAYED_IN: how much of the span the owner could not choose where to stand
 *  (triage position F-S2). After `movedStr`, so the positioning gate's
 *  "A→Byd from X" and "you moved … (span start→end)" anchors are untouched. */
function lockStr(e: IPositionEvent): string {
  const span = Math.round((e.toSeconds ?? e.atSeconds) - e.atSeconds);
  const cc = e.ownerCcSeconds ?? 0;
  const root = e.ownerRootSeconds ?? 0;
  // the two can overlap (a root inside a stun): with both printed, say how
  // long it was in all, so they are not read as a sum
  const both =
    cc > 0 && root > 0 && e.ownerCcOrRootSeconds !== undefined
      ? ` (${lockSeconds(e.ownerCcOrRootSeconds)}s in all)`
      : "";
  return (
    (cc > 0 ? ` — CC'd ${lockSeconds(cc)}s of ${span}s` : "") +
    (root > 0 ? ` — rooted ${lockSeconds(root)}s` : "") +
    both
  );
}

/** STAYED IN's "(nearest enemy A–Byd over the window)". The range is the
 *  nearest of ANY enemy at each second (`STAYED_IN_SECTION_HEADER` says so),
 *  the endpoints are the measured enemy's (FT-T12 D2): it prints when the
 *  range leaves the endpoint span, which now includes every span on which
 *  another enemy stood closer than the measured one. */
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

/**
 * The two section headers of the burst-span lines. They are the only place
 * the prompt says WHO "A→B yd from X" is measured to, so they state the rule
 * `spanMeasuredEnemy` implements (FT-T12 D2, user ruling 2026-10-10) and its
 * fallback, and that the STAYED IN range clause is a different reading.
 * Before the ruling the STAYED IN header read "an enemy stayed in close
 * range" — true of the nearest enemy at each end, which could be two players.
 * Neither header may contain the literal "most damage to you": that is the
 * anchor of a line's own `topDamagerClause`, which the positioning gate (G4c)
 * and the tests look for.
 */
export const STAYED_IN_SECTION_HEADER =
  "  STAYED IN during enemy burst (A→Byd = your distance, at the span's start and end, to the ONE enemy named after 'from' — the enemy who dealt you the most damage over the span; it started in close range and little distance was gained on it. When no enemy damage landed in the span, two enemies tied for the most, or that enemy had no position at either end, each end reads the nearest enemy at that second instead, and 'from X→Y' names both when they differ. '(nearest enemy A–Byd over the window)' is always the nearest of ANY enemy at each second, not the named one. The line says nothing about whether you moved; see 'you moved'):";
export const KITED_SECTION_HEADER =
  "  KITED during enemy burst (opened distance: A = your distance at the start to the ONE enemy named after 'from' — the enemy who dealt you the most damage over the span — and B = your largest distance to that same enemy, at the second in '(peak at m:ss)'. When no enemy damage landed in the span, two enemies tied for the most, or that enemy had no position at either end, A is the nearest enemy at the start and B the largest nearest-enemy distance, with ', from Z' naming the enemy at the peak when it is another one):";

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
    lines.push(STAYED_IN_SECTION_HEADER);
    for (const e of stayedIn) {
      // F-S5: availability is sampled at the span start; say how long of the
      // span the owner could not have pressed it
      const blockedS = e.ownerCannotCastSeconds ?? 0;
      const defStr =
        e.ownerDefensiveAvailable === undefined
          ? ""
          : e.ownerDefensiveAvailable
            ? ` — a defensive CD was available${blockedS >= 1 ? ` (you could not cast for ${Math.round(blockedS)}s of it)` : ""}`
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
        // One predicate for the tag and the menu gate (`stayedInHadRealCost`,
        // GH #16): at hpMin = 35 the old `<=` tagged "near-death" a stay the
        // gate did not count. The other side states the fact instead of the
        // verdict "(no real cost)" (user ruling 2026-09-30, A60 = B).
        //
        // FT-T03 (ruling D7): the PRINTED minimum is the trough
        // (`ownerHpLowPct`). The verdict tag is a decision and stays where
        // the menu gate is — on the grid minimum — so "the stay was costly"
        // is printed exactly on the stays the menu can list. The other tag
        // is a statement about the printed number and must be true of it: a
        // stay whose ticks stayed at or above the line while the trough went
        // under it prints neither (`90%→20% (min over window)`).
        const low = e.ownerHpLowPct ?? e.ownerHpMinPct;
        const tag = stayedInHadRealCost(e.ownerHpMinPct, e.ownerHpStartPct)
          ? " (near-death — the stay was costly)"
          : stayedInHadRealCost(low, e.ownerHpStartPct)
            ? ""
            : ` (HP stayed at or above ${STAYED_IN_NEAR_DEATH_PCT}%)`;
        hpStr = ` — your HP ${e.ownerHpStartPct}%→${low}% (min over window)${tag}`;
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
      // B24b: only on a span line (the gate re-reads both seconds)
      const topStr =
        e.topDamagerName !== undefined &&
        e.topDamagerDamage !== undefined &&
        spanStr.includes("–")
          ? topDamagerClause(e.topDamagerName, e.topDamagerDamage)
          : "";
      lines.push(
        `    ${spanStr} [${e.dangerLabel} burst] ${e.startDistanceYards}→${e.endDistanceYards}yd from ${stayedEndpointNames(e)}${rangeStr(e)}${movedStr(e)}${lockStr(e)}${targetStr}${exposureStr}${hpStr}${topStr}${defStr}`,
      );
    }
  }

  if (kited.length > 0) {
    lines.push(KITED_SECTION_HEADER);
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
        `    ${fmtTime(e.atSeconds)} [${e.dangerLabel} burst] opened ${e.startDistanceYards}→${e.endDistanceYards}yd from ${e.nearestEnemyName}${kitedPeakStr(e)}${targetStr}${exposureStr}`,
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
