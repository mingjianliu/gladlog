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
import { MELEE_RANGE_YD, spellRangeYards } from "../../data/spellReach";
import {
  RANGE_HITBOX_SLACK_YD,
  spellRangeForCaster,
} from "../../utils/spellRange";
import { hardcastHealSpell } from "../../data/kickPriorityHealSpells";
import { buildCannotCastIntervals } from "../../utils/cannotCastIntervals";
import { gridHpPct, isHealerSpec } from "../../utils/cooldowns";
import {
  interruptCooldownRemainingMs,
  interruptForUnit,
} from "../../utils/enemyInterrupts";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "../../utils/losAnalysis";
import { computeOffensiveWindows } from "../../utils/offensiveWindows";
import { LOS_SWEEP_GAP_MS } from "../../utils/positionSampling";
import { toRenderSecond } from "../../utils/renderGrid";
import {
  canReachTargetAt,
  rootIntervalsOf,
} from "../../utils/rootReachability";
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
/** Codex round-1 (2026-09-12, conceded): a fixed 20 yd licenses accusing a
 * melee who could not have arrived inside a 1 s cast. Reach is therefore
 * scaled by the cast: base envelope + run speed × cast duration, capped at
 * KICK_MELEE_REACH_YD (gap closers beyond that are not demonstrated).
 * Base 8 yd = the p50 of landed melee kicks (model centres + hitbox). */
export const KICK_MELEE_BASE_YD = 8;
export const KICK_RUN_SPEED_YD_S = 7;

/**
 * A melee kicker's reach for a cast: the run envelope when they could run at
 * all, and only the kick's own range + hitbox slack when they could not
 * (rooted / locked for the whole stretch) — KICK_MELEE_BASE_YD is the p50 of
 * landed kicks measured at cast START, movement included, so it is not a
 * standing reach (codex, W1a 2026-09-26). `range - baseRange` keeps the
 * kicker's range talents.
 */
export function meleeKickReachYd(
  runS: number,
  range: number,
  baseRange: number,
): number {
  if (runS <= 0) return range + RANGE_HITBOX_SLACK_YD;
  return (
    Math.min(
      KICK_MELEE_REACH_YD,
      KICK_MELEE_BASE_YD + KICK_RUN_SPEED_YD_S * runS,
    ) +
    (range - baseRange)
  );
}
/** The kicker must have been free to act for at least this long inside the
 * cast (not the whole cast): a lockout that expires 50 ms before the heal
 * lands is not an opportunity (codex round-1). */
