import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { castAndEffectIds } from "../data/castEffectAuras";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "../data/spellEffectData";
import {
  buildAuraIntervals,
  type IAuraInterval,
  supersededAuraBreaks,
} from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import {
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  isHealerSpec,
  MIN_CD_SECONDS,
  specToString,
  unitCooldownOf,
} from "./cooldowns";
import { fmtTime } from "./renderGrid";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;
import {
  computeDampening,
  dampeningDangerMultiplier,
  dampeningForThreatWeight,
  fmtDampening,
} from "./dampening";
import {
  AURA_EVIDENCE_WINDOW_S,
  auraOffensiveOccurrences,
} from "./offensiveAuraOccurrences";
import {
  dangerLabel,
  offensiveDangerWeight,
  offensiveEffectCdId,
} from "./spellDanger";

/** Two offensive CD casts within this window are considered an aligned burst.
 * Shared with burstLedger (friendly-side burst grouping) — one clustering predicate for both teams. */
export const BURST_CLUSTER_SECONDS = 10;
/** A single CD with at least this danger weight forms a burst window on its own (≈ a 2-minute major).
 * Exported since 2026-08-31 (GH #60): `analysis/burstWindowDecisionPoints.ts`
 * re-applies this exact qualification rule to each per-exchange piece it cuts
 * a window into, and a second copy of the number would be a silent fork of
 * "what counts as a burst" (CLAUDE.md shared-predicate rule). */
export const SOLO_WINDOW_MIN_WEIGHT = 1.3;

export interface IEnemyCDCast {
  /** the id that was cast — an activation keeps its own (GH #115) */
  spellId: string;
  spellName: string;
  castTimeSeconds: number;
  /** this id's own cooldown; 0 for an activation of another cooldown's
   * effect (Radiant Glory's 454351 has none — GH #115) */
  cooldownSeconds: number;
  /** When this CD will be available again (may exceed match duration);
   * null for an activation, which has no button to come back (GH #115) */
  availableAgainAtSeconds: number | null;
  /** `offensiveDangerWeight` — the effect's weight, the canonical cooldown's
   * for an activation. The one number window qualification and threat
   * scoring read. */
  dangerWeight: number;
  /**
   * When the effect of this cast ended: the end of its OBSERVED aura chain
   * when the log shows one (`observedEffectEndSeconds`), else the official
   * duration for the caster (spellEffectData / `buffFullDurationForCaster`),
   * else the cast time. `burstCastSpan` reads it.
   */
  buffEndSeconds: number;
  /** GH #119: "fact" = shown, never part of a burst window (a Demonic
   * Metamorphosis form under OFFENSIVE_AURA_FLAGS.demonic "fact"). Absent =
   * "burst". */
  burstRole?: "burst" | "fact";
  /** GH #119: nothing tells whether a cooldown was spent (a Metamorphosis
   * form with neither a press nor an Eye Beam) — render "?" not "[proc]" */
  availabilityUnknown?: boolean;
}

export interface IEnemyPlayerTimeline {
  readonly playerName: string;
  readonly specName: string;
  readonly offensiveCDs: readonly IEnemyCDCast[];
  /** GH #119: occurrences shown on the timeline but never a burst anywhere
   * (a Demonic Metamorphosis form under OFFENSIVE_AURA_FLAGS.demonic
   * "fact"). Kept OUT of offensiveCDs so no reader of the burst list can
   * pick one up by accident; only the [ENEMY CD] renderer reads this. */
  readonly offensiveFacts?: readonly IEnemyCDCast[];
}

