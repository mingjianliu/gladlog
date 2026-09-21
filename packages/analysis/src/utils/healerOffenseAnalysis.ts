import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import { isHealerSpec, specToString } from "./cooldowns";
import {
  DRLevel,
  getDRCategory,
  getDRLevelAtTime,
  IDRInfo,
} from "./drAnalysis";
import { IEnemyCDTimeline } from "./enemyCDs";
import { computeEnemyInterruptAvailability } from "./enemyInterrupts";
import {
  createKillWindowFactsComputer,
  type IKillWindowFactsComputer,
  type IKillWindowGateFacts,
  killWindowAcquittal,
  killWindowFactsSuffix,
} from "./killWindowFacts";
import {
  getHpPercentAtTime,
  getTrinketStateAtTime,
} from "./killWindowTargetSelection";
import { IOffensiveWindow } from "./offensiveWindows";
import { fmtTime, renderedWindowSeconds } from "./renderGrid";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** Local feature flags, mirroring DISPEL_FEATURE_FLAGS pattern. */
export const HEALER_OFFENSE_FLAGS = {
  V1_SLACK_GATED: true,
  /** F193 V2: contested-trade facts (team 70–85% band) — EV framing, not verdicts. */
  V2_CONTESTED_TRADES: true,
};

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
}

export interface IContestedSegment extends ISlackSegment {
  ownerHealing: number;
  teamMinHpPct: number;
}

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
  combat: { startTime: number; endTime: number },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  enemyCDTimeline: IEnemyCDTimeline,
  ownerCCInstances: CCInterval,
  ownerPurgeTimesSeconds: ReadonlyArray<number>,
): { advancedLoggingAvailable: boolean; segments: ISlackSegment[] } {
  const matchStartMs = combat.startTime;
  const durationSeconds = Math.floor(
    (combat.endTime - combat.startTime) / 1000,
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
        ccSpellIds.has(e.spellId as string),
      ).length;
      const ownerKickCasts = casts.filter(
        (e) => SPELLS[e.spellId as string]?.type === "interrupts",
      ).length;
      const ownerPurgeCasts = ownerPurgeTimesSeconds.filter(
        (t) => t >= s.fromSeconds && t < s.toSeconds,
      ).length;

      const idle =
        ownerDamage === 0 &&
        ownerCCCasts === 0 &&
        ownerKickCasts === 0 &&
        ownerPurgeCasts === 0;
      return {
        fromSeconds: s.fromSeconds,
        toSeconds: s.toSeconds,
        durationSeconds: s.toSeconds - s.fromSeconds,
        ownerDamage,
        ownerCCCasts,
        ownerPurgeCasts,
        ownerKickCasts,
        idle,
      };
    });

  return { advancedLoggingAvailable: true, segments };
}

export function computeContestedSegments(
  combat: { startTime: number; endTime: number },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  enemyCDTimeline: IEnemyCDTimeline,
  ownerCCInstances: CCInterval,
  ownerPurgeTimesSeconds: ReadonlyArray<number>,
): { advancedLoggingAvailable: boolean; segments: IContestedSegment[] } {
  const matchStartMs = combat.startTime;
  const durationSeconds = Math.floor(
    (combat.endTime - combat.startTime) / 1000,
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
        ccSpellIds.has(e.spellId as string),
      ).length;
      const ownerKickCasts = casts.filter(
        (e) => SPELLS[e.spellId as string]?.type === "interrupts",
      ).length;
      const ownerPurgeCasts = ownerPurgeTimesSeconds.filter(
        (t) => t >= s.fromSeconds && t < s.toSeconds,
      ).length;

      const idle =
        ownerDamage === 0 &&
        ownerCCCasts === 0 &&
        ownerKickCasts === 0 &&
        ownerPurgeCasts === 0;

      const ownerHealing = (owner.healOut ?? [])
        .filter((h) => inSeg(h.logLine.timestamp))
        .reduce((sum, h) => sum + Math.max(0, h.effectiveAmount), 0);

      let teamMinHpPct = 100;
      let foundHp = false;
      for (const f of friends) {
        // Segment is [from, to): toSeconds is the first second that FAILED the band
        // predicate — sampling it would report a min below the 70% floor.
        for (let t = s.fromSeconds; t < s.toSeconds; t++) {
          const hp = getHpPercentAtTime(f, t, matchStartMs);
          if (hp !== null) {
            if (!foundHp || hp < teamMinHpPct) {
              teamMinHpPct = hp;
              foundHp = true;
            }
          }
        }
      }

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
        teamMinHpPct: Math.round(foundHp ? teamMinHpPct : 100),
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
  enemyHealerName: string;
  enemyHealerSpec: string;
  /** 'on CD' | 'available' | 'unknown' at segment start */
  enemyHealerTrinket: string;
  ownerHealing: number;
  ownerCCCasts: number;
  /** Enemy interrupts ready (cdRemainingSeconds === 0) at segment start — cast-risk context. */
  enemyInterruptsReady: number;
}

