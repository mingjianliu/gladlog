/**
 * kick-priority — GH #78 (2026-09-12, user "Ok" to start): the tutorial rules
 * say "the enemy healer finished a heal on your kill target and nobody
 * pressed the kick"; the archive said kick AVAILABILITY cannot be the
 * predicate (69 % of completed enemy hardcasts had a kick off cooldown, 38 per
 * round). So the decision point is narrow and target-referenced:
 *
 *   an enemy HEALER hardcast, started INSIDE one of our kill windows
 *   (`computeOffensiveWindows`), on a target the window names, while that
 *   target sat at ≤ KICK_PRIORITY_TARGET_HP_PCT (gridHpPct at the rendered
 *   second) — and, for each friendly with an interrupt, whether pressing it
 *   was actually possible: off cooldown (`computeEnemyInterruptAvailability`
 *   run on the friendly), not locked out (`buildCannotCastIntervals`), and
 *   inside the kick's OFFICIAL range (`spellRangeYards`, DB2 SpellRange —
 *   melee 5 yd + hitbox slack, ranged with line of sight via
 *   `canReachTargetAt`).
 *
 * Both outcomes of the cast are points: completed (the heal landed — the
 * `healAmount` is the SPELL_HEAL the healer put on the target right after
 * the cast) and interrupted (someone kicked it). The archive probe contrasts
 * the two (did the kill target die within 10 s); the product accuses only
 * the completed ones where the OWNER was feasible.
 *
 * The thresholds are hypotheses, not facts (skill: 用户给的数字是假设):
 * the probe reports sensitivity; the product keys on the constants here.
 */
import { getEnglishSpellName } from "../../data/spellEffectData";
import { MELEE_RANGE_YD,spellRangeYards } from "../../data/spellReach";
import { buildCannotCastIntervals } from "../../utils/cannotCastIntervals";
import { gridHpPct, isHealerSpec } from "../../utils/cooldowns";
import {
  computeEnemyInterruptAvailability,
  interruptForUnit,
} from "../../utils/enemyInterrupts";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "../../utils/losAnalysis";
import { computeOffensiveWindows } from "../../utils/offensiveWindows";
import { LOS_SWEEP_GAP_MS } from "../../utils/positionSampling";
import { toRenderSecond } from "../../utils/renderGrid";
import { canReachTargetAt } from "../../utils/rootReachability";
import { fmtFactNum as fmt, fmtFactTime } from "../factFormat";
import type { CandidateEvent } from "../types";

/** The kill target must be at or below this HP (rendered-second grid) when
 * the heal starts for the cast to be "the heal that mattered". Hypothesis. */
export const KICK_PRIORITY_TARGET_HP_PCT = 50;
/** A completed cast shorter than this was not reactable (instant-ish, or a
 * haste-shortened flash the kicker could not have seen). Hypothesis. */
export const KICK_PRIORITY_MIN_CAST_S = 1.0;
/** A "completed cast" longer than this is a mis-pair (a cancelled start
 * followed by a proc-instant SUCCESS of the same spell has no CAST_START of
 * its own): no arena heal hardcast runs this long. */
export const KICK_PRIORITY_MAX_CAST_S = 4;
/** Melee kicks: the feasibility question is "could this player have closed
 * to the healer within the cast", not "were they in 5 yd when it started" —
 * a rogue Shadowsteps, a DH Fel Rushes, everyone runs 7 yd/s for 1.2 s.
 * Corpus-calibrated (kickPriorityOutcomeProbe, 21,101 archive files,
 * 2026-09-12): distance kicker→healer at cast start for LANDED melee kicks,
 * n=909 — p50 8.0 yd, p90 22.8 yd, p95 27.1 yd. The official 5 yd + a 3 yd
 * hitbox slack covered only 50 % of kicks that actually landed, so it was
 * calling half of all real melee kicks "impossible". 20 yd ≈ the p85; a
 * melee kicker further than this at cast start is not accused. Ranged
 * kicks keep their official range (their p90s sit at 0.9× the SpellRange
 * value, i.e. sample staleness only). */
