import {
  type AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  castEffectPairs,
  castsOfEffectAura,
  effectAurasOfCast,
} from "../data/castEffectAuras";
import {
  isKickSpellId,
  SPELL_CATEGORIES as spellsData,
} from "../data/spellCategories";
import { getEnglishSpellName, spellNamesReady } from "../data/spellEffectData";
import { ccSpellIds, rootSpellIds } from "../data/spellTags";
import {
  buildCannotCastIntervals,
  enemySourceIds,
} from "./cannotCastIntervals";
import { isControlCast } from "./castMissRows";
import { ccReachAt, ccTargetBlockerIntervals } from "./ccTargetState";
import {
  cdAvailableAt,
  chargesAvailableAt,
  extractMajorCooldowns,
  hpTroughInEventSpan,
  hpTroughInWindow,
  type IMajorCooldownInfo,
  isHealerSpec,
  specToString,
  unitCooldownEntry,
  unitCooldownOf,
} from "./cooldowns";
import {
  auraIdsAppliedBy,
  drCategoryKnown,
  drCategoryOfCast,
  DRLevel,
  getDRLevelAtTime,
  IDRInfo,
} from "./drAnalysis";
import { IEnemyCDTimeline } from "./enemyCDs";
import {
  computeEnemyInterruptAvailability,
  isInterruptUsable,
} from "./enemyInterrupts";
import { isDeferralAbsorb } from "./incomingPressure";
import {
  createKillWindowFactsComputer,
  hasPressOnlyTag,
  type IKillWindowFactsComputer,
  type IKillWindowGateFacts,
  killWindowAcquittal,
  killWindowFactsSuffix,
  PRESS_ONLY_LEGEND,
  teamDamageTotalClause,
} from "./killWindowFacts";
import {
  getHpPercentAtTime,
  getTrinketStateAtTime,
} from "./killWindowTargetSelection";
import { IOffensiveWindow } from "./offensiveWindows";
import {
  fmtTime,
  fmtWholeSecondsOrZero,
  renderedWindowSeconds,
} from "./renderGrid";
import { roundEndMs } from "./roundEnd";
import { type InterruptibleCast, interruptibleCastOf } from "./spellMechanics";
import { ccThreatReachYards } from "./spellRange";
import { firstDeathMs } from "./unitDeath";

/**
 * Is this owner CAST a CC — by its own id, or through the one cast → effect
 * table when the CC is listed by the aura it leaves (triage res-readiness
 * F-C23: Song of Chi-Ji 198898 → 198909, Lightning Lasso 305483 → 305485 —
 * `ccSpellIds` lists them by aura, so a Mistweaver who pressed Song read "you
 * cast no CC"). The one test for the roster, the window's "you cast CC" and
 * the per-segment CC counts.
 */
function isOwnerCcCast(spellId: string): boolean {
  return isControlCast(spellId);
}

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

// GH #34 batch 4 (2026-08-28), 300 matches / 1,127 healer rounds (advanced
// logging on 1,125), team MIN-HP sampled every 2 s (85,774 known samples):
//   ≥ 85 % (slack)        41.8 % of match time
//   70–85 % (contested)   23.8 %
//   < 70 %                34.4 %
// So the two HP bands split the match roughly 40 / 25 / 35; the 85 line sits
// where "nobody needs a heal" plausibly starts, the 70 line where an external
// or a big heal is due — both editorial bands on a smooth distribution.
// Slack segments kept (≥ MIN_SLACK_SECONDS, n=3,949): [4,6) 1,178 · [6,8) 815
// · [8,10) 590 · [10,15) 870 · [15,20) 357 · [20,30) 126 · ≥ 30 13 (p50 7.0 s,
// p90 16.0 s) — 29.8 % of kept segments are under 6 s, so the 4 s floor is
// doing real work. Idle slack segments (owner cast nothing offensive, n=937):
// 63.4 % ≥ IDLE_PRIORITY_SECONDS (6 s), 36.5 % ≥ 8 s — the 6 s priority cut
// keeps two thirds of idle segments. MOBILITY_EXCLUSION_SECONDS and the two
// MAX_*_FACTS caps are editorial (exemption / prompt budget), not measured.
// All measured, not official; re-run before moving any of them.
export const SLACK_TEAM_HP_THRESHOLD = 85;
export const CONTESTED_TEAM_HP_MIN = 70;
export const MAX_CONTESTED_FACTS = 2;
export const MIN_SLACK_SECONDS = 4;
export const IDLE_PRIORITY_SECONDS = 6;
export const MOBILITY_EXCLUSION_SECONDS = 3;
export const MAX_WINDOW_CREATION_FACTS = 2;
// [KILL WINDOW] lines were uncapped (corpus avg 3.34/block, max 11 — up to ~300 tok on tail
// matches; 2026-07-09 week-eval tokens.md #6). Above the cap, the windows with the most owner
// free time are kept (highest coaching leverage) and the rest are rolled up into one line.
export const MAX_KILL_WINDOW_LINES = 6;

export interface ISlackSegment {
  fromSeconds: number;
  toSeconds: number;
  durationSeconds: number;
  /** Effective damage the owner dealt to enemies inside the segment. */
  ownerDamage: number;
  ownerCCCasts: number;
  ownerPurgeCasts: number;
  ownerKickCasts: number;
  /** True when the owner produced zero offensive output of any kind. */
  idle: boolean;
  /** Lowest friendly HP% sampled on the render grid inside [from, to)
   * (`teamMinHpPctOver`). GH #103 A4: `[SLACK]` lines print it, so "team ≥85%"
   * is not paraphrased as "full HP" (the responder did, at 88%). */
  teamMinHpPct: number;
}

export interface IContestedSegment extends ISlackSegment {
  ownerHealing: number;
}

/** Lowest friendly HP% inside the segment [fromSeconds, toSeconds) — the
 * true minimum the log shows (`hpTroughInWindow` over the segment's
 * displayed seconds; user ruling 2026-10-17, F15: 「改成真最低」). The
 * segment itself is still the grid band's (`isSlackSecond` / the contested
 * band read the whole-second ticks), so this number can sit below the band —
 * the legend says so (`SLACK_TEAM_MIN_LEGEND`). toSeconds is the first second
 * that FAILED the band predicate and is not read. 100 when no friend has a
 * reading. Shared by `[SLACK]` and `[CONTESTED]`. */
export function teamMinHpPctOver(
  friends: ICombatUnit[],
  fromSeconds: number,
  toSeconds: number,
  matchStartMs: number,
): number {
  let min: number | null = null;
  if (toSeconds > fromSeconds)
    for (const f of friends) {
      // the half-open segment [from, to): a tick counts only when its
      // sample lies inside it (codex 20-F15-07: the last tick borrowed the
      // first failed second's sample)
      const t = hpTroughInWindow(
        f,
        matchStartMs,
        fromSeconds,
        toSeconds - 1,
        undefined,
        {
          fromMs: matchStartMs + fromSeconds * 1000,
          toMs: matchStartMs + toSeconds * 1000 - 1,
        },
      );
      if (t && (min === null || t.pct < min)) min = t.pct;
    }
  return Math.round(min ?? 100);
}

/** The `[SLACK]` / `[CONTESTED]` legend for their `team min HP` (F15). */
export const SLACK_TEAM_MIN_LEGEND =
  "  `team min HP N%` on a slack or contested line below = the lowest HP any of your team had inside that span, the true minimum the log shows; the span itself is judged on the whole-second [STATE] readings (team at or above the band at every one of them), so N can sit below the band.";

type CCInterval = ReadonlyArray<{ atSeconds: number; durationSeconds: number }>;

function isEnemyCDActiveAt(timeline: IEnemyCDTimeline, t: number): boolean {
  return timeline.players.some((p) =>
    p.offensiveCDs.some(
      (cd) => cd.castTimeSeconds <= t && t < cd.buffEndSeconds,
    ),
  );
}

function isOwnerCCdAt(ownerCC: CCInterval, t: number): boolean {
  return ownerCC.some(
    (cc) => cc.atSeconds <= t && t < cc.atSeconds + cc.durationSeconds,
  );
}

function ownerMobilityCastTimes(
  owner: ICombatUnit,
  matchStartMs: number,
): number[] {
  return owner.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId &&
        SPELLS[e.spellId]?.type === "buffs_speed_boost",
    )
    .map((e) => (e.logLine.timestamp - matchStartMs) / 1000);
}