export interface IAlignedBurstWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly activeCDs: ReadonlyArray<{
    readonly playerName: string;
    readonly spellName: string;
    readonly spellId: string;
    /** The second at which this CD was actually cast inside the window --
     * rendering must include it, or the list reads as "everything popped at the
     * window start" (the 059 misreading). */
    readonly castSeconds: number;
  }>;
  /** Ex-ante threat from the stacked CDs alone (weights × alignment × dampening) — outcome-independent */
  readonly threatScore: number;
  readonly threatLabel: "Low" | "Moderate" | "High" | "Critical";
  /** Combined score including outcome factors (damage dealt, healer CC) — kept for existing consumers */
  readonly dangerScore: number;
  readonly dangerLabel: "Low" | "Moderate" | "High" | "Critical";
  /** 0–1; `null` where no value is stated at the window's start — a 2v2
   * round before its first logged stack (`getInitialDampening`). */
  readonly dampeningPct: number | null;
  readonly damageInWindow: number;
  readonly damageRatio: number;
  readonly healerCCed: boolean;
  /** HP% of the most-pressured friendly at window start, midpoint, and end */
  readonly mostPressuredTarget?: {
    readonly unitName: string;
    readonly startHpPct: number | null;
    readonly midHpPct: number | null;
    readonly endHpPct: number | null;
  };
}

export interface IEnemyCDTimeline {
  readonly players: readonly IEnemyPlayerTimeline[];
  /** Windows where 2+ enemy offensive CDs were used within BURST_CLUSTER_SECONDS of each other */
  readonly alignedBurstWindows: readonly IAlignedBurstWindow[];
}

/** Max CD to consider a "real" cooldown (filters out 999.999s passive procs) */
export const ENEMY_CD_MAX_SECONDS = 360;

/**
 * "The enemy opened a cooldown" — ONE predicate for every consumer that
 * turns an enemy cast into a burst / threat fact: this builder's enemy-CD
 * windows, `crisisDecisionPoints`' `enemyBurst` and the teammate-crisis
 * cards' burst fact (2026-09-17, GH #95 hand-read). Membership in the
 * canonical `OFFENSIVE_CD_SPELL_IDS` is necessary but not sufficient — that
 * table also admits `debuffs_offensive` rows with no cooldown at all (Curse
 * of Weakness 702, Curse of Tongues 1714, Ignite 12654), which are not
 * something a cooldown tracker shows. Official cooldown (or charge recharge)
 * inside [MIN_CD_SECONDS, ENEMY_CD_MAX_SECONDS] — of the EFFECT's cooldown:
 * a registered activation (`OFFENSIVE_EFFECT_ACTIVATION_IDS`, Radiant Glory's
 * Avenging Wrath 454351) is admitted on its canonical cooldown (GH #115).
 */
export function isEnemyCdWindowSpell(spellId: string): boolean {
  const cdId = offensiveEffectCdId(spellId);
  if (cdId === undefined) return false;
  const effectData = spellEffectData[spellId];
  if (!effectData) return false;
  const cooldownSeconds = effectiveCooldownSeconds(cdId) ?? 0;
  return (
    cooldownSeconds >= MIN_CD_SECONDS && cooldownSeconds <= ENEMY_CD_MAX_SECONDS
  );
}

/**
 * For each enemy player, reconstruct when their offensive cooldowns (>= 30s) were cast
 * and when each CD will be available again. Also identifies aligned burst windows where
 * multiple enemies stacked offensive CDs together.
 */
/** A re-application this close after the previous interval's end continues
 * the same effect (triage kick-eaten F-K1, Sim R1-A: 02c8e3ac's Dragonrage
 * re-applied through 29.9 and removed at 45.4). */
export const EFFECT_CHAIN_GAP_S = 0.5;

/** A chain starts at an application in [cast − this, cast + `EFFECT_START_AFTER_S`]
 * — the entry's Sim R1-A window (an aura's APPLIED can be logged a little
 * before the cast's SUCCESS). */
export const EFFECT_START_BEFORE_S = 0.5;
export const EFFECT_START_AFTER_S = 2;

/** Every unit's aura intervals, once per combat. */
const AURA_INDEX = new WeakMap<
  object,
  Array<{ destId: string; iv: IAuraInterval }>
>();
function auraIndexOf(combat: AtomicArenaCombat) {
  let idx = AURA_INDEX.get(combat);
  if (!idx) {
    idx = [];
    for (const u of Object.values(combat.units ?? {}))
      for (const iv of buildAuraIntervals(u, combat))
        idx.push({ destId: u.id, iv });
    AURA_INDEX.set(combat, idx);
  }
  return idx;
}