export const KICK_MELEE_REACH_YD = 20;
/** A cast that neither completed nor was interrupted within this is a
 * cancel / fake-cast, not a decision point. */
const CAST_PAIR_MAX_MS = 10_000;
/** SPELL_HEAL from the healer on the target within this after SPELL_CAST_SUCCESS. */
const HEAL_LAND_PAIR_MS = 500;
export const KICK_PRIORITY_CAP = 2;

export interface KickPriorityFriend {
  id: string;
  name: string;
  kickSpellId: string;
  kickSpellName: string;
  /** 0 = ready at cast start. */
  cdRemainingS: number;
  /** The friendly never cast this interrupt before the cast (#88: "ready"
   * here is an assumption, not an observation). */
  neverObserved: boolean;
  /** The friendly could not cast for the whole [start, end] of the cast. */
  locked: boolean;
  distanceYd: number | null;
  /** In official range (melee: + slack; ranged: with line of sight); null =
   * no position sample / unknown map. */
  inRange: boolean | null;
  feasible: boolean;
}

export interface IKickPriorityPoint {
  healerId: string;
  healerName: string;
  spellId: string;
  spellName: string;
  castStartS: number;
  castEndS: number;
  durationS: number;
  outcome: "completed" | "interrupted";
  interruptedById: string | null;
  interruptedByName: string | null;
  targetId: string;
  targetName: string;
  /** gridHpPct of the kill target at the rendered second of the cast start. */
  targetHpPct: number;
  /** Completed only: the SPELL_HEAL the healer landed on the target. */
  healAmount: number;
  windowFromS: number;
  windowToS: number;
  friends: KickPriorityFriend[];
}

interface UnitLike {
  id: string;
  name: string;
  ownerId: string;
  info?: unknown;
  spec: number;
  castStartEvents?: any[];
  spellCastEvents: any[];
  actionIn: any[];
  healOut: any[];
  advancedActions: any[];
}