export function computeSlackSegments(
  combat: {
    startTime: number;
    endTime: number;
    startInfo?: { bracket?: string };
  },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  enemyCDTimeline: IEnemyCDTimeline,
  ownerCCInstances: CCInterval,
  ownerPurgeTimesSeconds: ReadonlyArray<number>,
): { advancedLoggingAvailable: boolean; segments: ISlackSegment[] } {
  const matchStartMs = combat.startTime;
  // A3 (user 2026-10-24): the sweep walks the round, not the log — a Solo
  // Shuffle round is over at its deciding death (`roundEndMs`)
  const durationSeconds = Math.floor(
    (roundEndMs(combat, [...friends, ...enemies]) - combat.startTime) / 1000,
  );

  const advancedLoggingAvailable = friends.every(
    (f) => f.advancedActions.length > 0,
  );
  if (!advancedLoggingAvailable)
    return { advancedLoggingAvailable: false, segments: [] };

  const mobilityTimes = ownerMobilityCastTimes(owner, matchStartMs);

  const isSlackSecond = (t: number): boolean => {
    for (const f of friends) {
      const hp = getHpPercentAtTime(f, t, matchStartMs);
      if (hp === null || hp < SLACK_TEAM_HP_THRESHOLD) return false;
    }
    if (isEnemyCDActiveAt(enemyCDTimeline, t)) return false;
    if (isOwnerCCdAt(ownerCCInstances, t)) return false;
    if (mobilityTimes.some((m) => t >= m && t < m + MOBILITY_EXCLUSION_SECONDS))
      return false;
    return true;
  };

  // 1s-resolution sweep, merge consecutive slack seconds into segments
  const raw: Array<{ fromSeconds: number; toSeconds: number }> = [];
  let segStart: number | null = null;
  for (let t = 0; t <= durationSeconds; t++) {
    if (isSlackSecond(t)) {
      if (segStart === null) segStart = t;
    } else if (segStart !== null) {
      raw.push({ fromSeconds: segStart, toSeconds: t });
      segStart = null;
    }
  }
  if (segStart !== null)
    raw.push({ fromSeconds: segStart, toSeconds: durationSeconds });

  const enemyIds = new Set(enemies.map((e) => e.id));
  // the owner's pets (a Water Elemental's Freeze, a Treant's root)
  const ownerPetIds = new Set(
    (owner.petSpellCastEvents ?? [])
      .map((c) => c.srcUnitId)
      .filter((id): id is string => !!id),
  );

  const segments: ISlackSegment[] = raw
    .filter((s) => s.toSeconds - s.fromSeconds >= MIN_SLACK_SECONDS)
    .map((s) => {
      const inSeg = (ms: number) => {
        const t = (ms - matchStartMs) / 1000;
        return t >= s.fromSeconds && t < s.toSeconds;
      };
      const ownerDamage = owner.damageOut
        .filter((d) => inSeg(d.logLine.timestamp) && enemyIds.has(d.destUnitId))
        // Damage events carry NEGATIVE effectiveAmount (absorbs positive);
        // max(0,·) counted absorbed-only damage — "your damage 0k" while
        // Starsurges landed (invariant sweep, raw-log verified 2026-07-16).
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      const casts = owner.spellCastEvents.filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          inSeg(e.logLine.timestamp) &&
          e.spellId,
      );
      const ownerCCCasts = casts.filter((e) =>
        isOwnerCcCast(e.spellId as string),
      ).length;
      const ownerKickCasts = casts.filter((e) =>
        isKickSpellId(e.spellId as string),
      ).length;
      const ownerPurgeCasts = ownerPurgeTimesSeconds.filter(
        (t) => t >= s.fromSeconds && t < s.toSeconds,
      ).length;
      // user ruling 2026-10-23 (fact4 D26, 3f433db1 0:14–0:22): a root the
      // owner landed on an enemy is offensive output — Landslide held the
      // enemy healer 0:20.9–0:22.4 inside a span read "zero output"
      const ownerRootLandings = enemies.filter((e) =>
        (e.auraEvents ?? []).some(
          (a) =>
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
            !!a.spellId &&
            rootSpellIds.has(a.spellId) &&
            (a.srcUnitId === owner.id ||
              ownerPetIds.has(a.srcUnitId ?? "")) &&
            inSeg(a.logLine.timestamp),
        ),
      ).length;

      const idle =
        ownerDamage === 0 &&
        ownerCCCasts === 0 &&
        ownerKickCasts === 0 &&
        ownerPurgeCasts === 0 &&
        ownerRootLandings === 0;
      return {
        fromSeconds: s.fromSeconds,
        toSeconds: s.toSeconds,
        durationSeconds: s.toSeconds - s.fromSeconds,
        ownerDamage,
        ownerCCCasts,
        ownerPurgeCasts,
        ownerKickCasts,
        idle,
        teamMinHpPct: teamMinHpPctOver(
          friends,
          s.fromSeconds,
          s.toSeconds,
          matchStartMs,
        ),
      };
    });

  return { advancedLoggingAvailable: true, segments };
}

export function computeContestedSegments(
  combat: {
    startTime: number;
    endTime: number;
    startInfo?: { bracket?: string };
  },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  enemyCDTimeline: IEnemyCDTimeline,
  ownerCCInstances: CCInterval,
  ownerPurgeTimesSeconds: ReadonlyArray<number>,
): { advancedLoggingAvailable: boolean; segments: IContestedSegment[] } {
  const matchStartMs = combat.startTime;
  // A3 (user 2026-10-24): the sweep walks the round, not the log — a Solo
  // Shuffle round is over at its deciding death (`roundEndMs`)
  const durationSeconds = Math.floor(
    (roundEndMs(combat, [...friends, ...enemies]) - combat.startTime) / 1000,
  );

  const advancedLoggingAvailable = friends.every(
    (f) => f.advancedActions.length > 0,
  );
  if (!advancedLoggingAvailable)
    return { advancedLoggingAvailable: false, segments: [] };

  const mobilityTimes = ownerMobilityCastTimes(owner, matchStartMs);

  const isContestedSecond = (t: number): boolean => {
    let hasOneUnderSlackThreshold = false;
    for (const f of friends) {
      const hp = getHpPercentAtTime(f, t, matchStartMs);
      if (hp === null || hp < CONTESTED_TEAM_HP_MIN) return false;
      if (hp < SLACK_TEAM_HP_THRESHOLD) {
        hasOneUnderSlackThreshold = true;
      }
    }
    if (!hasOneUnderSlackThreshold) return false;
    if (isEnemyCDActiveAt(enemyCDTimeline, t)) return false;
    if (isOwnerCCdAt(ownerCCInstances, t)) return false;
    if (mobilityTimes.some((m) => t >= m && t < m + MOBILITY_EXCLUSION_SECONDS))
      return false;
    return true;
  };

  const raw: Array<{ fromSeconds: number; toSeconds: number }> = [];
  let segStart: number | null = null;
  for (let t = 0; t <= durationSeconds; t++) {
    if (isContestedSecond(t)) {
      if (segStart === null) segStart = t;
    } else if (segStart !== null) {
      raw.push({ fromSeconds: segStart, toSeconds: t });
      segStart = null;
    }
  }
  if (segStart !== null)
    raw.push({ fromSeconds: segStart, toSeconds: durationSeconds });

  const enemyIds = new Set(enemies.map((e) => e.id));
  // the owner's pets (a Water Elemental's Freeze, a Treant's root)
  const ownerPetIds = new Set(
    (owner.petSpellCastEvents ?? [])
      .map((c) => c.srcUnitId)
      .filter((id): id is string => !!id),
  );

  const segments: IContestedSegment[] = raw
    .filter((s) => s.toSeconds - s.fromSeconds >= MIN_SLACK_SECONDS)
    .map((s) => {
      const inSeg = (ms: number) => {
        const t = (ms - matchStartMs) / 1000;
        return t >= s.fromSeconds && t < s.toSeconds;
      };
      const ownerDamage = owner.damageOut
        .filter((d) => inSeg(d.logLine.timestamp) && enemyIds.has(d.destUnitId))
        // Damage events carry NEGATIVE effectiveAmount (absorbs positive);
        // max(0,·) counted absorbed-only damage — "your damage 0k" while
        // Starsurges landed (invariant sweep, raw-log verified 2026-07-16).
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      const casts = owner.spellCastEvents.filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          inSeg(e.logLine.timestamp) &&
          e.spellId,
      );
      const ownerCCCasts = casts.filter((e) =>
        isOwnerCcCast(e.spellId as string),
      ).length;
      const ownerKickCasts = casts.filter((e) =>
        isKickSpellId(e.spellId as string),
      ).length;
      const ownerPurgeCasts = ownerPurgeTimesSeconds.filter(
        (t) => t >= s.fromSeconds && t < s.toSeconds,
      ).length;
      // user ruling 2026-10-23 (fact4 D26, 3f433db1 0:14–0:22): a root the
      // owner landed on an enemy is offensive output — Landslide held the
      // enemy healer 0:20.9–0:22.4 inside a span read "zero output"
      const ownerRootLandings = enemies.filter((e) =>
        (e.auraEvents ?? []).some(
          (a) =>
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
            !!a.spellId &&
            rootSpellIds.has(a.spellId) &&
            (a.srcUnitId === owner.id ||
              ownerPetIds.has(a.srcUnitId ?? "")) &&
            inSeg(a.logLine.timestamp),
        ),
      ).length;

      const idle =
        ownerDamage === 0 &&
        ownerCCCasts === 0 &&
        ownerKickCasts === 0 &&
        ownerPurgeCasts === 0 &&
        ownerRootLandings === 0;

      const ownerHealing = (owner.healOut ?? [])
        .filter((h) => inSeg(h.logLine.timestamp))
        .reduce((sum, h) => sum + Math.max(0, h.effectiveAmount), 0);

      return {
        fromSeconds: s.fromSeconds,
        toSeconds: s.toSeconds,
        durationSeconds: s.toSeconds - s.fromSeconds,
        ownerDamage,
        ownerCCCasts,
        ownerPurgeCasts,
        ownerKickCasts,
        idle,
        ownerHealing,
        teamMinHpPct: teamMinHpPctOver(
          friends,
          s.fromSeconds,
          s.toSeconds,
          matchStartMs,
        ),
      };
    });

  return { advancedLoggingAvailable: true, segments };
}