export function computeContestedTradeFacts(
  combat: { startTime: number; endTime: number },
  owner: ICombatUnit,
  enemies: ICombatUnit[],
  contestedSegments: IContestedSegment[],
  offensiveWindows: IOffensiveWindow[],
  enemyHealerCCInstances: CCWithDR,
): IContestedTradeFact[] {
  const matchStartMs = combat.startTime;
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec));
  if (!enemyHealer) return [];
  const ccSpells = collectOwnerCCSpells(owner, matchStartMs);
  if (ccSpells.length === 0) return [];

  const overlapsKillWindow = (seg: IContestedSegment) =>
    offensiveWindows.some(
      (w) => w.fromSeconds < seg.toSeconds && seg.fromSeconds < w.toSeconds,
    );

  const facts: IContestedTradeFact[] = [];
  for (const seg of contestedSegments) {
    if (overlapsKillWindow(seg)) continue;

    const readyAtFullDR = ccSpells.find(
      (s) =>
        isCCReadyAt(s, seg.fromSeconds) &&
        getDRLevelAtTime(
          enemyHealerCCInstances,
          getDRCategory(s.spellId),
          seg.fromSeconds,
          matchStartMs,
        ) === "Full",
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
    );
    const enemyInterruptsReady = interrupts.filter(
      (i) => i.cdRemainingSeconds === 0,
    ).length;

    facts.push({
      fromSeconds: seg.fromSeconds,
      toSeconds: seg.toSeconds,
      durationSeconds: seg.durationSeconds,
      teamMinHpPct: seg.teamMinHpPct,
      ccSpellName: readyAtFullDR.spellName,
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
  targetName: string;
  targetSpec: string;
  enemyHealerName: string | null;
  enemyHealerSpec: string | null;
  /** Owner CC spells off cooldown at window start (cast-history replay). Empty when the owner cast no CC all match. */
  ownerCCReady: Array<{ spellName: string; enemyHealerDR: DRLevel | null }>;
  ownerCastCCInWindow: boolean;
  ownerDamageInWindow: number;
  /** Seconds of the window the owner was NOT in CC. */
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
  castTimesSeconds: number[];
}

/** Owner CC spells observed at least once in cast history (honest availability: never-cast spells are unknowable). */
function collectOwnerCCSpells(
  owner: ICombatUnit,
  matchStartMs: number,
): IOwnerCCSpell[] {
  const bySpell = new Map<string, IOwnerCCSpell>();
  for (const e of owner.spellCastEvents) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId) continue;
    if (!ccSpellIds.has(e.spellId)) continue;
    const entry = bySpell.get(e.spellId) ?? {
      spellId: e.spellId,
      spellName: getEnglishSpellName(e.spellId, e.spellName),
      cooldownSeconds: spellEffectData[e.spellId]?.cooldownSeconds ?? 0,
      castTimesSeconds: [],
    };
    entry.castTimesSeconds.push((e.logLine.timestamp - matchStartMs) / 1000);
    bySpell.set(e.spellId, entry);
  }
  return [...bySpell.values()].map((s) => ({
    ...s,
    castTimesSeconds: s.castTimesSeconds.sort((a, b) => a - b),
  }));
}