/**
 * Where one cast's effect was seen to end, in seconds from the match start —
 * or null when the log does not show it.
 *
 * Triage kick-eaten F-K1, the observed-chain half of ruling A14 = B (the
 * floor half landed 2026-10-02): `burstCastSpan` ends at the observed aura
 * chain of the cast. The cast's effect auras are its own id plus the
 * cast→effect table's (`castAndEffectIds`, CROSS-THEME G3, ruling A10), on
 * ANY unit (The Hunt's DoT is on its target, Strike of the Windlord's debuff
 * too), applied by the caster: an interval that starts in [cast −
 * `EFFECT_START_BEFORE_S`, cast + `EFFECT_START_AFTER_S`] (before the
 * caster's next press of the same spell), extended by re-applications on the
 * same unit no more than `EFFECT_CHAIN_GAP_S` after it ended. Several chains
 * (a caster buff and a target DoT) → the one that ends last, and only when
 * THAT end was logged: a chain closed only by the official-length cap
 * (`inferredEnd`) says nothing about when the effect ended, so a longer
 * unclosed DoT is not cut short by a shorter buff's removal (codex review:
 * The Hunt's 0.4 s buff against its unclosed DoT) — null, the official
 * duration stands. Sim R1-A of the entry, rule for rule.
 */
export function observedEffectEndSeconds(
  caster: ICombatUnit,
  castSpellId: string,
  castS: number,
  nextSameCastS: number,
  combat: AtomicArenaCombat,
): number | null {
  const ids = castAndEffectIds(castSpellId);
  const mine = auraIndexOf(combat).filter(
    ({ iv }) =>
      ids.has(iv.spellId) &&
      iv.srcUnitName === caster.name &&
      !iv.inferredStart &&
      iv.fromS < nextSameCastS,
  );
  let best: { end: number; observed: boolean } | null = null;
  for (const dest of new Set(mine.map((m) => m.destId))) {
    const ivs = mine
      .filter((m) => m.destId === dest)
      .map((m) => m.iv)
      .sort((a, b) => a.fromS - b.fromS);
    const first = ivs.findIndex(
      (iv) =>
        iv.fromS >= castS - EFFECT_START_BEFORE_S &&
        iv.fromS <= castS + EFFECT_START_AFTER_S,
    );
    if (first < 0) continue;
    let chainEnd = ivs[first]!.toS;
    let observed = !ivs[first]!.inferredEnd;
    for (const iv of ivs.slice(first + 1)) {
      if (iv.fromS > chainEnd + EFFECT_CHAIN_GAP_S) break;
      if (iv.toS > chainEnd) {
        chainEnd = iv.toS;
        observed = !iv.inferredEnd;
      }
    }
    if (best === null || chainEnd > best.end)
      best = { end: chainEnd, observed };
  }
  return best?.observed ? best.end : null;
}