export interface IContestedTradeFact {
  fromSeconds: number;
  toSeconds: number;
  durationSeconds: number;
  teamMinHpPct: number;
  ccSpellName: string;
  /** the owner's cast id of that CC */
  ccSpellId: string;
  /** What of that cast an enemy interrupt can stop, by official data
   * (`interruptibleCastOf`); undefined = DB2 has no row. The line states cast
   * risk — and the interrupt count — only for `bar` / `channel`. */
  ccInterruptible: InterruptibleCast | undefined;
  enemyHealerName: string;
  enemyHealerSpec: string;
  /** 'on CD' | 'available' | 'unknown' at segment start */
  enemyHealerTrinket: string;
  ownerHealing: number;
  ownerCCCasts: number;
  /** Enemy interrupts usable at segment start (`isInterruptUsable`: off
   * cooldown, kicker alive and not in a cast-blocking CC) — cast-risk context,
   * printed only when the named CC has a cast to interrupt. */
  enemyInterruptsReady: number;
}

const CONTESTED_TRADE_TEXT =
  "contested trade: a CC here competed with continued healing";
const CONTESTED_CAST_RISK_TEXT = "AND carried cast risk";
const CONTESTED_INSTANT_TEXT = "(instant: no cast to interrupt)";
const CONTESTED_EV_TEXT = "(EV question, not a verdict).";

/** The three ends a `[CONTESTED]` line can have (`contestedTradeTail`). */
export type ContestedTailForm = "risk" | "instant" | "silent";

/**
 * The end of a `[CONTESTED]` line, after `cast N CC` (FT I12, user ruling
 * 2026-10-11, option b). The line names ONE control — the first of the
 * owner's that was ready at Full DR — and the cast-risk clause is about that
 * one:
 *  - `risk`, a cast bar or a channel: the enemy interrupts ready and `AND
 *    carried cast risk` (the text every line carried until then);
 *  - `instant`: neither — `(instant: no cast to interrupt)`. The interrupt
 *    count is on the line as cast-risk context only, so it goes with the
 *    clause: beside an instant it reads as a threat to a cast that does not
 *    exist;
 *  - `silent`, DB2 has no row for the cast: neither claim.
 */
export function contestedTradeTail(
  interruptible: InterruptibleCast | undefined,
  enemyInterruptsReady: number,
): string {
  if (interruptible === "bar" || interruptible === "channel")
    return `; enemy interrupts ready: ${enemyInterruptsReady} — ${CONTESTED_TRADE_TEXT} ${CONTESTED_CAST_RISK_TEXT} ${CONTESTED_EV_TEXT}`;
  if (interruptible === "none")
    return ` — ${CONTESTED_TRADE_TEXT} ${CONTESTED_INSTANT_TEXT} ${CONTESTED_EV_TEXT}`;
  return ` — ${CONTESTED_TRADE_TEXT} ${CONTESTED_EV_TEXT}`;
}

/** One `[CONTESTED]` line. */
export function formatContestedTradeLine(f: IContestedTradeFact): string {
  return `  [CONTESTED] ${fmtTime(f.fromSeconds)}–${fmtTime(f.toSeconds)} (${f.durationSeconds}s, team min HP ${f.teamMinHpPct}%): ${f.ccSpellName} ready on enemy healer ${f.enemyHealerName} (DR Full, trinket ${f.enemyHealerTrinket}); you healed ${(f.ownerHealing / 1000).toFixed(0)}k, cast ${f.ownerCCCasts} CC${contestedTradeTail(f.ccInterruptible, f.enemyInterruptsReady)}`;
}

/** A whole `[CONTESTED]` line, as the gates (`checkContestedCastRisk`,
 * `scripts/contestedContract.ts`) read it back: 1–2 = the span, 3 = its
 * seconds, 4 = team min HP, 5 = the control's name, 6 = the enemy healer,
 * 7 = their trinket, 8 = healed (k), 9 = CC casts, 10 = the tail
 * (`contestedTradeTail`; `contestedTailForm` reads it). */
export const CONTESTED_LINE_RE_SRC = String.raw`^ {2}\[CONTESTED\] (\d+:\d{2})–(\d+:\d{2}) \((\d+)s, team min HP (\d+)%\): (.+?) ready on enemy healer (\S+) \(DR Full, trinket ([\w ]+?)\); you healed (\d+)k, cast (\d+) CC((?:; enemy interrupts ready: \d+)? — .*)$`;

/** Which `contestedTradeTail` form a rendered tail is — null when it is none
 * of the three to its last character. */
export function contestedTailForm(tail: string): ContestedTailForm | null {
  const risk = /^; enemy interrupts ready: (\d+) — /.exec(tail);
  if (risk)
    return tail === contestedTradeTail("bar", Number(risk[1])) ? "risk" : null;
  if (tail === contestedTradeTail("none", 0)) return "instant";
  if (tail === contestedTradeTail(undefined, 0)) return "silent";
  return null;
}

let contestedFormsByName: Map<string, Set<ContestedTailForm>> | undefined;

/**
 * The tail forms `contestedTradeTail` can give a control of this English
 * name — what a rendered `[CONTESTED]` line, which names its control by name,
 * can be held to. Read from the same ids and the same official predicate as
 * the producer: every CC cast (`isOwnerCcCast`), `interruptibleCastOf` of
 * each. An id that is only another cast's effect aura is not what is pressed
 * (Capacitor Totem's stun 118905 carries the totem's own 2 s; Song of
 * Chi-Ji's disorient 198909 carries none) and is left out. One form for
 * every name but `Fear` on the 12.1 tables (`test/contestedCastRisk.test.ts`
 * pins that); an empty set = no cast of that name has a DB2 row, so the line
 * may claim neither (`silent`, which is never in a set).
 */
export function contestedTailFormsOfName(
  spellName: string,
): ReadonlySet<ContestedTailForm> {
  let byName = contestedFormsByName;
  if (!byName) {
    byName = new Map();
    const ids = new Set<string>(ccSpellIds);
    for (const [cast] of castEffectPairs())
      if (isOwnerCcCast(cast)) ids.add(cast);
    for (const id of ids) {
      const effectOnly =
        castsOfEffectAura(id).length > 0 && effectAurasOfCast(id).length === 0;
      const kind = effectOnly ? undefined : interruptibleCastOf(id);
      if (!kind) continue;
      const name = getEnglishSpellName(id);
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(kind === "none" ? "instant" : "risk");
    }
    // the names load in the background: an index built before they are in
    // would be keyed on ids
    if (spellNamesReady()) contestedFormsByName = byName;
  }
  return byName.get(spellName) ?? new Set();
}