export function kickPriorityDecisionPoints(
  friends: any[],
  enemies: any[],
  combat: {
    startTime: number;
    endTime: number;
    startInfo?: { zoneId?: string };
    units?: Record<string, any>;
  },
  overrides?: { targetHpPct?: number },
): IKickPriorityPoint[] {
  const out: IKickPriorityPoint[] = [];
  const hpGate = overrides?.targetHpPct ?? KICK_PRIORITY_TARGET_HP_PCT;
  const friendPlayers = (friends as UnitLike[]).filter((f) => f.info);
  const enemyPlayers = (enemies as UnitLike[]).filter((e) => e.info);
  if (friendPlayers.length === 0 || enemyPlayers.length === 0) return out;
  const startMs = combat.startTime;
  const rel = (ms: number) => (ms - startMs) / 1000;
  const zoneId = combat.startInfo?.zoneId;
  const enemyIds = new Set(enemyPlayers.map((e) => e.id));
  const friendIds = new Set(friendPlayers.map((f) => f.id));
  const units: UnitLike[] = Object.values(combat.units ?? {});
  const friendPetIds = new Set(
    units.filter((u) => !u.info && friendIds.has(u.ownerId)).map((u) => u.id),
  );
  const isFriendlySource = (id: string) =>
    friendIds.has(id) || friendPetIds.has(id);

  let windows: Array<{
    targetUnitId: string;
    fromSeconds: number;
    toSeconds: number;
  }>;
  try {
    windows = computeOffensiveWindows(
      enemyPlayers as never,
      friendPlayers as never,
      combat as never,
    );
  } catch {
    return out;
  }
  if (windows.length === 0) return out;
  const enemyById = new Map(enemyPlayers.map((e) => [e.id, e]));
  const healers = enemyPlayers.filter((e) => isHealerSpec(e.spec as never));
  const lockedCache = new Map<string, Array<{ from: number; to: number }>>();
  const lockedDuring = (f: UnitLike, a: number, b: number): boolean => {
    let iv = lockedCache.get(f.id);
    if (!iv) {
      try {
        iv = buildCannotCastIntervals(f as never, enemyIds);
      } catch {
        iv = [];
      }
      lockedCache.set(f.id, iv);
    }
    return iv.some((x) => x.from <= a && x.to >= b);
  };

  for (const healer of healers) {
    const starts = (healer.castStartEvents ?? []).filter(
      (e) => e.logLine.event === "SPELL_CAST_START",
    );
    if (starts.length === 0) continue;
    const successes = healer.spellCastEvents.filter(
      (e) => e.logLine.event === "SPELL_CAST_SUCCESS",
    );
    const interrupts = healer.actionIn.filter(
      (a) => a.logLine.event === "SPELL_INTERRUPT",
    );
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const sMs: number = s.logLine.timestamp;
      const sid: string = s.spellId ?? "";
      const nextStartMs: number = starts[i + 1]?.logLine.timestamp ?? Infinity;
      const hardLimit = Math.min(sMs + CAST_PAIR_MAX_MS, nextStartMs);
      const kick = interrupts.find(
        (a) =>
          a.logLine.timestamp >= sMs &&
          a.logLine.timestamp <= hardLimit &&
          a.extraSpellId === sid,
      );
      const done = successes.find(
        (c) =>
          c.spellId === sid &&
          c.logLine.timestamp >= sMs &&
          c.logLine.timestamp <= hardLimit,
      );
      let outcome: "completed" | "interrupted";
      let endMs: number;
      if (kick && (!done || kick.logLine.timestamp <= done.logLine.timestamp)) {
        outcome = "interrupted";
        endMs = kick.logLine.timestamp;
      } else if (done) {
        outcome = "completed";
        endMs = done.logLine.timestamp;
      } else continue; // cancelled / fake cast
      const durationS = (endMs - sMs) / 1000;
      if (outcome === "completed" && durationS < KICK_PRIORITY_MIN_CAST_S)
        continue;
      if (outcome === "completed" && durationS > KICK_PRIORITY_MAX_CAST_S)
        continue;
      const startS = rel(sMs);
      const w = windows.find(
        (x) => startS >= x.fromSeconds && startS <= x.toSeconds,
      );
      if (!w) continue;
      const target = enemyById.get(w.targetUnitId);
      if (!target) continue;
      const hp = gridHpPct(
        target as never,
        startMs + toRenderSecond(startS) * 1000,
      );
      if (hp == null || hp > hpGate) continue;

      // The cast has to be a HEAL that landed on the kill target: the
      // SPELL_HEAL the healer put on the target right after the cast, same
      // spell id (a Mind Blast / Smite hardcast is not a kick-priority point;
      // the tutorial rule is about the heal). effectiveAmount excludes
      // overheal, so a fully-overhealed cast is not "the heal that mattered".
      let healAmount = 0;
      if (outcome === "completed") {
        for (const h of healer.healOut ?? []) {
          const t = h.logLine.timestamp;
          if (
            h.destUnitId !== target.id ||
            h.spellId !== sid ||
            t < endMs ||
            t > endMs + HEAL_LAND_PAIR_MS
          )
            continue;
          if (h.logLine.event !== "SPELL_HEAL") continue;
          healAmount += Math.abs(h.effectiveAmount);
        }
        if (healAmount <= 0) continue;
      } else {
        // an interrupted cast: it must at least be a spell this healer heals
        // with somewhere in the round (observed, not a table)
        const healsWith = (healer.healOut ?? []).some(
          (h) => h.spellId === sid && h.logLine.event === "SPELL_HEAL",
        );
        if (!healsWith) continue;
      }

      const friendsOut: KickPriorityFriend[] = [];
      for (const f of friendPlayers) {
        const kit = interruptForUnit(f as never);
        if (!kit) continue;
        const avail = computeEnemyInterruptAvailability([f as never], sMs)[0];
        const cdRemainingS = avail?.cdRemainingSeconds ?? 0;
        const neverObserved = !f.spellCastEvents.some(
          (e) =>
            e.spellId === kit.spellId &&
            e.logLine.event === "SPELL_CAST_SUCCESS" &&
            e.logLine.timestamp < sMs,
        );
        const locked = lockedDuring(f, sMs, endMs);
        const pos = getUnitPositionAtTime(f as never, sMs, LOS_SWEEP_GAP_MS);
        const hpos = getUnitPositionAtTime(
          healer as never,
          sMs,
          LOS_SWEEP_GAP_MS,
        );
        const distanceYd = pos && hpos ? distanceBetween(pos, hpos) : null;
        const range = spellRangeYards(kit.spellId);
        let inRange: boolean | null = null;
        if (pos && range != null) {
          const melee = range <= MELEE_RANGE_YD;
          inRange = canReachTargetAt(
            pos,
            healer as never,
            sMs,
            zoneId,
            melee ? KICK_MELEE_REACH_YD : range,
            !melee,
          );
        }
        friendsOut.push({
          id: f.id,
          name: f.name,
          kickSpellId: kit.spellId,
          kickSpellName: kit.name,
          cdRemainingS,
          neverObserved,
          locked,
          distanceYd,
          inRange,
          // 2026-09-12 user correction ("奶龙和奶骑是没有打断的"): the kit table
          // is class-wide and stale; a kick this player NEVER cast in the
          // round is not evidence of a kick at all. Observed-or-nothing.
          feasible:
            !neverObserved && cdRemainingS <= 0 && !locked && inRange === true,
        });
      }

      const kicker = kick
        ? units.find((u) => u.id === kick.srcUnitId)
        : undefined;
      out.push({
        healerId: healer.id,
        healerName: healer.name,
        spellId: sid,
        spellName: getEnglishSpellName(sid, s.spellName ?? sid),
        castStartS: startS,
        castEndS: rel(endMs),
        durationS,
        outcome,
        interruptedById: kick
          ? isFriendlySource(kick.srcUnitId)
            ? kick.srcUnitId
            : kick.srcUnitId
          : null,
        interruptedByName:
          kicker?.name ?? (kick ? (kick.srcUnitName ?? null) : null),
        targetId: target.id,
        targetName: target.name,
        targetHpPct: hp,
        healAmount,
        windowFromS: w.fromSeconds,
        windowToS: w.toSeconds,
        friends: friendsOut,
      });
    }
  }
  return out.sort((a, b) => a.castStartS - b.castStartS);
}