export function reconstructEnemyCDTimeline(
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
  owner?: ICombatUnit,
  friendlies?: ICombatUnit[],
): IEnemyCDTimeline {
  const matchStartMs = combat.startTime;
  const matchDurationSeconds = (combat.endTime - matchStartMs) / 1000;

  const players: IEnemyPlayerTimeline[] = [];

  for (const enemy of enemies) {
    const offensiveCDs: IEnemyCDCast[] = [];

    for (const cast of enemy.spellCastEvents) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const { spellId } = cast;
      if (!spellId) continue;
      if (!isEnemyCdWindowSpell(spellId)) continue;
      const effectData = spellEffectData[spellId]!;
      // an activation of another cooldown's effect (GH #115) has no button:
      // no cooldown of its own, nothing to come "available again"
      const isActivation = offensiveEffectCdId(spellId) !== spellId;
      // the enemy's own talent-resolved cooldown (`unitCooldownOf`: Summon
      // Infernal 90 with Inferno, not 120) — talent impact audit 2026-09-26
      const cooldownSeconds = isActivation
        ? 0
        : (unitCooldownOf(enemy, spellId)?.cooldownSeconds ??
          effectiveCooldownSeconds(spellId) ??
          0);

      const castTimeSeconds = (cast.logLine.timestamp - matchStartMs) / 1000;
      // Caster-aware: DB2 base + the caster's duration talents (the same
      // predicate the owner's ledger reads). Reliability round 3 N7 (f4da):
      // Summon Demonic Tyrant rendered 15 s while Reign of Tyranny holders run
      // 20 s (three windows 20.0 s).
      const buffDuration =
        buffFullDurationForCaster(spellId, enemy) ??
        effectData.durationSeconds ??
        0;

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
        availableAgainAtSeconds: isActivation
          ? null
          : castTimeSeconds + cooldownSeconds,
        buffEndSeconds: castTimeSeconds + buffDuration,
        dangerWeight: offensiveDangerWeight(
          spellId,
          (id) => effectiveCooldownSeconds(id) ?? 0,
        ),
      });
    }

    // The span of each LOGGED cast ends where its effect was seen to end
    // (`observedEffectEndSeconds`) — before the aura-evidence merge below,
    // which keeps its own say for the effects it owns.
    for (const cd of offensiveCDs) {
      const next = offensiveCDs.find(
        (c) =>
          c.spellId === cd.spellId && c.castTimeSeconds > cd.castTimeSeconds,
      );
      const end = observedEffectEndSeconds(
        enemy,
        cd.spellId,
        cd.castTimeSeconds,
        next?.castTimeSeconds ?? Infinity,
        combat,
      );
      if (end !== null) cd.buffEndSeconds = end;
    }

    // GH #119: effects whose only evidence is an aura (Havoc Metamorphosis —
    // the button never logs —, Demonic, a Doom Winds with no logged press),
    // from the same round-bounded aura intervals the aura path reads
    const aura = auraOffensiveOccurrences(enemy, combat);
    for (const [castMs, endMs] of aura.observedEndOfCast) {
      const t = (castMs - matchStartMs) / 1000;
      const cast = offensiveCDs.find(
        (c) =>
          c.spellId === "384352" && Math.abs(c.castTimeSeconds - t) < 0.001,
      );
      if (cast) cast.buffEndSeconds = (endMs - matchStartMs) / 1000;
    }
    const offensiveFacts: IEnemyCDCast[] = [];
    // only casts that were LOGGED — never an aura occurrence appended below
    // (codex re-review: two source-unknown forms [10,11] and [12,17] merged
    // into one [10,17] when the second matched the first)
    const loggedCasts = [...offensiveCDs];
    for (const o of aura.occurrences) {
      const castTimeSeconds = (o.startMs - matchStartMs) / 1000;
      // a LOGGED press of the same cooldown already stands for this effect
      // (a 191427 button cast, should one ever log): merge the aura's end
      // into it instead of adding a second occurrence (codex review)
      const logged = loggedCasts.find(
        (c) =>
          c.spellId === o.spellId &&
          Math.abs(c.castTimeSeconds - castTimeSeconds) <=
            AURA_EVIDENCE_WINDOW_S,
      );
      if (logged) {
        // an observed aura end replaces the estimate; an INFERRED one (the
        // aura's own official length — Summon Infernal's cast row is 0.25 s)
        // may only lengthen it: a re-application closes the interval early
        // and must not cut a correct 15 s estimate to 5 s (agy review)
        const auraEnd = (o.endMs - matchStartMs) / 1000;
        if (o.endObserved) logged.buffEndSeconds = auraEnd;
        else if (o.provenance === "press-logged")
          logged.buffEndSeconds = Math.max(logged.buffEndSeconds, auraEnd);
        continue;
      }
      (o.burstRole === "fact" ? offensiveFacts : offensiveCDs).push({
        spellId: o.spellId,
        spellName: o.spellName,
        castTimeSeconds,
        cooldownSeconds: o.cooldownSeconds,
        availableAgainAtSeconds:
          o.availableAgainAtMs === null
            ? null
            : (o.availableAgainAtMs - matchStartMs) / 1000,
        buffEndSeconds: (o.endMs - matchStartMs) / 1000,
        dangerWeight: o.dangerWeight,
        ...(o.burstRole === "fact" ? { burstRole: "fact" as const } : {}),
        ...(o.availabilityUnknown ? { availabilityUnknown: true } : {}),
      });
    }

    offensiveCDs.sort((a, b) => a.castTimeSeconds - b.castTimeSeconds);

    if (offensiveCDs.length > 0 || offensiveFacts.length > 0) {
      players.push({
        playerName: enemy.name,
        specName: specToString(enemy.spec),
        offensiveCDs,
        ...(offensiveFacts.length > 0 ? { offensiveFacts } : {}),
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
        dangerWeight: cd.dangerWeight,
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
      inWindow.some((c) => c.dangerWeight >= SOLO_WINDOW_MIN_WEIGHT);
    if (qualifies) {
      const windowStart = inWindow[0].time;
      // toSeconds = when the last buff in this window actually expires, not just when it was cast.
      // Uses buffEndSeconds (cast + durationSeconds) when available; falls back to cast time.
      const windowEnd = Math.max(...inWindow.map((c) => c.buffEndSeconds));

      // Compute CD-based danger score
      const cdScore = inWindow.reduce((sum, c) => sum + c.dangerWeight, 0);
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

      // Dampening at window start. The stack events are read on the units
      // this call was handed (unchanged); the bracket is classified on the
      // round's whole roster (FT-T13, D10) — half of this function's callers
      // pass no `friendlies`, and for a bracket string that names no bracket
      // one side alone never counts as a 3v3 roster.
      const bracket = combat.startInfo?.bracket ?? "3v3";
      const allPlayers = [...enemies, ...(friendlies ?? [])];
      const roundUnits = Object.values(combat.units ?? {});
      const roster = roundUnits.length > 0 ? roundUnits : allPlayers;
      const windowStartAtMs = windowStart * 1000 + matchStartMs;
      // `dampening` is the STATED value — null in a 2v2 round before its
      // first logged stack (FT-T13 D11); it is what `dampeningPct` carries to
      // anything that prints it. The threat score needs a weight even there
      // and takes it from `dampeningForThreatWeight` (the first logged stack).
      const dampening = computeDampening(
        windowStartAtMs,
        bracket,
        allPlayers,
        roster,
      );
      const dampeningMult = dampeningDangerMultiplier(
        dampeningForThreatWeight(windowStartAtMs, bracket, allPlayers, roster),
      );

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
        // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08)
        const notTheEnd = supersededAuraBreaks(owner.auraEvents);
        for (const a of owner.auraEvents) {
          if (!a.spellId || notTheEnd.has(a)) continue;
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
    // No `| Dampening:` where none is stated (2v2 before the first logged stack)
    const dampStr =
      w.dampeningPct === null
        ? ""
        : ` | Dampening: ${fmtDampening(w.dampeningPct)}`;
    // Each CD carries its own cast time: the window is the union of "earliest
    // cast -> latest buff end", and a list without times was once read as
    // everything popping at the window start (059).
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
      `  #${idx + 1} — ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} | Threat: ${w.threatLabel} (${w.threatScore.toFixed(1)})${dampStr}`,
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
      if (
        cd.availableAgainAtSeconds !== null &&
        cd.availableAgainAtSeconds > matchDurationSeconds
      ) {
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

/*
 * 2026-08-23 删除 `formatKillAttemptWindowsForContext` 与 `KILL_ATTEMPT_SPIKE_THRESHOLD`
 * (原在此处,共 73 行)—— **全仓零调用者**。
 *
 * 它想做的事(把敌方爆发窗口和随之而来的伤害峰值接在一起)现在由两处活代码承担:
 * prompt 里的 `[OFFENSIVE WINDOW]` 行(格式几乎逐字相同:`peak spike … over … | CDs: …`;
 * 255 个回合里 100% 出现、每局 2.8 行),以及 2026-08-18 击杀重设计后的
 * `killAttempts.ts#formatKillAttemptsForContext`(判据是三档机会模型 PRIME/gated/locked,
 * 不再看伤害阈值;同一批回合 100% 出现、每局 1.0 行)。
 *
 * 发现路径值得记:它是「拍脑袋常量清查」(GH #34)里被点名的绝对数值之一,查出处时
 * 才发现它守的是一段没人调的代码 —— **一个常量没有出处,有时候不是因为没人记,
 * 是因为它守的东西已经没人用了。**
 */