export function computeContestedTradeFacts(
  combat: {
    startTime: number;
    endTime: number;
    /** the round's units, for "is the kicker CC'd" (F-C5b); absent = unknown */
    units?: Record<string, ICombatUnit>;
  },
  owner: ICombatUnit,
  enemies: ICombatUnit[],
  contestedSegments: IContestedSegment[],
  offensiveWindows: IOffensiveWindow[],
  enemyHealerCCInstances: CCWithDR,
  /** the enemy healer's DR history beyond `enemyHealerCCInstances` — its
   * `drHistoryOnly` (fact6 F20: a control reflected back onto it) */
  enemyHealerDrHistoryOnly: CCWithDR = [],
): IContestedTradeFact[] {
  const matchStartMs = combat.startTime;
  // the DR point queries read the whole history (fact6 F20)
  const enemyHealerDrHistory = [
    ...enemyHealerCCInstances,
    ...enemyHealerDrHistoryOnly,
  ];
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec));
  if (!enemyHealer) return [];
  const ccSpells = collectOwnerCCSpells(owner, matchStartMs, [], combat);
  // the caster evidence for a CC cast with variants in different DR
  // families (Chastise: stun / incapacitate)
  const ownerApplied = auraIdsAppliedBy(owner.id, enemies);
  if (ccSpells.length === 0) return [];

  const overlapsKillWindow = (seg: IContestedSegment) =>
    offensiveWindows.some(
      (w) => w.fromSeconds < seg.toSeconds && seg.fromSeconds < w.toSeconds,
    );

  const facts: IContestedTradeFact[] = [];
  // a dead owner holds no control (`isDeadAt`, the one dead-at predicate)
  const ownerDeathMs = firstDeathMs(owner);
  // fact4 D35 / D36 (4dc94d91 3:03–3:14): a span the enemy healer spent in
  // our control offers no control on them — Freezing Trap 3:04.4–3:10.4,
  // then Psychic Scream to 3:16.1, and the line offered Mighty Bash on him.
  // The span needs MIN_SLACK_SECONDS of [STATE] seconds with the healer free.
  const healerCcAt = (t: number) =>
    enemyHealerCCInstances.some(
      (c) => t >= c.atSeconds && t < c.atSeconds + c.durationSeconds,
    );
  for (const seg of contestedSegments) {
    if (overlapsKillWindow(seg)) continue;
    if (matchStartMs + seg.fromSeconds * 1000 >= ownerDeathMs) continue;
    let healerFreeSeconds = 0;
    for (let t = seg.fromSeconds; t < seg.toSeconds; t++)
      if (!healerCcAt(t)) healerFreeSeconds++;
    if (healerFreeSeconds < MIN_SLACK_SECONDS) continue;

    // an unknown DR family (Chastise without caster evidence) is never "at
    // Full DR" (codex 35-CD-13b: getDRLevelAtTime reads no history as Full)
    // ready, at Full DR and able to reach them in ONE second of the span
    // (codex R6C-16 #1: Chastise was ready at 73–75 s and in reach only at
    // 80 s, after it had gone out at 75.8 s — never both, yet the line read
    // "ready on enemy healer")
    const readyAtFullDR = ccSpells.find(
      (s) =>
        drCategoryKnown(s.spellId, ownerApplied) &&
        // the line states the DR at the segment's start
        getDRLevelAtTime(
          enemyHealerDrHistory,
          drCategoryOfCast(s.spellId, ownerApplied),
          seg.fromSeconds,
          matchStartMs,
        ) === "Full" &&
        ccReachesInSpan(
          owner,
          enemyHealer,
          s.spellId,
          combat,
          seg,
          (t) =>
            isCCReadyAt(s, t) &&
            getDRLevelAtTime(
              enemyHealerDrHistory,
              drCategoryOfCast(s.spellId, ownerApplied),
              t,
              matchStartMs,
            ) === "Full",
        ),
    );
    if (!readyAtFullDR) continue;

    const trinketAvailable = getTrinketStateAtTime(
      enemyHealer,
      seg.fromSeconds,
      matchStartMs,
      true,
    );
    const enemyHealerTrinket = trinketAvailable ? "available" : "on CD";

    const interrupts = computeEnemyInterruptAvailability(
      enemies,
      matchStartMs + seg.fromSeconds * 1000,
      combat.units ? Object.values(combat.units) : undefined,
    );
    const enemyInterruptsReady = interrupts.filter(isInterruptUsable).length;

    facts.push({
      fromSeconds: seg.fromSeconds,
      toSeconds: seg.toSeconds,
      durationSeconds: seg.durationSeconds,
      teamMinHpPct: seg.teamMinHpPct,
      ccSpellName: readyAtFullDR.spellName,
      ccSpellId: readyAtFullDR.spellId,
      ccInterruptible: interruptibleCastOf(readyAtFullDR.spellId),
      enemyHealerName: enemyHealer.name,
      enemyHealerSpec: specToString(enemyHealer.spec),
      enemyHealerTrinket,
      ownerHealing: seg.ownerHealing,
      ownerCCCasts: seg.ownerCCCasts,
      enemyInterruptsReady,
    });
  }

  return facts
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .slice(0, MAX_CONTESTED_FACTS);
}

/**
 * Could the owner's CC reach the enemy healer at some whole second of the
 * span — the shared geometry predicate (`ccReachAt`: reach, positions, LoS;
 * unknown fails closed, as the PEEL / CC USE sampler reads it). The
 * `[CONTESTED]` and `[OPPORTUNITY]` "X ready on enemy healer" lines state a
 * CC that could land on that healer (fact5 D18 / D19).
 */
function ccReachesInSpan(
  owner: ICombatUnit,
  healer: ICombatUnit,
  spellId: string,
  combat: {
    startTime: number;
    endTime: number;
    units?: Readonly<Record<string, ICombatUnit>>;
    startInfo?: { zoneId?: unknown };
  },
  seg: { fromSeconds: number; toSeconds: number },
  /** the CC usable at that second as far as readiness / DR go — reach and
   * usability have to hold in the same second */
  usableAt: (t: number) => boolean = () => true,
): boolean {
  const reach = ccThreatReachYards(owner, spellId);
  if (reach === null) return false;
  const zone = String(combat.startInfo?.zoneId ?? "");
  // …and the healer could take it then: no aura that stops this control on
  // the whole rendered second (`ccTargetBlockerIntervals`, the CC sampler's
  // reading — F20 immunity residual: 3 `[CONTESTED] … ready on enemy healer`
  // spans on a priest in Spirit of Redemption, s0/72-1 3:01–3:05)
  const blockers = ccTargetBlockerIntervals(healer, combat, spellId);
  const immuneAt = (t: number) =>
    blockers.some((iv) => iv.fromS < t + 1 && t < iv.toS);
  for (let t = Math.floor(seg.fromSeconds); t < seg.toSeconds; t++)
    if (
      usableAt(Math.max(t, seg.fromSeconds)) &&
      !immuneAt(t) &&
      ccReachAt(owner, healer, reach, zone, combat.startTime + t * 1000).ok
    )
      return true;
  return false;
}

// ── Task 2: Kill-window contribution analysis ──────────────────────────────

export interface IWindowContribution {
  /** Rendered span: a damage-burst sub-window, or the full vulnerability span when unpunished. */
  fromSeconds: number;
  toSeconds: number;
  /** Full vulnerability span this contribution belongs to. */
  vulnFromSeconds: number;
  vulnToSeconds: number;
  /**
   * True when the vulnerability span contained no qualifying team damage burst
   * (enemy sat defenseless, never punished) — rendered as [VULNERABLE], not
   * [KILL WINDOW]. See offensiveWindows.ts burst constants (2026-07-17).
   */
  unpunished: boolean;
  /** Total team damage to the target over the full vulnerability span. */
  teamDamageInVulnSpan: number;
  /** What the target's shields absorbed of the team's hits over the span
   * (fact2 R7), printed beside the total. */
  teamAbsorbedInVulnSpan: number;
  targetName: string;
  targetSpec: string;
  enemyHealerName: string | null;
  enemyHealerSpec: string | null;
  /** Owner CC spells off cooldown at window start (cast-history replay). Empty when the owner cast no CC all match. */
  ownerCCReady: Array<{ spellName: string; enemyHealerDR: DRLevel | null }>;
  ownerCastCCInWindow: boolean;
  /** The health the WINDOW'S TARGET lost to the owner's hits inside the
   * rendered span — the measure of the line's own `team damage … total`
   * (hits on `targetName`, absorbed part not counted). Until T12 ⑤ this was
   * `ownerDamageInWindow`: the owner's damage on every enemy, absorbs
   * included, printed beside a window on one target (78 lines of the 605
   * capture read `team damage 0k total` with `your damage` above 0). */
  ownerDamageOnTarget: number;
  /** What the target's shields absorbed of the owner's hits in the span —
   * printed apart, as `(+Ak absorbed)`. */
  ownerAbsorbedOnTarget: number;
  /** Seconds of the window the owner could cast: not inside any
   * `buildCannotCastIntervals` interval (hard CC, silence, kick lockout). */
  ownerFreeSeconds: number;
  /** Lowest friendly HP% during the window; null without advanced logging. */
  teamMinHpPct: number | null;
  /** GH #31 ① killability gate-facts (shared computer, killWindowFacts.ts). */
  gateFacts: IKillWindowGateFacts;
}