export const KICK_MIN_FREE_S = 0.5;
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
  /** The friendly had less than KICK_MIN_FREE_S of castable time inside the
   * cast (cannot-cast intervals subtracted). */
  locked: boolean;
  distanceYd: number | null;
  /** In official range (melee: + slack; ranged: with line of sight); null =
   * no position sample / unknown map. */
  inRange: boolean | null;
  feasible: boolean;
  /** Completed casts: still castable and in reach inside the ACTUAL cast
   * (start → landing), not only the nominal one. Accusations need both. */
  reachableBeforeLanding: boolean;
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
  /** Completed only: SPELL_HEAL of this cast that landed on the kill target
   * (0 when it healed someone else or was fully overhealed — a fact, not an
   * inclusion rule: SPELL_CAST_START carries no destination in the log, so
   * neither arm can be conditioned on the heal's target). */
  healAmount: number;
  /** Completed only: who received this cast when it was not the kill target
   * (largest SPELL_HEAL recipient), null when it landed on the target or
   * nothing landed. */
  healOtherName: string | null;
  healOtherAmount: number;
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
  overrides?: {
    targetHpPct?: number;
    /** "table" (product): a cast qualifies iff its spell is in
     * data/kickPriorityHealSpellsGenerated.json; "bootstrap" (the archive probe
     * that GENERATES that table): the outcome-dependent per-round rule — a
     * spell this healer completed ≥ 1 s somewhere in the round with a
     * SPELL_HEAL landing. Never use bootstrap for a product or A/B build. */
    eligibility?: "table" | "bootstrap";
  },
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
  const rootedCache = new Map<string, Array<{ from: number; to: number }>>();
  const cannotCastOf = (f: UnitLike) => {
    let iv = lockedCache.get(f.id);
    if (!iv) {
      try {
        iv = buildCannotCastIntervals(f as never, enemyIds);
      } catch {
        iv = [];
      }
      lockedCache.set(f.id, iv);
    }
    return iv;
  };
  /** Roots on the unit (`rootIntervalsOf`), ms — castable, but no running
   * (reliability round 3 W1a, 6954: a Retribution Paladin rooted through the
   * whole heal was granted 16 yd of run). */
  const rootedOf = (f: UnitLike) => {
    let iv = rootedCache.get(f.id);
    if (!iv) {
      try {
        iv = rootIntervalsOf(f as never, combat).map((x) => ({
            from: startMs + x.fromS * 1000,
            to: startMs + x.toS * 1000,
          }));
      } catch {
        iv = [];
      }
      rootedCache.set(f.id, iv);
    }
    return iv;
  };
  /** The LONGEST CONTINUOUS stretch of seconds inside [a, b] outside the
   * blocked intervals (overlaps merged). Codex round-2 (2026-09-12): summing
   * fragments let a 1.5 s stun inside a 2 s cast count as "0.5 s free" while
   * the reach budget still assumed 2 s of running. The castable stretch
   * (cannot-cast) decides `locked`; the runnable one (cannot-cast ∪ roots)
   * the melee run budget — a conservative stand-in for accumulated movement,
   * never over-crediting it (codex, W1a 2026-09-26). */
  const longestOutside = (
    iv: Array<{ from: number; to: number }>,
    a: number,
    b: number,
  ): number => {
    const clipped = iv
      .map((x) => [Math.max(x.from, a), Math.min(x.to, b)] as [number, number])
      .filter(([x, y]) => y > x)
      .sort((p, q) => p[0] - q[0]);
    // merge, then walk the gaps between merged blocked intervals
    const merged: Array<[number, number]> = [];
    for (const [x, y] of clipped) {
      const last = merged[merged.length - 1];
      if (last && x <= last[1]) last[1] = Math.max(last[1], y);
      else merged.push([x, y]);
    }
    let best = 0;
    let cursor = a;
    for (const [x, y] of merged) {
      best = Math.max(best, x - cursor);
      cursor = Math.max(cursor, y);
    }
    best = Math.max(best, b - cursor);
    return Math.max(0, best / 1000);
  };
  const eligibility = overrides?.eligibility ?? "table";
  /** BOOTSTRAP ONLY (see overrides.eligibility): the old per-round rule, kept
   * so the archive probe can generate the corpus table without importing it. */
  const perRoundCache = new Map<string, Map<string, number>>();
  const perRoundSpells = (h: UnitLike): Map<string, number> => {
    let set = perRoundCache.get(h.id);
    if (set) return set;
    set = new Map<string, number>();
    const st = (h.castStartEvents ?? []).filter(
      (e) => e.logLine.event === "SPELL_CAST_START",
    );
    const su = h.spellCastEvents.filter(
      (e) => e.logLine.event === "SPELL_CAST_SUCCESS",
    );
    const healingIds = new Set<string>(
      (h.healOut ?? [])
        .filter((x) => x.logLine.event === "SPELL_HEAL")
        .map((x) => String(x.spellId)),
    );
    for (let j = 0; j < st.length; j++) {
      const a = st[j];
      const nx = st[j + 1]?.logLine.timestamp ?? Infinity;
      const d = su.find(
        (c) =>
          c.spellId === a.spellId &&
          c.logLine.timestamp >= a.logLine.timestamp &&
          c.logLine.timestamp <=
            Math.min(nx, a.logLine.timestamp + CAST_PAIR_MAX_MS),
      );
      if (!d) continue;
      const dur = (d.logLine.timestamp - a.logLine.timestamp) / 1000;
      if (
        dur >= KICK_PRIORITY_MIN_CAST_S &&
        dur <= KICK_PRIORITY_MAX_CAST_S &&
        healingIds.has(String(a.spellId))
      )
        set.set(String(a.spellId), dur);
    }
    perRoundCache.set(h.id, set);
    return set;
  };
  /** Nominal cast seconds for feasibility, or null when the spell is not an
   * eligible hardcast heal. Product path = the corpus table (outcome-
   * independent per round); bootstrap = per-round observation. */
  const nominalCastS = (healer: UnitLike, sid: string): number | null => {
    if (eligibility === "bootstrap")
      return perRoundSpells(healer).get(sid) ?? null;
    return hardcastHealSpell(sid)?.medianCastS ?? null;
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

      // Both arms: eligibility comes from the corpus table (or the bootstrap
      // rule for the probe that builds it) — never from what this cast or this
      // round went on to do. No target condition on either arm; where the
      // completed cast landed is a rendered fact (healK / healedWhom).
      const nominalS = nominalCastS(healer, sid);
      if (nominalS == null) continue;
      const nominalEndMs = sMs + nominalS * 1000;
      let healAmount = 0;
      let healOtherName: string | null = null;
      let healOtherAmount = 0;
      if (outcome === "completed") {
        const byDest = new Map<string, number>();
        for (const h of healer.healOut ?? []) {
          const t = h.logLine.timestamp;
          if (
            h.spellId !== sid ||
            t < endMs ||
            t > endMs + HEAL_LAND_PAIR_MS ||
            h.logLine.event !== "SPELL_HEAL"
          )
            continue;
          const amt = Math.abs(h.effectiveAmount);
          if (h.destUnitId === target.id) healAmount += amt;
          else byDest.set(h.destUnitId, (byDest.get(h.destUnitId) ?? 0) + amt);
        }
        if (healAmount === 0 && byDest.size > 0) {
          const [id, amt] = [...byDest.entries()].sort(
            (a, b) => b[1] - a[1],
          )[0];
          healOtherName =
            units.find((u) => u.id === id)?.name ??
            enemyById.get(id)?.name ??
            id;
          healOtherAmount = amt;
        }
      }

      const friendsOut: KickPriorityFriend[] = [];
      for (const f of friendPlayers) {
        const kit = interruptForUnit(f as never);
        if (!kit) continue;
        // exact ms — 0.4 s left is not ready (codex round-1)
        const cdRemainingS =
          interruptCooldownRemainingMs(f as never, kit.spellId, sMs) / 1000;
        const neverObserved = !f.spellCastEvents.some(
          (e) =>
            e.spellId === kit.spellId &&
            e.logLine.event === "SPELL_CAST_SUCCESS" &&
            e.logLine.timestamp < sMs,
        );
        // an unconfirmed kit (tree-availability fallback, pet) is
        // observed-or-nothing; a confirmed one (baseline / talent in the log)
        // needs no prior cast — codex round-1: the prior-cast rule was
        // silently selecting players who already kick
        const kitOk = kit.confirmed || !neverObserved;
        // Feasibility is judged on the NOMINAL cast (same for a kicked and a
        // completed cast of the same spell), on the longest continuous
        // castable stretch inside it.
        const freeS = longestOutside(cannotCastOf(f), sMs, nominalEndMs);
        const locked = freeS < Math.min(KICK_MIN_FREE_S, nominalS);
        const runBlocked = [...cannotCastOf(f), ...rootedOf(f)];
        const runS = longestOutside(runBlocked, sMs, nominalEndMs);
        const pos = getUnitPositionAtTime(f as never, sMs, LOS_SWEEP_GAP_MS);
        const hpos = getUnitPositionAtTime(
          healer as never,
          sMs,
          LOS_SWEEP_GAP_MS,
        );
        const distanceYd = pos && hpos ? distanceBetween(pos, hpos) : null;
        const baseRange = spellRangeYards(kit.spellId);
        // this kicker's range: official range + the range talents they hold
        // (GH #83 — Improved Disrupt +5 yd, …)
        const range = spellRangeForCaster(f as never, kit.spellId);
        let inRange: boolean | null = null;
        let reachableBeforeLanding = true;
        if (
          pos &&
          baseRange != null &&
          range != null &&
          kit.confirmed !== false
        ) {
          // melee is a property of the spell, not of the talented number: a
          // talented melee kick still needs no line of sight
          const melee = baseRange <= MELEE_RANGE_YD;
          // run budget = the runnable stretch (castable and not rooted), not
          // the cast length: a friendly stunned for 1.5 s of a 2 s cast can
          // run for 0.5 s, a rooted one not at all
          inRange = canReachTargetAt(
            pos,
            healer as never,
            sMs,
            zoneId,
            melee ? meleeKickReachYd(runS, range, baseRange) : range,
            !melee,
          );
          // An accusation needs the chance BEFORE the heal landed (codex,
          // W1a): the nominal cast keeps the kicked / completed arms
          // comparable for the reference table, but a completed cast that
          // landed early leaves less time than the nominal one.
          if (outcome === "completed" && endMs < nominalEndMs) {
            const freeB = longestOutside(cannotCastOf(f), sMs, endMs);
            const runB = longestOutside(runBlocked, sMs, endMs);
            reachableBeforeLanding =
              freeB >= Math.min(KICK_MIN_FREE_S, durationS) &&
              true ===
                canReachTargetAt(
                  pos,
                  healer as never,
                  sMs,
                  zoneId,
                  melee ? meleeKickReachYd(runB, range, baseRange) : range,
                  !melee,
                );
          }
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
          feasible: kitOk && cdRemainingS <= 0 && !locked && inRange === true,
          reachableBeforeLanding,
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
        healOtherName,
        healOtherAmount,
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
  return Boolean(me && me.feasible && me.reachableBeforeLanding);
}

export interface KickPriorityRef {
  /** completed vs interrupted casts in this state, kill-target death within 10 s */
  nCompleted: number;
  nInterrupted: number;
  deathCompletedPct: number;
  deathInterruptedPct: number;
}

const k = (x: number) => String(Math.round(x / 1000));
/** The corpus contrast as one copy-able sentence. n=78 A/B (2026-09-12): 2 of
 * 63 kick-priority citations inverted the two percentages into "survives
 * 11% vs 32%" — both are DEATH rates and the kicked figure is the higher one,
 * so the producer words it and the legend says to copy it. */
const refContrast = (ref: KickPriorityRef): string =>
  `kill target died within 10 s in ${ref.deathInterruptedPct}% of kicked casts vs ${ref.deathCompletedPct}% of completed casts`;
/** Rendered recipient of a completed cast: the kill target, another unit
 * (with its amount), or nothing (fully overhealed / absorbed). */
const healedWhom = (p: IKickPriorityPoint): string =>
  p.healAmount > 0
    ? "target"
    : p.healOtherName
      ? `${p.healOtherName} (${k(p.healOtherAmount)}k)`
      : "none";

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
      .filter(
        (f) => f.id !== owner.id && f.feasible && f.reachableBeforeLanding,
      )
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
        healedWhom: healedWhom(p),
        kick: me.kickSpellName,
        kickNeverUsed: me.neverObserved ? "yes" : "no",
        distanceYd:
          me.distanceYd == null ? "?" : String(Math.round(me.distanceYd)),
        othersFeasible: others.length ? others.join("; ") : "none",
        refNCompleted: String(ref.nCompleted),
        refNInterrupted: String(ref.nInterrupted),
        refDeathCompleted: String(ref.deathCompletedPct),
        refDeathInterrupted: String(ref.deathInterruptedPct),
        refContrast: refContrast(ref),
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
    const mates = p.friends.filter(
      (f) => f.id !== owner.id && f.feasible && f.reachableBeforeLanding,
    );
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
        healedWhom: healedWhom(p),
        ownerWhy,
        teammates: mates
          // name + distance only (user ruling 2026-09-15): the interrupt's
          // name was one more audited token per teammate and the coaching
          // line is "call the kick", not "call Counterspell"
          .map(
            (f) =>
              `${f.name} ${f.distanceYd == null ? "?" : Math.round(f.distanceYd)} yd`,
          )
          .join("; "),
        refNCompleted: String(ref.nCompleted),
        refNInterrupted: String(ref.nInterrupted),
        refDeathCompleted: String(ref.deathCompletedPct),
        refDeathInterrupted: String(ref.deathInterruptedPct),
        refContrast: refContrast(ref),
      },
    });
  }
  return out
    .sort((a, b) => Number(b.facts.healK) - Number(a.facts.healK) || a.t - b.t)
    .slice(0, cap)
    .sort((a, b) => a.t - b.t);
}