/** The accusation predicate for the OWNER — one place, shared with the probe. */
export function isOwnerMissedKick(
  p: IKickPriorityPoint,
  ownerId: string,
): boolean {
  if (p.outcome !== "completed") return false;
  const me = p.friends.find((f) => f.id === ownerId);
  return Boolean(me && me.feasible);
}

export interface KickPriorityRef {
  /** completed vs interrupted casts in this state, kill-target death within 10 s */
  nCompleted: number;
  nInterrupted: number;
  deathCompletedPct: number;
  deathInterruptedPct: number;
}

const k = (x: number) => String(Math.round(x / 1000));

export function kickPriorityMissedEvents(
  points: IKickPriorityPoint[],
  owner: { id: string; name: string },
  probes: { lookup: () => KickPriorityRef | null },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? KICK_PRIORITY_CAP;
  const ref = probes.lookup();
  if (!ref) return [];
  const mine = points.filter((p) => isOwnerMissedKick(p, owner.id));
  const out: CandidateEvent[] = mine.map((p) => {
    const me = p.friends.find((f) => f.id === owner.id)!;
    const others = p.friends
      .filter((f) => f.id !== owner.id && f.feasible)
      .map((f) => f.name);
    return {
      id: `kick-priority-missed:${owner.id}:${Math.round(p.castStartS)}`,
      type: "kick-priority-missed",
      t: p.castStartS,
      unitNames: [p.healerName],
      spell: p.spellName,
      spellId: p.spellId,
      facts: {
        t: fmtFactTime(p.castStartS),
        healer: p.healerName,
        heal: p.spellName,
        castS: fmt(p.durationS),
        target: p.targetName,
        targetHpPct: String(p.targetHpPct),
        healK: k(p.healAmount),
        kick: me.kickSpellName,
        kickNeverUsed: me.neverObserved ? "yes" : "no",
        distanceYd:
          me.distanceYd == null ? "?" : String(Math.round(me.distanceYd)),
        othersFeasible: others.length ? others.join("; ") : "none",
        refNCompleted: String(ref.nCompleted),
        refNInterrupted: String(ref.nInterrupted),
        refDeathCompleted: String(ref.deathCompletedPct),
        refDeathInterrupted: String(ref.deathInterruptedPct),
      },
    };
  });
  return out
    .sort((a, b) => Number(b.facts.healK) - Number(a.facts.healK) || a.t - b.t)
    .slice(0, cap)
    .sort((a, b) => a.t - b.t);
}