interface IOwnerCCSpell {
  spellId: string;
  spellName: string;
  cooldownSeconds: number;
  /** talent-resolved charge cap (1 for most CC) */
  charges: number;
  castTimesSeconds: number[];
  /** the shared cooldown model's entry (`unitCooldownEntry`, cooldown
   * mastery round 2026-10-20) when the round's units are known */
  model?: IMajorCooldownInfo;
}

/** Owner CC spells observed at least once in cast history (honest availability: never-cast spells are unknowable). */
function collectOwnerCCSpells(
  owner: ICombatUnit,
  matchStartMs: number,
  /** the owner's kit controls (the ledger the [RES] rows and the loadout
   * read), pressed or not: round-1 retest idx 28 — "your CC on cooldown"
   * while the kit's Maim, never pressed, was ready on the [RES] row */
  kitControls: ReadonlyArray<{ spellId: string; spellName: string }> = [],
  /** the round, for the shared cooldown model; absent or without units =
   * the cast list and the static cooldown below */
  combat?: { units?: Record<string, ICombatUnit> },
): IOwnerCCSpell[] {
  const bySpell = new Map<string, IOwnerCCSpell>();
  for (const k of kitControls) {
    const own = unitCooldownOf(owner, k.spellId);
    bySpell.set(k.spellId, {
      spellId: k.spellId,
      spellName: getEnglishSpellName(k.spellId, k.spellName),
      cooldownSeconds: own?.cooldownSeconds ?? 0,
      charges: own?.charges ?? 1,
      castTimesSeconds: [],
    });
  }
  for (const e of owner.spellCastEvents) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId) continue;
    if (!isOwnerCcCast(e.spellId)) continue;
    // The owner's talent-resolved cooldown and charges (`unitCooldownOf`):
    // Psychic Voice, Fist of Justice, Ancient Arts, Voodoo Mastery … were
    // ignored, and a charge-only CC row (no plain cooldown) read 0 = "always
    // ready" (talent impact audit 2026-09-26).
    const own = unitCooldownOf(owner, e.spellId);
    // a cast logged under another id of a kit control (Hex 210873, the
    // Compy variant, against the kit's 51514) is a press of that control
    // (fact3 D14 / D16: the kit entry had no casts and read "ready" in
    // every window, and Hex printed twice)
    const name = getEnglishSpellName(e.spellId, e.spellName);
    const kitKey = bySpell.has(e.spellId)
      ? e.spellId
      : [...bySpell.values()].find(
          (k) =>
            kitControls.some((c) => c.spellId === k.spellId) &&
            k.spellName === name,
        )?.spellId;
    const entry = (kitKey !== undefined ? bySpell.get(kitKey) : undefined) ?? {
      spellId: e.spellId,
      spellName: getEnglishSpellName(e.spellId, e.spellName),
      cooldownSeconds: own?.cooldownSeconds ?? 0,
      charges: own?.charges ?? 1,
      castTimesSeconds: [],
    };
    entry.castTimesSeconds.push((e.logLine.timestamp - matchStartMs) / 1000);
    bySpell.set(kitKey ?? e.spellId, entry);
  }
  const model = (id: string) =>
    combat?.units
      ? unitCooldownEntry(owner, combat as AtomicArenaCombat, id)
      : undefined;
  return [...bySpell.values()].map((s) => {
    const m = model(s.spellId);
    return {
      ...s,
      castTimesSeconds: s.castTimesSeconds.sort((a, b) => a - b),
      ...(m ? { model: m } : {}),
    };
  });
}

function isCCReadyAt(spell: IOwnerCCSpell, atSeconds: number): boolean {
  if (spell.cooldownSeconds <= 0) return true; // spammable CC (no CD data) is always ready
  if (spell.model)
    return cdAvailableAt(
      {
        ...spell.model,
        casts: spell.model.casts.filter((c) => c.timeSeconds < atSeconds),
        ...(spell.model.sharedCasts
          ? {
              sharedCasts: spell.model.sharedCasts.filter(
                (c) => c.timeSeconds < atSeconds,
              ),
            }
          : {}),
      },
      atSeconds,
    );
  if (spell.charges > 1)
    return (
      chargesAvailableAt(
        spell.castTimesSeconds.filter((t) => t < atSeconds),
        spell.cooldownSeconds,
        spell.charges,
        atSeconds,
      ) > 0
    );
  let lastBefore: number | undefined;
  for (const t of spell.castTimesSeconds) {
    if (t < atSeconds) lastBefore = t;
    else break;
  }
  return (
    lastBefore === undefined || lastBefore + spell.cooldownSeconds <= atSeconds
  );
}

type CCWithDR = ReadonlyArray<{
  atSeconds: number;
  durationSeconds: number;
  drInfo: IDRInfo | null;
}>;

