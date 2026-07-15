import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { ccSpellIds } from "../data/spellTags";
import { fmtTime, isHealerSpec, specToString } from "./cooldowns";
import {
  DRLevel,
  getDRCategory,
  getDRLevelAtTime,
  IDRInfo,
} from "./drAnalysis";
import { IEnemyCDTimeline } from "./enemyCDs";
import { computeEnemyInterruptAvailability } from "./enemyInterrupts";
import {
  getHpPercentAtTime,
  getTrinketStateAtTime,
} from "./killWindowTargetSelection";
import { IOffensiveWindow } from "./offensiveWindows";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** Local feature flags, mirroring DISPEL_FEATURE_FLAGS pattern. */
export const HEALER_OFFENSE_FLAGS = {
  V1_SLACK_GATED: true,
  /** F193 V2: contested-trade facts (team 70–85% band) — EV framing, not verdicts. */
  V2_CONTESTED_TRADES: true,
};

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
        ) === "Full",
    );
    if (!readyAtFullDR) continue;

    const trinketAvailable = getTrinketStateAtTime(
      enemyHealer,
      seg.fromSeconds,
      matchStartMs,
      true,
    );
    const enemyHealerTrinket =
      trinketAvailable === true
        ? "available"
        : trinketAvailable === false
          ? "on CD"
          : "unknown";

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
  fromSeconds: number;
  toSeconds: number;
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
): IWindowContribution[] {
  const matchStartMs = combat.startTime;
  const enemyHealer = enemies.find((e) => isHealerSpec(e.spec)) ?? null;
  const ccSpells = collectOwnerCCSpells(owner, matchStartMs);
  const enemyIds = new Set(enemies.map((e) => e.id));

  return offensiveWindows.map((w) => {
    const ownerCCReady = ccSpells
      .filter((s) => isCCReadyAt(s, w.fromSeconds))
      .map((s) => ({
        spellName: s.spellName,
        enemyHealerDR: enemyHealer
          ? getDRLevelAtTime(
              enemyHealerCCInstances,
              getDRCategory(s.spellId),
              w.fromSeconds,
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
        Math.floor(t) >= Math.floor(w.fromSeconds) &&
        Math.floor(t) <= Math.floor(w.toSeconds)
      );
    });

    const ownerDamageInWindow = owner.damageOut
      .filter((d) => {
        const t = (d.logLine.timestamp - matchStartMs) / 1000;
        return (
          t >= w.fromSeconds && t < w.toSeconds && enemyIds.has(d.destUnitId)
        );
      })
      // Same sign fix as the slack segments above: damage is negative in the
      // log convention; max(0,·) yielded absorb-only "your damage" figures.
      .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);

    let ccdSeconds = 0;
    for (let t = Math.floor(w.fromSeconds); t < w.toSeconds; t++) {
      if (isOwnerCCdAt(ownerCCInstances, t)) ccdSeconds++;
    }
    const ownerFreeSeconds = Math.max(0, w.durationSeconds - ccdSeconds);

    let teamMinHpPct: number | null = null;
    for (const f of friends) {
      for (
        let t = Math.ceil(w.fromSeconds);
        t <= Math.floor(w.toSeconds);
        t++
      ) {
        const hp = getHpPercentAtTime(f, t, matchStartMs);
        if (hp !== null && (teamMinHpPct === null || hp < teamMinHpPct))
          teamMinHpPct = hp;
      }
    }

    return {
      fromSeconds: w.fromSeconds,
      toSeconds: w.toSeconds,
      targetName: w.targetName,
      targetSpec: w.targetSpec,
      enemyHealerName: enemyHealer?.name ?? null,
      enemyHealerSpec: enemyHealer ? specToString(enemyHealer.spec) : null,
      ownerCCReady,
      ownerCastCCInWindow,
      ownerDamageInWindow,
      ownerFreeSeconds,
      teamMinHpPct,
    };
  });
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
  /** true = trinket known on CD; null = trinket never observed (state unknown). */
  enemyHealerTrinketOnCD: boolean | null;
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
        ) === "Full",
    );
    if (!readyAtFullDR) continue;

    const trinketAvailable = getTrinketStateAtTime(
      enemyHealer,
      seg.fromSeconds,
      matchStartMs,
      true,
    );
    // trinketAvailable === true → healer can break the opener; not a clean opportunity
    if (trinketAvailable === true) continue;

    facts.push({
      atSeconds: seg.fromSeconds,
      slackDurationSeconds: seg.durationSeconds,
      ccSpellName: readyAtFullDR.spellName,
      enemyHealerName: enemyHealer.name,
      enemyHealerSpec: specToString(enemyHealer.spec),
      enemyHealerDRLevel: "Full",
      enemyHealerTrinketOnCD: trinketAvailable === null ? null : true,
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
}

export function buildHealerOffenseSummary(
  combat: { startTime: number; endTime: number },
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
  lines.push(
    "HEALER OFFENSE (slack-gated facts — team ≥85% HP, no enemy offensive CDs active, you un-CC-d):",
  );

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
      `  Slack time: ${totalSlack}s across ${slackSegments.length} segment(s); ${idleSlack}s with zero offensive output.`,
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
          ownerCCSpellNames.length > 0
          ? "your CC on cooldown"
          : "no owner CC observed this match";
    const cast = w.ownerCastCCInWindow
      ? "you cast CC in this window"
      : "you cast no CC";
    const dmg = `your damage ${(w.ownerDamageInWindow / 1000).toFixed(0)}k`;
    const free = `free ${Math.round(w.ownerFreeSeconds)}s of ${Math.round(w.toSeconds - w.fromSeconds)}s`;
    const teamHp =
      w.teamMinHpPct !== null
        ? `, team min HP ${Math.round(w.teamMinHpPct)}%`
        : "";
    lines.push(
      `  [KILL WINDOW] ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} on ${w.targetSpec} (${w.targetName}): ${ready}; ${cast}; ${dmg}; ${free}${teamHp}.`,
    );
  }

  if (omittedWindows.length > 0) {
    const omDmg = omittedWindows.reduce((s, w) => s + w.ownerDamageInWindow, 0);
    const omCC = omittedWindows.filter((w) => w.ownerCastCCInWindow).length;
    lines.push(
      `  [+${omittedWindows.length} more kill windows omitted (least free time): your damage ${(omDmg / 1000).toFixed(0)}k total, CC cast in ${omCC} of ${omittedWindows.length}]`,
    );
  }

  for (const f of windowCreationFacts) {
    const trinket =
      f.enemyHealerTrinketOnCD === true
        ? "trinket on CD"
        : "trinket state unknown (never observed)";
    lines.push(
      `  [OPPORTUNITY] ${fmtTime(f.atSeconds)} (slack ${f.slackDurationSeconds}s): ${f.ccSpellName} ready; enemy healer ${f.enemyHealerName} DR Full, ${trinket} (opportunity, not a verdict).`,
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