/** The team form (user ruling 2026-09-12 (3) "也可以做 但是记得算距离"): the
 * OWNER could not kick (no interrupt / on cooldown / locked / out of range)
 * but ≥ 1 teammate was feasible by the same predicate — range included. A
 * call-out ("ask X to kick"), never "you should have". */
export function kickPriorityTeamEvents(
  points: IKickPriorityPoint[],
  owner: { id: string; name: string },
  probes: { lookup: () => KickPriorityRef | null },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? KICK_PRIORITY_CAP;
  const ref = probes.lookup();
  if (!ref) return [];
  const out: CandidateEvent[] = [];
  for (const p of points) {
    if (p.outcome !== "completed") continue;
    if (isOwnerMissedKick(p, owner.id)) continue; // the owner form owns it
    const mates = p.friends.filter((f) => f.id !== owner.id && f.feasible);
    if (mates.length === 0) continue;
    const me = p.friends.find((f) => f.id === owner.id);
    const ownerWhy = !me
      ? "no interrupt"
      : me.cdRemainingS > 0
        ? `on cooldown (${fmt(me.cdRemainingS)}s)`
        : me.locked
          ? "locked"
          : me.inRange === false
            ? `out of range (${me.distanceYd == null ? "?" : Math.round(me.distanceYd)} yd)`
            : "unknown";
    out.push({
      id: `kick-priority-team:${owner.id}:${Math.round(p.castStartS)}`,
      type: "kick-priority-team",
      t: p.castStartS,
      unitNames: [p.healerName],
      spell: p.spellName,
      spellId: p.spellId,
      facts: {
        t: fmtFactTime(p.castStartS),
        healer: p.healerName,
        heal: p.spellName,
        castS: fmt(p.durationS),
        target: p.targetName,
        targetHpPct: String(p.targetHpPct),
        healK: k(p.healAmount),
        ownerWhy,
        teammates: mates
          .map((f) => `${f.name} (${f.kickSpellName}, ${f.distanceYd == null ? "?" : Math.round(f.distanceYd)} yd)`)
          .join("; "),
        refNCompleted: String(ref.nCompleted),
        refNInterrupted: String(ref.nInterrupted),
        refDeathCompleted: String(ref.deathCompletedPct),
        refDeathInterrupted: String(ref.deathInterruptedPct),
      },
    });
  }
  return out
    .sort((a, b) => Number(b.facts.healK) - Number(a.facts.healK) || a.t - b.t)
    .slice(0, cap)
    .sort((a, b) => a.t - b.t);
}