export function computeWindowContributions(
  combat: { startTime: number; endTime: number },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  offensiveWindows: IOffensiveWindow[],
  /** When the owner could not cast, epoch ms — `buildCannotCastIntervals`
   * over the enemy players and everything they summoned (hard CC, silences,
   * kick lockouts). NOT the `[CC ON TEAM]` instance list: "free" here means
   * free to act, and a Strangulate or a Pummel lockout is not that (triage
   * other F-O12: 7d1f14af printed "free 6s of 15s" with ~2 s castable). */
  ownerCannotCast: ReadonlyArray<{ from: number; to: number }>,
  enemyHealerCCInstances: CCWithDR,
  factsComputer: IKillWindowFactsComputer,
  /** the enemy healer's DR history beyond `enemyHealerCCInstances` — its
   * `drHistoryOnly` (fact6 F20: a control reflected back onto it) */
  enemyHealerDrHistoryOnly: CCWithDR = [],
): IWindowContribution[] {
  const matchStartMs = combat.startTime;
  // the DR point queries read the whole history (fact6 F20)
  const enemyHealerDrHistory = [
    ...enemyHealerCCInstances,
    ...enemyHealerDrHistoryOnly,
  ];
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec)) ?? null;
  // the kit's controls, when the caller handed a combat with its units (the
  // ledger needs one); a bare clock keeps the cast-history reading
  const kitControls =
    "units" in combat && combat.units
      ? extractMajorCooldowns(owner, combat as never, {
          withBaselineOnly: true,
        }).filter((cd) => isOwnerCcCast(cd.spellId))
      : [];
  // the round for the shared cooldown model (codex 59-POSTHOC-11d #2: only
  // the contested facts passed it — a Capacitor Totem Storm Conduit brought
  // back read "on cooldown" here)
  const ccSpells = collectOwnerCCSpells(
    owner,
    matchStartMs,
    kitControls,
    combat as { units?: Record<string, ICombatUnit> },
  );
  // the caster evidence for a CC cast with variants in different DR
  // families (Chastise: stun / incapacitate)
  const ownerApplied = auraIdsAppliedBy(owner.id, enemies);
  // F16 retest (2026-10-21): a dead owner is not free and holds no control
  // (e49b7c3b 3:39–3:46: "your CC ready: Mighty Bash, Maim, Cyclone … free
  // 7s of 7s" for a druid dead at 3:30) — the death joins the cannot-cast
  // intervals, as `cooldownTiming`'s owner gate reads them
  const ownerDeathMs = firstDeathMs(owner);

  // One contribution per damage burst (kill attempt) inside each vulnerability
  // span; spans with no qualifying burst yield a single unpunished contribution
  // over the full span (2026-07-17 kill-window redesign — spans are a state,
  // bursts are the opportunities).
  const evalSpan = (
    w: IOffensiveWindow,
    fromSeconds: number,
    toSeconds: number,
    unpunished: boolean,
  ): IWindowContribution => {
    const ownerDeadAtStart = matchStartMs + fromSeconds * 1000 >= ownerDeathMs;
    const ownerCCReady = ccSpells
      .filter((s) => !ownerDeadAtStart && isCCReadyAt(s, fromSeconds))
      .map((s) => ({
        spellName: s.spellName,
        // unknown DR family → no DR said (codex 35-CD-13b), never "Full"
        enemyHealerDR:
          enemyHealer && drCategoryKnown(s.spellId, ownerApplied)
            ? getDRLevelAtTime(
                enemyHealerDrHistory,
                drCategoryOfCast(s.spellId, ownerApplied),
                fromSeconds,
                matchStartMs,
              )
            : null,
      }));

    // F16 retest (2026-10-21, idx 26): a control the owner's press applied
    // under an id the cast→effect table does not tie to it — Deep Breath's
    // talent stun Terror of the Skies 372245 on the kill target and the
    // enemy healer read "you cast no CC" (179b83ac 2:53). The control aura
    // itself, sourced from the owner, inside the window's rendered seconds.
    const ownerControlLandedInWindow = enemies.some((en) =>
      (en.auraEvents ?? []).some((a) => {
        if (
          a.logLine.event !== LogEvent.SPELL_AURA_APPLIED ||
          a.srcUnitId !== owner.id ||
          !a.spellId ||
          !ccSpellIds.has(a.spellId)
        )
          return false;
        const t = Math.floor((a.logLine.timestamp - matchStartMs) / 1000);
        return t >= Math.floor(fromSeconds) && t <= Math.floor(toSeconds);
      }),
    );
    const ownerCastCCInWindow =
      ownerControlLandedInWindow ||
      owner.spellCastEvents.some((e) => {
        if (
          e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS ||
          !e.spellId ||
          !isOwnerCcCast(e.spellId)
        )
          return false;
        const t = (e.logLine.timestamp - matchStartMs) / 1000;
        // Rendered-grid rule (invariant sweep I2, 2026-07-16): the window header
        // and the timeline [YOU] [CC] lines both render floored seconds, so the
        // membership test must use the same grid — fractional boundaries made
        // "you cast no CC" coexist with a [YOU] [CC] line at the rendered
        // window edge in 12/1245 prompts.
        return (
          Math.floor(t) >= Math.floor(fromSeconds) &&
          Math.floor(t) <= Math.floor(toSeconds)
        );
      });

    // T12 ⑤ (user ruling 2026-10-10): the owner's damage on THIS window's
    // target. The line is a window on one enemy and prints the team's damage
    // on that enemy; the owner's figure beside it was his damage on every
    // enemy, so `[VULNERABLE] … (team damage 0k total) … your damage 208k`
    // (the target already dead; the 208k went elsewhere). Split the way the
    // team figure is measured: a damage row is health lost (negative in the
    // log convention — hence abs), a SPELL_ABSORBED row is what a shield ate.
    let ownerDamageOnTarget = 0;
    let ownerAbsorbedOnTarget = 0;
    for (const d of owner.damageOut) {
      if (d.destUnitId !== w.targetUnitId) continue;
      const t = (d.logLine.timestamp - matchStartMs) / 1000;
      if (t < fromSeconds || t >= toSeconds) continue;
      if ((d.logLine.event as string) === LogEvent.SPELL_ABSORBED) {
        // a deferral shield's row is no absorb (FT-T02b, `isDeferralAbsorb`)
        if (!isDeferralAbsorb(d))
          ownerAbsorbedOnTarget += Math.abs(d.effectiveAmount);
      } else ownerDamageOnTarget += Math.abs(d.effectiveAmount);
    }

    // Sampled per whole second, as the CC instances were before F-O12: a
    // second is not free when its start lies inside a cannot-cast interval.
    let blockedSeconds = 0;
    for (let t = Math.floor(fromSeconds); t < toSeconds; t++) {
      const ms = matchStartMs + t * 1000;
      if (
        ms >= ownerDeathMs ||
        ownerCannotCast.some((iv) => iv.from <= ms && ms < iv.to)
      )
        blockedSeconds++;
    }
    const ownerFreeSeconds = Math.max(
      0,
      toSeconds - fromSeconds - blockedSeconds,
    );

    // A trough (user ruling 2026-10-16, F15 R1: every printed "lowest /
    // team min" reads the true minimum): the window's own samples, not its
    // whole-second ticks only — 8cd58545 printed `team min HP 33%` over a
    // paladin at 3.8 % between two ticks. Printed only; nothing decides on it.
    let teamMinHpPct: number | null = null;
    for (const f of friends) {
      const low = hpTroughInEventSpan(f, matchStartMs, fromSeconds, toSeconds);
      if (low && (teamMinHpPct === null || low.pct < teamMinHpPct))
        teamMinHpPct = low.pct;
    }

    const targetUnit = enemies.find((e) => e.id === w.targetUnitId) ?? null;
    const gateFacts: IKillWindowGateFacts = targetUnit
      ? factsComputer.facts(targetUnit, fromSeconds, toSeconds)
      : // No unit record for the span target: fail toward acquittal — an
        // accusation must never rest on facts we could not compute.
        {
          readyOffCds: [],
          reachable: null,
          healerLocked: false,
          accountable: false,
        };
    return {
      fromSeconds,
      toSeconds,
      vulnFromSeconds: w.fromSeconds,
      vulnToSeconds: w.toSeconds,
      unpunished,
      teamDamageInVulnSpan: w.friendlyDamageInWindow,
      teamAbsorbedInVulnSpan: w.friendlyAbsorbedInWindow,
      targetName: w.targetName,
      targetSpec: w.targetSpec,
      enemyHealerName: enemyHealer?.name ?? null,
      enemyHealerSpec: enemyHealer ? specToString(enemyHealer.spec) : null,
      ownerCCReady,
      ownerCastCCInWindow,
      ownerDamageOnTarget,
      ownerAbsorbedOnTarget,
      ownerFreeSeconds,
      teamMinHpPct,
      gateFacts,
    };
  };

  // Chronological. The spans arrive grouped per target, so without this the
  // rendered [KILL WINDOW] list jumped back in time whenever a second target
  // had earlier windows (2026-09-15 Opus baseline: 112/309 prompts, e.g.
  // 0:56 / 1:21 / 2:14 / 2:35 / 1:52 / 2:20 — and the line cap below keeps
  // "printed chronologically" only if the input already is).
  return offensiveWindows
    .flatMap((w) =>
      w.bursts.length > 0
        ? w.bursts.map((b) => evalSpan(w, b.fromSeconds, b.toSeconds, false))
        : [evalSpan(w, w.fromSeconds, w.toSeconds, true)],
    )
    .sort((a, b) => a.fromSeconds - b.fromSeconds || a.toSeconds - b.toSeconds);
}

// ── Task 3: Window-creation opportunity facts ──────────────────────────────

export interface IWindowCreationFact {
  atSeconds: number;
  slackDurationSeconds: number;
  ccSpellName: string;
  enemyHealerName: string;
  enemyHealerSpec: string;
  /** Always 'Full' by construction — facts are only emitted at full DR. */
  enemyHealerDRLevel: DRLevel;
  /** Always true by construction — never-observed counts as available (reset
   * at the start of the match) and is filtered out; a fact is only emitted
   * when the trinket is confirmed to be on cooldown. */
  enemyHealerTrinketOnCD: boolean;
}