function isCCReadyAt(spell: IOwnerCCSpell, atSeconds: number): boolean {
  if (spell.cooldownSeconds <= 0) return true; // spammable CC (no CD data) is always ready
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
  ownerCCInstances: CCInterval,
  enemyHealerCCInstances: CCWithDR,
  factsComputer: IKillWindowFactsComputer,
): IWindowContribution[] {
  const matchStartMs = combat.startTime;
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec)) ?? null;
  const ccSpells = collectOwnerCCSpells(owner, matchStartMs);
  const enemyIds = new Set(enemies.map((e) => e.id));

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
    const ownerCCReady = ccSpells
      .filter((s) => isCCReadyAt(s, fromSeconds))
      .map((s) => ({
        spellName: s.spellName,
        enemyHealerDR: enemyHealer
          ? getDRLevelAtTime(
              enemyHealerCCInstances,
              getDRCategory(s.spellId),
              fromSeconds,
              matchStartMs,
            )
          : null,
      }));

    const ownerCastCCInWindow = owner.spellCastEvents.some((e) => {
      if (
        e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS ||
        !e.spellId ||
        !ccSpellIds.has(e.spellId)
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

    const ownerDamageInWindow = owner.damageOut
      .filter((d) => {
        const t = (d.logLine.timestamp - matchStartMs) / 1000;
        return t >= fromSeconds && t < toSeconds && enemyIds.has(d.destUnitId);
      })
      // Same sign fix as the slack segments above: damage is negative in the
      // log convention; max(0,·) yielded absorb-only "your damage" figures.
      .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);

    let ccdSeconds = 0;
    for (let t = Math.floor(fromSeconds); t < toSeconds; t++) {
      if (isOwnerCCdAt(ownerCCInstances, t)) ccdSeconds++;
    }
    const ownerFreeSeconds = Math.max(0, toSeconds - fromSeconds - ccdSeconds);

    let teamMinHpPct: number | null = null;
    for (const f of friends) {
      for (let t = Math.ceil(fromSeconds); t <= Math.floor(toSeconds); t++) {
        const hp = getHpPercentAtTime(f, t, matchStartMs);
        if (hp !== null && (teamMinHpPct === null || hp < teamMinHpPct))
          teamMinHpPct = hp;
      }
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
      targetName: w.targetName,
      targetSpec: w.targetSpec,
      enemyHealerName: enemyHealer?.name ?? null,
      enemyHealerSpec: enemyHealer ? specToString(enemyHealer.spec) : null,
      ownerCCReady,
      ownerCastCCInWindow,
      ownerDamageInWindow,
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
): IWindowCreationFact[] {
  const matchStartMs = combat.startTime;
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec));
  if (!enemyHealer) return [];
  const ccSpells = collectOwnerCCSpells(owner, matchStartMs);
  if (ccSpells.length === 0) return [];

  const overlapsKillWindow = (seg: ISlackSegment) =>
    offensiveWindows.some(
      (w) => w.fromSeconds < seg.toSeconds && seg.fromSeconds < w.toSeconds,
    );

  const facts: IWindowCreationFact[] = [];
  for (const seg of slackSegments) {
    if (overlapsKillWindow(seg)) continue;

    const readyAtFullDR = ccSpells.find(
      (s) =>
        isCCReadyAt(s, seg.fromSeconds) &&
        getDRLevelAtTime(
          enemyHealerCCInstances,
          getDRCategory(s.spellId),
          seg.fromSeconds,
          matchStartMs,
        ) === "Full",
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
    startInfo?: { zoneId?: string };
  },
  owner: ICombatUnit,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  offensiveWindows: IOffensiveWindow[],
  enemyCDTimeline: IEnemyCDTimeline,
  ownerCCInstances: CCInterval,
  enemyHealerCCInstances: CCWithDR,
  ownerPurgeTimesSeconds: ReadonlyArray<number>,
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

  const contestedTradeFacts = HEALER_OFFENSE_FLAGS.V2_CONTESTED_TRADES
    ? computeContestedTradeFacts(
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
      )
    : [];

  return {
    advancedLoggingAvailable: true,
    slackSegments: segments,
    windowContributions: computeWindowContributions(
      combat,
      owner,
      friends,
      enemies,
      offensiveWindows,
      ownerCCInstances,
      enemyHealerCCInstances,
      createKillWindowFactsComputer(combat, friends, enemies),
    ),
    windowCreationFacts: computeWindowCreationFacts(
      combat,
      owner,
      enemies,
      segments,
      offensiveWindows,
      enemyHealerCCInstances,
    ),
    contestedTradeFacts,
    ownerCCSpellsObserved: collectOwnerCCSpells(owner, combat.startTime).map(
      (s) => s.spellName,
    ),
  };
}

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
  if (slackSegments.length > 0) {
    lines.push(
      // The gate is rendered FROM the constant the sweep uses, so the claim
      // cannot drift from `isSlackSecond` (shared-predicate rule).
      `  Slack time (team ≥${SLACK_TEAM_HP_THRESHOLD}% HP, no enemy offensive CDs active, you un-CC-d): ${totalSlack}s across ${slackSegments.length} segment(s); ${idleSlack}s with zero offensive output.`,
    );
    for (const seg of idleSegs) {
      lines.push(
        `  [SLACK] ${fmtTime(seg.fromSeconds)}–${fmtTime(seg.toSeconds)} (${seg.durationSeconds}s): no damage, no CC, no purge, no kick.`,
      );
    }
  }

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
    const dmg = `your damage ${(w.ownerDamageInWindow / 1000).toFixed(0)}k`;
    const free = `free ${Math.round(w.ownerFreeSeconds)}s of ${renderedWindowSeconds(w.fromSeconds, w.toSeconds)}s`;
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
        `  [VULNERABLE] ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} (${renderedWindowSeconds(w.fromSeconds, w.toSeconds)}s) on ${w.targetSpec} (${w.targetName}): no major defensives, ${verdict} (team damage ${(w.teamDamageInVulnSpan / 1000).toFixed(0)}k total); ${killWindowFactsSuffix(w.gateFacts)}; ${ready}; ${cast}; ${dmg}; ${free}${teamHp}.`,
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
    const omDmg = omittedWindows.reduce((s, w) => s + w.ownerDamageInWindow, 0);
    const omCC = omittedWindows.filter((w) => w.ownerCastCCInWindow).length;
    lines.push(
      `  [+${omittedWindows.length} more windows omitted (least free time): your damage ${(omDmg / 1000).toFixed(0)}k total, CC cast in ${omCC} of ${omittedWindows.length}]`,
    );
  }

  for (const f of windowCreationFacts) {
    lines.push(
      `  [OPPORTUNITY] ${fmtTime(f.atSeconds)} (slack ${f.slackDurationSeconds}s): ${f.ccSpellName} ready; enemy healer ${f.enemyHealerName} DR Full, trinket on CD (opportunity, not a verdict).`,
    );
  }

  for (const f of summary.contestedTradeFacts) {
    lines.push(
      `  [CONTESTED] ${fmtTime(f.fromSeconds)}–${fmtTime(f.toSeconds)} (${f.durationSeconds}s, team min HP ${f.teamMinHpPct}%): ${f.ccSpellName} ready on enemy healer ${f.enemyHealerName} (DR Full, trinket ${f.enemyHealerTrinket}); you healed ${(f.ownerHealing / 1000).toFixed(0)}k, cast ${f.ownerCCCasts} CC; enemy interrupts ready: ${f.enemyInterruptsReady} — contested trade: a CC here competed with continued healing AND carried cast risk (EV question, not a verdict).`,
    );
  }

  // The "facts, not conclusions / cross-check the timeline / valid uses of slack" guidance is
  // already in the system prompt's healer-offense rules — repeating it here cost ~35 tok/match
  // (2026-07-09 week-eval tokens.md #4). "Outranks" is NOT in the system prompt, so it stays.
  lines.push("  Note: healing under pressure always outranks offense.");
  return lines;
}