export function computeWindowCreationFacts(
  combat: { startTime: number; endTime: number },
  owner: ICombatUnit,
  enemies: ICombatUnit[],
  slackSegments: ISlackSegment[],
  offensiveWindows: IOffensiveWindow[],
  enemyHealerCCInstances: CCWithDR,
  /** the enemy healer's DR history beyond `enemyHealerCCInstances` — its
   * `drHistoryOnly` (fact6 F20: a control reflected back onto it) */
  enemyHealerDrHistoryOnly: CCWithDR = [],
): IWindowCreationFact[] {
  const matchStartMs = combat.startTime;
  // the DR point queries read the whole history (fact6 F20)
  const enemyHealerDrHistory = [
    ...enemyHealerCCInstances,
    ...enemyHealerDrHistoryOnly,
  ];
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec));
  if (!enemyHealer) return [];
  const ccSpells = collectOwnerCCSpells(
    owner,
    matchStartMs,
    [],
    combat as { units?: Record<string, ICombatUnit> },
  );
  // the caster evidence for a CC cast with variants in different DR
  // families (Chastise: stun / incapacitate)
  const ownerApplied = auraIdsAppliedBy(owner.id, enemies);
  if (ccSpells.length === 0) return [];

  const overlapsKillWindow = (seg: ISlackSegment) =>
    offensiveWindows.some(
      (w) => w.fromSeconds < seg.toSeconds && seg.fromSeconds < w.toSeconds,
    );

  const facts: IWindowCreationFact[] = [];
  for (const seg of slackSegments) {
    if (overlapsKillWindow(seg)) continue;

    // an unknown DR family (Chastise without caster evidence) is never "at
    // Full DR" (codex 35-CD-13b: getDRLevelAtTime reads no history as Full)
    // ready, at Full DR and able to reach them in ONE second of the span
    // (codex R6C-16 #1: Chastise was ready at 73–75 s and in reach only at
    // 80 s, after it had gone out at 75.8 s — never both, yet the line read
    // "ready on enemy healer")
    const readyAtFullDR = ccSpells.find(
      (s) =>
        drCategoryKnown(s.spellId, ownerApplied) &&
        // the line states the DR at the segment's start
        getDRLevelAtTime(
          enemyHealerDrHistory,
          drCategoryOfCast(s.spellId, ownerApplied),
          seg.fromSeconds,
          matchStartMs,
        ) === "Full" &&
        ccReachesInSpan(
          owner,
          enemyHealer,
          s.spellId,
          combat,
          seg,
          (t) =>
            isCCReadyAt(s, t) &&
            getDRLevelAtTime(
              enemyHealerDrHistory,
              drCategoryOfCast(s.spellId, ownerApplied),
              t,
              matchStartMs,
            ) === "Full",
        ),
    );
    if (!readyAtFullDR) continue;

    const trinketAvailable = getTrinketStateAtTime(
      enemyHealer,
      seg.fromSeconds,
      matchStartMs,
      true,
    );
    // Trinket available (including never observed being used — it resets at
    // the start of the match, so it counts as ready) → the healer can break
    // the opener; not a clean opportunity. Before the 2026-07-22 decision this
    // also let "unknown" through, and 95.5% of [OPPORTUNITY] lines rested on
    // that — implying opportunities that may not have existed.
    if (trinketAvailable) continue;

    facts.push({
      atSeconds: seg.fromSeconds,
      slackDurationSeconds: seg.durationSeconds,
      ccSpellName: readyAtFullDR.spellName,
      enemyHealerName: enemyHealer.name,
      enemyHealerSpec: specToString(enemyHealer.spec),
      enemyHealerDRLevel: "Full",
      enemyHealerTrinketOnCD: true,
    });
  }

  return (
    facts
      // Select the highest-leverage facts (longest slack) …
      .sort((a, b) => b.slackDurationSeconds - a.slackDurationSeconds)
      .slice(0, MAX_WINDOW_CREATION_FACTS)
      // … but RENDER chronologically: judges read the leverage-sorted list
      // ("0:30 before 0:00") as a timeline error (invariant sweep, 2026-07-16).
      .sort((a, b) => a.atSeconds - b.atSeconds)
  );
}

// ── Task 4: Summary entry point + context formatter ───────────────────────

export interface IHealerOffenseSummary {
  advancedLoggingAvailable: boolean;
  slackSegments: ISlackSegment[];
  windowContributions: IWindowContribution[];
  windowCreationFacts: IWindowCreationFact[];
  contestedTradeFacts: IContestedTradeFact[];
  /**
   * CC spells the owner cast at least once this match (cast history, not
   * readiness). The "no owner CC observed this match" fallback must key off
   * this — deriving it from ready-at-window-start lists rendered "no owner CC
   * observed" next to "you cast CC in this window" (164/1245 prompts).
   */
  ownerCCSpellsObserved?: string[];
}

export function buildHealerOffenseSummary(
  combat: {
    startTime: number;
    endTime: number;
    startInfo?: { zoneId?: string; bracket?: string };
    units?: Record<string, ICombatUnit>;
  },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  offensiveWindows: IOffensiveWindow[],
  enemyCDTimeline: IEnemyCDTimeline,
  ownerCCInstances: CCInterval,
  enemyHealerCCInstances: CCWithDR,
  ownerPurgeTimesSeconds: ReadonlyArray<number>,
  /** the enemy healer summary's `drHistoryOnly` (fact6 F20) */
  enemyHealerDrHistoryOnly: CCWithDR = [],
): IHealerOffenseSummary {
  const { advancedLoggingAvailable, segments } = computeSlackSegments(
    combat,
    owner,
    friends,
    enemies,
    enemyCDTimeline,
    ownerCCInstances,
    ownerPurgeTimesSeconds,
  );
  if (!advancedLoggingAvailable) {
    return {
      advancedLoggingAvailable: false,
      slackSegments: [],
      windowContributions: [],
      windowCreationFacts: [],
      contestedTradeFacts: [],
    };
  }

  // F193 V2: contested-trade facts (team 70–85% band) — EV framing, not verdicts.
  const contestedTradeFacts = computeContestedTradeFacts(
    combat,
    owner,
    enemies,
    computeContestedSegments(
      combat,
      owner,
      friends,
      enemies,
      enemyCDTimeline,
      ownerCCInstances,
      ownerPurgeTimesSeconds,
    ).segments,
    offensiveWindows,
    enemyHealerCCInstances,
    enemyHealerDrHistoryOnly,
  );

  return {
    advancedLoggingAvailable: true,
    slackSegments: segments,
    windowContributions: computeWindowContributions(
      combat,
      owner,
      friends,
      enemies,
      offensiveWindows,
      // One predicate for "could not cast", built as `healingGaps` and
      // `positionAnalysis` build it; only the free-seconds count reads it —
      // the slack segments above keep the CC instance list (F-O12's scope).
      buildCannotCastIntervals(
        owner,
        enemySourceIds(enemies, Object.values(combat.units ?? {})),
        Object.values(combat.units ?? {}),
      ),
      enemyHealerCCInstances,
      createKillWindowFactsComputer(combat, friends, enemies),
      enemyHealerDrHistoryOnly,
    ),
    windowCreationFacts: computeWindowCreationFacts(
      combat,
      owner,
      enemies,
      segments,
      offensiveWindows,
      enemyHealerCCInstances,
      enemyHealerDrHistoryOnly,
    ),
    contestedTradeFacts,
    ownerCCSpellsObserved: collectOwnerCCSpells(
      owner,
      combat.startTime,
      [],
      combat as { units?: Record<string, ICombatUnit> },
    ).map((s) => s.spellName),
  };
}

/** `your damage on it Nk[ (+Ak absorbed)]` — the owner clause of a healer
 * `[KILL WINDOW]` / `[VULNERABLE]` line. The absorbed tag is printed when it
 * has a figure at the line's precision (not `0k`). */
function healerWindowOwnerDamage(
  w: Pick<IWindowContribution, "ownerDamageOnTarget" | "ownerAbsorbedOnTarget">,
): string {
  const k = (n: number) => (n / 1000).toFixed(0);
  const absorbed = k(w.ownerAbsorbedOnTarget);
  return `your damage on it ${k(w.ownerDamageOnTarget)}k${absorbed === "0" ? "" : ` (+${absorbed}k absorbed)`}`;
}

/** A healer-view `[VULNERABLE]` line's two damage figures, as the gate
 * (`checkVulnerableOwnerDamage`) reads them back: 1 = the team's on the
 * window's target, 2 = the owner's on it. */
export const VULNERABLE_OWNER_DAMAGE_RE_SRC = String.raw`\[VULNERABLE\] .*\(team damage (\d+)k total(?:, \+\d+k absorbed)?\).*; your damage on it (\d+)k`;

export function formatHealerOffenseForContext(
  summary: IHealerOffenseSummary,
): string[] {
  if (!summary.advancedLoggingAvailable) return [];
  const {
    slackSegments,
    windowContributions,
    windowCreationFacts,
    contestedTradeFacts,
  } = summary;
  if (
    slackSegments.length === 0 &&
    windowContributions.length === 0 &&
    windowCreationFacts.length === 0 &&
    contestedTradeFacts.length === 0
  )
    return [];

  const lines: string[] = [];
  // GH #99 (2026-09-20): the header used to promise "slack-gated facts — team
  // ≥85% HP …" for the WHOLE section, and only the slack lines are gated that
  // way. `[KILL WINDOW]` / `[VULNERABLE]` are enemy-vulnerability spans with no
  // own-team HP gate at all, and `[CONTESTED]` is by construction the 70–85%
  // band — the promise was false for them by design. Measured on the
  // 2026-09-15 Opus baseline: 1028/1109 KILL WINDOW, 72/77 VULNERABLE and
  // 91/91 CONTESTED lines printed a `team min HP` below the 85 the header
  // claimed, in 288 of 309 prompts, while 0/147 SLACK lines did. Each family
  // now states its own condition, so no fact inherits another's gate.
  lines.push("HEALER OFFENSE (each line states the condition it holds under):");

  // Hoist the owner's static CC spell set once instead of repeating the name on every
  // [KILL WINDOW] line (~25 tok/match, 2026-07-09 week-eval tokens.md #5). Readiness and
  // enemy-healer DR stay per-window below — only the name is static.
  const ownerCCSpellNames = [
    ...new Set(
      windowContributions.flatMap((w) =>
        w.ownerCCReady.map((c) => c.spellName),
      ),
    ),
  ];
  const singleOwnerCC =
    ownerCCSpellNames.length === 1 ? ownerCCSpellNames[0] : null;
  if (singleOwnerCC) {
    lines.push(`  Your CC: ${singleOwnerCC}.`);
  }

  const totalSlack = slackSegments.reduce(
    (s, seg) => s + seg.durationSeconds,
    0,
  );
  const idleSegs = slackSegments.filter(
    (s) => s.idle && s.durationSeconds >= IDLE_PRIORITY_SECONDS,
  );
  const idleSlack = slackSegments
    .filter((s) => s.idle)
    .reduce((s, seg) => s + seg.durationSeconds, 0);
  let teamMinLegendShown = false;
  if (slackSegments.length > 0) {
    lines.push(
      // The gate is rendered FROM the constant the sweep uses, so the claim
      // cannot drift from `isSlackSecond` (shared-predicate rule).
      `  Slack time (team ≥${SLACK_TEAM_HP_THRESHOLD}% HP, no enemy offensive CDs active, you un-CC-d): ${totalSlack}s across ${slackSegments.length} segment(s); ${idleSlack}s with zero offensive output.`,
    );
    if (idleSegs.length > 0) {
      lines.push(SLACK_TEAM_MIN_LEGEND);
      teamMinLegendShown = true;
    }
    for (const seg of idleSegs) {
      lines.push(
        `  [SLACK] ${fmtTime(seg.fromSeconds)}–${fmtTime(seg.toSeconds)} (${seg.durationSeconds}s, team min HP ${seg.teamMinHpPct}%): no damage, no CC, no purge, no kick.`,
      );
    }
  }

  // T12 ⑤: what the per-window damage figure is measured on.
  if (windowContributions.length > 0)
    lines.push(
      // (no bracket tags in this line: readers count the window lines by tag)
      "  `your damage on it Nk` on a window line below = the health that window's target lost to your hits in the printed span — the measure of `team damage … total`; `(+Ak absorbed)` = what its shields absorbed of your hits on top (`, +Ak absorbed` after `team damage … total`: of the team's). Your damage on other enemies is not in it.",
    );

  // Cap the per-window lines; keep the highest-free-time windows (printed chronologically) and
  // roll the remainder up so aggregate sufficiency is preserved.
  let shownWindows = windowContributions;
  let omittedWindows: IWindowContribution[] = [];
  if (windowContributions.length > MAX_KILL_WINDOW_LINES) {
    const byFreeDesc = [...windowContributions].sort(
      (a, b) => b.ownerFreeSeconds - a.ownerFreeSeconds,
    );
    const keep = new Set(byFreeDesc.slice(0, MAX_KILL_WINDOW_LINES));
    shownWindows = windowContributions.filter((w) => keep.has(w));
    omittedWindows = windowContributions.filter((w) => !keep.has(w));
  }

  for (const w of shownWindows) {
    const ready =
      w.ownerCCReady.length > 0
        ? singleOwnerCC
          ? // Name hoisted to the "Your CC:" header line above; keep only the per-window state.
            `CC ready${w.ownerCCReady[0].enemyHealerDR ? ` (enemy healer DR: ${w.ownerCCReady[0].enemyHealerDR})` : ""}`
          : `your CC ready: ${w.ownerCCReady
              .map(
                (c) =>
                  `${c.spellName}${c.enemyHealerDR ? ` (enemy healer DR: ${c.enemyHealerDR})` : ""}`,
              )
              .join(", ")}`
        : // Pre-existing wording fix: an empty ready-list can also mean "observed CC is on cooldown
          // at window start" — only claim "not observed" when no CC was seen anywhere in the match.
          // Cast history (ownerCCSpellsObserved) is the authority; the ready-name fallback covers
          // directly-constructed summaries without the field.
          (summary.ownerCCSpellsObserved?.length ?? ownerCCSpellNames.length) >
            0
          ? "your CC on cooldown"
          : "no owner CC observed this match";
    const cast = w.ownerCastCCInWindow
      ? "you cast CC in this window"
      : "you cast no CC";
    const dmg = healerWindowOwnerDamage(w);
    // The denominator is the rendered (floored) window; the free time is
    // continuous, so it can round past it ("free 21s of 20s", 193 of 3,956
    // KILL WINDOW lines on the 2026-09-30 605-file capture). Free time cannot
    // exceed the window it sits in — cap it at the number the line prints.
    // `ownerFreeSeconds` is the window's length minus its blocked whole
    // seconds, clamped at zero: exactly 0 when every sampled second was
    // blocked — `free 0s` is then the fact — and a positive remainder under
    // half a second when a sampled second was free in a window that ends
    // inside it, which printed `free 0s` as well. That one is `free <1s`
    // (`fmtWholeSecondsOrZero`; `checkFreeOfWindowConsistency` reads both
    // through `parseWholeSeconds`).
    const windowS = renderedWindowSeconds(w.fromSeconds, w.toSeconds);
    const free = `free ${fmtWholeSecondsOrZero(Math.min(w.ownerFreeSeconds, windowS))} of ${windowS}s`;
    const teamHp =
      w.teamMinHpPct !== null
        ? `, team min HP ${Math.round(w.teamMinHpPct)}%`
        : "";
    if (w.unpunished) {
      // No qualifying team damage burst in the whole vulnerability span — the
      // missed-opportunity case. GH #31 ① (2026-09-02): the accusation
      // ("never punished") now passes through the killability gate — a span
      // with no ready offensive CD or a provably unreachable target renders
      // as an acquitted state, never a reproach (the value-gate smoke showed
      // teams killing WITHOUT ready CDs, so the gate binds only this side).
      const verdict = w.gateFacts.accountable
        ? "never punished"
        : `not punished — not accountable (${killWindowAcquittal(w.gateFacts)})`;
      lines.push(
        `  [VULNERABLE] ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} (${renderedWindowSeconds(w.fromSeconds, w.toSeconds)}s) on ${w.targetSpec} (${w.targetName}): no major defensives, ${verdict} (${teamDamageTotalClause(w.teamDamageInVulnSpan, w.teamAbsorbedInVulnSpan)}); ${killWindowFactsSuffix(w.gateFacts)}; ${ready}; ${cast}; ${dmg}; ${free}${teamHp}.`,
      );
    } else {
      // Kill windows are team-damage bursts inside the vulnerability span; the
      // span itself is appended when it extends meaningfully past the burst.
      const spanNote =
        w.vulnToSeconds - w.vulnFromSeconds > w.toSeconds - w.fromSeconds + 2
          ? `; target defenseless ${fmtTime(w.vulnFromSeconds)}–${fmtTime(w.vulnToSeconds)}`
          : "";
      lines.push(
        `  [KILL WINDOW] ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} on ${w.targetSpec} (${w.targetName}): ${killWindowFactsSuffix(w.gateFacts)}; ${ready}; ${cast}; ${dmg}; ${free}${teamHp}${spanNote}.`,
      );
    }
  }

  if (omittedWindows.length > 0) {
    const omDmg = omittedWindows.reduce((s, w) => s + w.ownerDamageOnTarget, 0);
    const omCC = omittedWindows.filter((w) => w.ownerCastCCInWindow).length;
    lines.push(
      `  [+${omittedWindows.length} more windows omitted (least free time): your damage on their targets ${(omDmg / 1000).toFixed(0)}k total, CC cast in ${omCC} of ${omittedWindows.length}]`,
    );
  }

  for (const f of windowCreationFacts) {
    lines.push(
      `  [OPPORTUNITY] ${fmtTime(f.atSeconds)} (slack ${f.slackDurationSeconds}s): ${f.ccSpellName} ready; enemy healer ${f.enemyHealerName} DR Full, trinket on CD (opportunity, not a verdict).`,
    );
  }

  if (summary.contestedTradeFacts.length > 0 && !teamMinLegendShown)
    lines.push(SLACK_TEAM_MIN_LEGEND);
  for (const f of summary.contestedTradeFacts)
    lines.push(formatContestedTradeLine(f));

  // The "facts, not conclusions / cross-check the timeline / valid uses of slack" guidance is
  // already in the system prompt's healer-offense rules — repeating it here cost ~35 tok/match
  // (2026-07-09 week-eval tokens.md #4). "Outranks" is NOT in the system prompt, so it stays.
  lines.push("  Note: healing under pressure always outranks offense.");
  // fact2 C8: a press-only cooldown named on a window line says what it is
  const firstWindow = lines.findIndex(
    (l) => l.startsWith("  [KILL WINDOW]") || l.startsWith("  [VULNERABLE]"),
  );
  if (firstWindow >= 0 && lines.some(hasPressOnlyTag))
    lines.splice(firstWindow, 0, PRESS_ONLY_LEGEND);
  return lines;
}
