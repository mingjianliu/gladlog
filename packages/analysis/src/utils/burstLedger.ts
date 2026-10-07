import { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import {
  gridHpMinInWindow,
  gridHpPct,
  isDeadAtRenderSecond,
  isHpTroughWorthPrinting,
  SELF_CAST_NOOP_EXTERNAL_IDS,
} from "./cooldowns";
import { IEnemyCDCast, reconstructEnemyCDTimeline } from "./enemyCDs";
import { type IKickAuditEntry, jukedByStoppedChannelText } from "./kickAudit";
import { MIN_WINDOW_SECONDS } from "./killWindowTargetSelection";
import { IOffensiveWindow } from "./offensiveWindows";
import { fmtTime, toRenderSecond } from "./renderGrid";
import { FULL_IMMUNITY_IDS } from "./enemyDefensives";
import { buildFilteredAuraIntervals } from "./utils";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** Immunity + major-defensive ids a burst can be wasted into (same list the kill-window
 * target snapshot uses for "defensives spent"). */
// GH #31 ② (2026-09-02): shared official-face predicate replaces the hand set
// (immunities stay — immuneSchools covers most, the category term keeps parity
// for entries the face lacks).
import { isKillWindowMajorDefensive } from "../data/abilityProfile";
import { spellEffectData } from "../data/spellEffectData";
const DEF_OR_IMMUNE_IDS = new Set<string>([
  // Enumerate the official universe through the shared predicate — the same
  // ids the span state machine reasons with, so the two can never disagree.
  ...Object.keys(spellEffectData).filter(isKillWindowMajorDefensive),
  ...Object.keys(SPELLS).filter((id) => SPELLS[id]?.type === "immunities"),
]);

/** A target death up to this long after the burst ends still credits the burst. */
/** Death within this many seconds after a span still credits the span as the
 * kill. Exported 2026-08-18: killAttempts.ts judges "did this attempt convert"
 * with the same slack — one credit predicate, not two (CLAUDE.md rule). */
export const KILL_CREDIT_SLACK_S = 5;
/** Defensive overlaps shorter than this are noise (aura edge vs burst edge).
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 2,244 DPS player-rounds / 5,895
 * bursts / 3,086 kept defensive hits: overlap [0.5,1) 112 · [1,2) 270 ·
 * [2,3) 299 · [3,5) 467 · [5,8) 744 · ≥ 8 1,194 (p50 6.4 s). Only 3.6 % of
 * kept hits sit in the first half-second above the cut, so 0.5 s trims edge
 * noise without touching the mass. Measured, not official. */
const MIN_DEFENSIVE_OVERLAP_S = 0.5;

export interface IBurstDefensiveHit {
  spellId: string;
  spellName: string;
  /** Seconds the defensive/immunity was active inside the burst span. */
  overlapSeconds: number;
  /** true = full immunity (Divine Shield / Turtle class); false = major damage reduction. */
  isImmunity: boolean;
  /** true = the aura was applied by a unit OTHER than the target (a talent-shared
   * wall such as Flameshaper Obsidian Scales on an ally). Consumers price it
   * through `resolveMitigation(id, { carrierIsCaster: !appliedByOther })`. Optional so hand-built
   * fixtures stay valid; absent means "the target's own". */
  appliedByOther?: boolean;
  /** name of the unit that cast the aura (GH #96 M3b: talents belong to the
   * caster). Optional for hand-built fixtures. */
  casterName?: string;
  /** Seconds from the burst's start to the aura's application, one decimal;
   *  ≤ 0 = already up when the burst opened. Reliability round 2 (a0a4,
   *  1c12): "Target had a major defensive up" was read as "you opened into
   *  it" when the wall was the target's reaction (Barkskin 1.24 s after
   *  Bestial Wrath). Optional for hand-built fixtures. */
  startOffsetSeconds?: number;
  /** The same offset, raw ms — the up-at-opening decision reads THIS, not the
   *  rounded display value (codex review of batch 12: a wall 30 ms after the
   *  opening rounded to 0.0 and read "already up"). */
  startOffsetMs?: number;
}

/** Was the wall already up when the burst opened? One predicate for the
 *  ledger line and burst-into-mitigation (user ruling 2026-09-26: only a wall
 *  up at the opening is accused). undefined when the offset is unknown. */
export function wallUpAtOpen(d: {
  startOffsetMs?: number;
  startOffsetSeconds?: number;
}): boolean | undefined {
  if (d.startOffsetMs !== undefined) return d.startOffsetMs <= 0;
  if (d.startOffsetSeconds !== undefined) return d.startOffsetSeconds <= 0;
  return undefined;
}

/** "already up when the burst opened" / "pressed 1.2s after the burst opened" */
export function wallTimingPhrase(
  d: { startOffsetMs?: number; startOffsetSeconds?: number } | undefined,
): string {
  if (!d) return "";
  const up = wallUpAtOpen(d);
  if (up === undefined) return "";
  if (up) return "already up when the burst opened";
  const s = d.startOffsetSeconds ?? (d.startOffsetMs ?? 0) / 1000;
  return s < 0.05
    ? "pressed <0.1s after the burst opened"
    : `pressed ${s.toFixed(1)}s after the burst opened`;
}

export interface IBurstTargetDamage {
  unitId: string;
  unitName: string;
  damage: number;
}

export interface IBurstLedgerEntry {
  fromSeconds: number;
  toSeconds: number;
  /** Offensive CDs opening this burst, cast order. */
  spells: Array<{
    spellId: string;
    spellName: string;
    castTimeSeconds: number;
    /** end of this CD's own active span (`burstCastSpan`) — the header's
     *  span is the union (triage sync-burst F-L4) */
    spanToSeconds: number;
  }>;
  /** Player damage to enemy players inside the span (pets excluded from targeting). */
  totalDamage: number;
  damageByTarget: IBurstTargetDamage[];
  /** Enemy player that received the most damage; null when the burst hit nothing. */
  dominantTarget: {
    unitId: string;
    unitName: string;
    /** The `[STATE]`-grid reading (`gridHpPct`) at the burst's rendered
     * start / end second — the numbers the same-second `[STATE]` ticks print
     * (triage hp-state F-B1; the raw-millisecond samples disagreed with the
     * tick on 115 of 142 ledger targets). `hpEndPct` is 0 when the target is
     * dead at the end second. */
    hpStartPct: number | null;
    hpEndPct: number | null;
    /** The grid low inside the rendered span and its second, when it is a
     * trough worth printing (`isHpTroughWorthPrinting`, the `[DMG SPIKE]`
     * rule); null otherwise, and whenever an endpoint is unknown or dead. */
    hpLow: { pct: number; atSeconds: number } | null;
    damage: number;
    defensivesHit: IBurstDefensiveHit[];
    /** Target died inside [from, to + KILL_CREDIT_SLACK_S]. */
    died: boolean;
  } | null;
  /** Enemy players OTHER than the dominant target that this burst damaged and
   * that died inside [from, to + KILL_CREDIT_SLACK_S] — the window `died`
   * uses (triage sync-burst F-L1: a burst whose first victim died early was
   * named after the survivor who took the rest, and printed no death). Keyed
   * on the burst's own damage, not a cast target. `dominantTarget.died` and
   * every conversion count are unchanged. */
  otherDeaths: Array<{ unitName: string; atSeconds: number }>;
  /** Ally offensive CDs whose active span overlaps this burst (alignment evidence). */
  allyCDsOverlapping: Array<{ playerName: string; spellName: string }>;
}

/**
 * Active span of one offensive CD cast: from the cast to the end of its
 * effect (`buffEndSeconds`, the official duration for the caster), nothing
 * more. One predicate for every reader of "is this cooldown running": the
 * burst ledger's grouping / span / ally overlap, the kill-attempt burst
 * clusters (`killAttempts.ts`), kick-eaten's `enemyBurst` / `ourBurst`
 * (`kickPressure.ts`), `unsyncedBurstEvents`' effect window, and the replay
 * burst pulse (desktop `replayHighlights.ts` — the pulse covers exactly the
 * span the ledger audits).
 *
 * Until 2026-10-01 the span was `max(buffEnd, cast + 10 s)` — a 10 s floor
 * borrowed from the clustering reach (`BURST_CLUSTER_SECONDS`). User ruling
 * A14 = B (2026-09-30, triage kick-eaten F-K1 × sync-burst F-L3): the floor
 * goes, globally. It named cooldowns whose effect had ended seconds earlier
 * as "running": c2058ed4 @18.2 `enemyBurst=Boomstick` (a 3 s effect cast at
 * 10.9), and 2abc9185's `Aligned with: … (Doom Winds)` credited from the
 * tail of a Strike of the Windlord that had ended 3 s before. An instant
 * cooldown is now a zero-length span: it is "running" for nobody and groups
 * only with casts in its own instant.
 *
 * The span ends at the OBSERVED aura chain when the log shows one (the
 * second half of A14, after the cast→effect table of CROSS-THEME G3, ruling
 * A10): `buffEndSeconds` is `enemyCDs.ts` → `observedEffectEndSeconds` when
 * it is known — an effect that ended early ends the span early, one that
 * re-application kept alive (02c8e3ac Dragonrage) lengthens it — else the
 * official duration.
 * `enemyCDs.ts`' aligned-window clustering keeps its own reach
 * (`BURST_CLUSTER_SECONDS`): "which casts form one go" is a different
 * question from "how long does one cast's effect run".
 */
export function burstCastSpan(
  cd: Pick<IEnemyCDCast, "castTimeSeconds" | "buffEndSeconds">,
): { from: number; to: number } {
  return {
    from: cd.castTimeSeconds,
    to: Math.max(cd.buffEndSeconds, cd.castTimeSeconds),
  };
}

/**
 * Groups one player's offensive CD casts into bursts and audits each one:
 * where the damage went, whether the dominant target had an immunity/major
 * defensive running, whether any ally CD overlapped, and whether the target died.
 *
 * CD detection shares the enemy-side predicate (reconstructEnemyCDTimeline);
 * casts group while their effect spans overlap (`burstCastSpan`).
 */
export function analyzeBurstLedger(
  player: ICombatUnit,
  allies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IBurstLedgerEntry[] {
  const matchStartMs = combat.startTime;
  const matchEndS = (combat.endTime - matchStartMs) / 1000;
  const attackingSide = new Set<string>([
    player.name,
    ...allies.map((a) => a.name),
  ]);

  const ownCDs =
    reconstructEnemyCDTimeline([player], combat).players[0]?.offensiveCDs ?? [];
  if (ownCDs.length === 0) return [];

  // Ally offensive CD spans, computed once (player excluded).
  const allyCDSpans = allies
    .filter((a) => a.id !== player.id)
    .flatMap((a) =>
      (
        reconstructEnemyCDTimeline([a], combat).players[0]?.offensiveCDs ?? []
      ).map((cd) => ({
        playerName: a.name,
        spellName: cd.spellName,
        ...burstCastSpan(cd),
      })),
    );

  const enemyPlayers = enemies.filter((e) => e.info);
  const enemyById = new Map(enemyPlayers.map((e) => [e.id, e]));

  // Group own casts by active-span overlap (`burstCastSpan`: the effect's own
  // length, no floor — ruling A14).
  const groups: IEnemyCDCast[][] = [];
  {
    let current: IEnemyCDCast[] = [];
    let reach = -Infinity;
    for (const cd of ownCDs) {
      if (current.length === 0 || cd.castTimeSeconds <= reach) {
        current.push(cd);
      } else {
        groups.push(current);
        current = [cd];
      }
      reach = Math.max(reach, burstCastSpan(cd).to);
    }
    if (current.length > 0) groups.push(current);
  }

  const entries: IBurstLedgerEntry[] = [];
  for (const group of groups) {
    const fromSeconds = group[0].castTimeSeconds;
    const toSeconds = Math.min(
      Math.max(...group.map((cd) => burstCastSpan(cd).to)),
      matchEndS,
    );
    const fromMs = matchStartMs + fromSeconds * 1000;
    const toMs = matchStartMs + toSeconds * 1000;

    // Player damage (pet damage is merged into damageOut upstream) to enemy players.
    const damageMap = new Map<string, number>();
    for (const d of player.damageOut) {
      if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs) continue;
      if (!enemyById.has(d.destUnitId)) continue;
      damageMap.set(
        d.destUnitId,
        (damageMap.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
      );
    }
    const damageByTarget: IBurstTargetDamage[] = [...damageMap.entries()]
      .map(([unitId, damage]) => ({
        unitId,
        unitName: enemyById.get(unitId)?.name ?? unitId,
        damage,
      }))
      .sort((a, b) => b.damage - a.damage);
    const totalDamage = damageByTarget.reduce((s, t) => s + t.damage, 0);

    let dominantTarget: IBurstLedgerEntry["dominantTarget"] = null;
    const top = damageByTarget[0];
    if (top) {
      const target = enemyById.get(top.unitId)!;

      // Defensive/immunity auras actually ACTIVE on the target during the span
      // (real aura intervals, not cast+duration estimates).
      const defensivesHit: IBurstDefensiveHit[] = [];
      for (const iv of buildFilteredAuraIntervals(
        target,
        DEF_OR_IMMUNE_IDS,
        combat,
      )) {
        // An aura OUR side put on the target is not the target's defensive —
        // the owner's own Touch of Karma tether (122470, applied by the monk
        // ON the enemy) read as "Target had a major defensive up" (reliability
        // round 2 W1h, d78f). An enemy teammate's external still counts.
        if (attackingSide.has(iv.srcUnitName)) continue;
        // A redirect external (Blessing of Sacrifice) also puts an aura on its
        // CASTER — that copy means the caster is taking extra damage, not
        // mitigating (reliability round 3 N4, 483f: the Ret who gave BoSac to
        // the hunter read as "a major defensive up ON THE TARGET").
        if (
          SELF_CAST_NOOP_EXTERNAL_IDS.has(iv.spellId) &&
          iv.srcUnitName === target.name
        )
          continue;
        const overlapMs =
          Math.min(iv.endMs, toMs) - Math.max(iv.startMs, fromMs);
        if (overlapMs / 1000 < MIN_DEFENSIVE_OVERLAP_S) continue;
        defensivesHit.push({
          spellId: iv.spellId,
          // Aura names in a Chinese-client log are localized text — prompt/facts
          // must be English (lesson from the CJK leak audit)
          spellName: getEnglishSpellName(iv.spellId, iv.spellName),
          overlapSeconds: Math.round(overlapMs / 100) / 10,
          // User ruling F-BI-full (2026-10-02, same rule as F-K9b-B): only a
          // FULL immunity (Ice Block, Divine Shield, Aspect of the Turtle) is
          // "IMMUNE". Cloak of Shadows / Blessing of Protection / Spellwarding
          // stop one kind of damage — a burst through Cloak still lands its
          // physical part — so they show as the target's defensive.
          isImmunity: FULL_IMMUNITY_IDS.has(iv.spellId),
          appliedByOther: iv.srcUnitName !== target.name,
          casterName: iv.srcUnitName,
          startOffsetSeconds: Math.round((iv.startMs - fromMs) / 100) / 10,
          startOffsetMs: iv.startMs - fromMs,
        });
      }
      defensivesHit.sort((a, b) => b.overlapSeconds - a.overlapSeconds);

      const died = target.deathRecords.some(
        (dr) =>
          dr.timestamp >= fromMs &&
          dr.timestamp <= toMs + KILL_CREDIT_SLACK_S * 1000,
      );

      // Endpoints on the render grid: the line prints `fmtTime(from)–
      // fmtTime(to)` (floored), so its HP pair is the `[STATE]` reading of
      // those two seconds.
      const fromSec = toRenderSecond(fromSeconds);
      const toSec = toRenderSecond(toSeconds);
      const deadAtEnd = isDeadAtRenderSecond(target, matchStartMs, toSec);
      // a death inside the burst's first rendered second: that second's
      // [STATE] tick already reads `dead`, so the start reads 0 like the end
      const deadAtStart = isDeadAtRenderSecond(target, matchStartMs, fromSec);
      const hpStartPct = deadAtStart
        ? 0
        : gridHpPct(target, matchStartMs + fromSec * 1000);
      const hpEndPct = deadAtEnd
        ? 0
        : gridHpPct(target, matchStartMs + toSec * 1000);
      const low =
        hpStartPct !== null && hpEndPct !== null && !deadAtEnd
          ? gridHpMinInWindow(target, matchStartMs, fromSec, toSec)
          : null;

      dominantTarget = {
        unitId: top.unitId,
        unitName: top.unitName,
        hpStartPct,
        hpEndPct,
        hpLow:
          low !== null &&
          isHpTroughWorthPrinting(hpStartPct!, hpEndPct!, low.pct)
            ? { pct: low.pct, atSeconds: low.atSec }
            : null,
        damage: top.damage,
        defensivesHit,
        died,
      };
    }

    const otherDeaths: IBurstLedgerEntry["otherDeaths"] = [];
    for (const t of damageByTarget) {
      if (t.unitId === top?.unitId) continue;
      // "also hit" means hit: a fully absorbed tick (effective damage 0) on
      // a unit the rest of the team then killed is not this burst's victim
      if (t.damage <= 0) continue;
      const death = enemyById
        .get(t.unitId)
        ?.deathRecords.map((dr) => dr.timestamp)
        .filter((ms) => ms >= fromMs && ms <= toMs + KILL_CREDIT_SLACK_S * 1000)
        .sort((a, b) => a - b)[0];
      if (death !== undefined)
        otherDeaths.push({
          unitName: t.unitName,
          atSeconds: (death - matchStartMs) / 1000,
        });
    }
    otherDeaths.sort((a, b) => a.atSeconds - b.atSeconds);

    const allyCDsOverlapping = allyCDSpans
      .filter((s) => s.from <= toSeconds && s.to >= fromSeconds)
      .map((s) => ({ playerName: s.playerName, spellName: s.spellName }));

    entries.push({
      fromSeconds,
      toSeconds,
      spells: group.map((cd) => ({
        spellId: cd.spellId,
        spellName: cd.spellName,
        castTimeSeconds: cd.castTimeSeconds,
        // clipped like the header's own end (the round can end mid-burst)
        spanToSeconds: Math.min(burstCastSpan(cd).to, toSeconds),
      })),
      totalDamage,
      damageByTarget,
      dominantTarget,
      otherDeaths,
      allyCDsOverlapping,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Kill-window targeting audit (per player)
// ---------------------------------------------------------------------------

export interface IWindowTargetingAudit {
  windowFromSeconds: number;
  windowToSeconds: number;
  windowTargetId: string;
  windowTargetName: string;
  /** Player damage to all enemy players inside the window. */
  playerDamageTotal: number;
  playerDamageToTarget: number;
  /** 0–100, rounded. */
  onTargetPct: number;
  /** Biggest non-window-target recipient of the player's damage, if any. */
  topOffTarget: IBurstTargetDamage | null;
  /** The player's damage went where the TEAM's went (the enemy receiving the
   * most friendly damage in the window), not to the window's defenseless
   * target — following the focus is not an individual off-target problem
   * (reliability round 3 24b6 / 6954: 85–87 % of team damage on Saérox while
   * the ledger named the enemy healer as "the target"). */
  followedTeamFocus?: boolean;
}

/**
 * For each offensive window (computeOffensiveWindows output), splits this player's
 * damage by enemy target and reports how much landed on the window's target.
 * Windows where the player dealt no damage are skipped — usually CC/death, which
 * the CC and death analyses already own.
 */
export function auditWindowTargeting(
  player: ICombatUnit,
  windows: IOffensiveWindow[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IWindowTargetingAudit[] {
  const matchStartMs = combat.startTime;
  const enemyById = new Map(
    enemies.filter((e) => e.info).map((e) => [e.id, e]),
  );
  const audits: IWindowTargetingAudit[] = [];

  for (const w of windows) {
    if (w.durationSeconds < MIN_WINDOW_SECONDS) continue;
    const fromMs = matchStartMs + w.fromSeconds * 1000;
    // Damage share after the window's target dies is meaningless — truncate the
    // evaluation at the target's death (2026-07-16 DPS baseline: ≥8 matches
    // where the responder/judge called out this artifact by name).
    const target = enemyById.get(w.targetUnitId);
    // Take the **earliest** death after the window start. Using .find() to take
    // "the first in array order" would assume deathRecords is sorted ascending
    // by time — an upstream implementation detail, not a contract; out of order
    // it would truncate at a later death, stretching the window and diluting the
    // on-target share. min does not depend on ordering.
    const deathsAfter = (target?.deathRecords ?? [])
      .map((d) => d.timestamp)
      .filter((t) => t > fromMs);
    const targetDeathMs =
      deathsAfter.length > 0 ? Math.min(...deathsAfter) : undefined;
    const toMs = Math.min(
      matchStartMs + w.toSeconds * 1000,
      targetDeathMs ?? Infinity,
    );
    if ((toMs - fromMs) / 1000 < MIN_WINDOW_SECONDS) continue;

    const damageMap = new Map<string, number>();
    for (const d of player.damageOut) {
      if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs) continue;
      if (!enemyById.has(d.destUnitId)) continue;
      damageMap.set(
        d.destUnitId,
        (damageMap.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
      );
    }
    const total = [...damageMap.values()].reduce((s, v) => s + v, 0);
    if (total <= 0) continue;

    const onTarget = damageMap.get(w.targetUnitId) ?? 0;
    let topOffTarget: IBurstTargetDamage | null = null;
    for (const [unitId, damage] of damageMap) {
      if (unitId === w.targetUnitId) continue;
      if (!topOffTarget || damage > topOffTarget.damage) {
        topOffTarget = {
          unitId,
          unitName: enemyById.get(unitId)?.name ?? unitId,
          damage,
        };
      }
    }

    // team focus: the enemy that took the most damage from the player's side
    const teamDamage = new Map<string, number>();
    for (const u of Object.values(combat.units ?? {}) as ICombatUnit[]) {
      if (!u.info || u.reaction !== player.reaction) continue;
      for (const d of u.damageOut ?? []) {
        if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs)
          continue;
        if (!enemyById.has(d.destUnitId)) continue;
        teamDamage.set(
          d.destUnitId,
          (teamDamage.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
        );
      }
    }
    let teamFocusId: string | undefined;
    for (const [id, dmg] of teamDamage)
      if (teamFocusId === undefined || dmg > (teamDamage.get(teamFocusId) ?? 0))
        teamFocusId = id;
    const followedTeamFocus =
      teamFocusId !== undefined &&
      teamFocusId !== w.targetUnitId &&
      topOffTarget?.unitId === teamFocusId;

    audits.push({
      windowFromSeconds: w.fromSeconds,
      windowToSeconds: (toMs - matchStartMs) / 1000,
      windowTargetId: w.targetUnitId,
      windowTargetName: w.targetName,
      playerDamageTotal: total,
      playerDamageToTarget: onTarget,
      onTargetPct: Math.round((100 * onTarget) / total),
      topOffTarget,
      followedTeamFocus,
    });
  }

  return audits;
}

/** On-target share below this = off-target discipline problem.
 * Shared by the report card chip, the prompt block, and the off-target finding.
 *
 * GH #34 batch 4 (2026-08-28), same corpus, 6,239 kill windows audited for
 * DPS friendlies: onTargetPct < 20 2,053 · [20,40) 1,654 · [40,50) 736 ·
 * [50,60) 556 · [60,80) 841 · [80,100) 376 · 100 23 (p50 32 %). Share
 * flagged "off-target": < 40 59.4 % · **< 50 71.2 %** · < 60 80.1 %. At 50 the
 * criterion fires on nearly three windows in four — it describes the norm,
 * not a discipline problem; whether that is intended (or the kill-window
 * target itself is the wrong reference, GH #31) is a value-gate question
 * recorded on the issue. Value unchanged. Measured, not official. */
export const ON_TARGET_GOOD_PCT = 50;

// ---------------------------------------------------------------------------
// Prompt formatter (DPS owner — timeline path <burst_ledger> block)
// ---------------------------------------------------------------------------

const fmtM = (n: number): string => `${(n / 1_000_000).toFixed(2)}M`;

/** The header's CD list: with two or more CDs each carries its own span
 *  (triage sync-burst F-L4: `Dark Transformation + Army of the Dead` under
 *  one 0:11–0:41 span, while DT's own span ended at 0:26). */
function formatBurstSpells(spells: IBurstLedgerEntry["spells"]): string {
  if (spells.length < 2) return spells.map((s) => s.spellName).join(" + ");
  return spells
    .map(
      (s) =>
        `${s.spellName} ${fmtTime(s.castTimeSeconds)}–${fmtTime(s.spanToSeconds)}`,
    )
    .join(" + ");
}

/**
 * Renders the burst ledger as plain text for the AI context (DPS owners).
 * Times via fmtTime (floored render grid), percentages as ints — any future
 * gate re-parsing these lines re-derives the same values.
 */
export function formatBurstLedgerForContext(
  bursts: IBurstLedgerEntry[],
  targeting: IWindowTargetingAudit[],
  kicks: IKickAuditEntry[],
): string[] {
  if (bursts.length + targeting.length + kicks.length === 0) return [];
  const lines: string[] = ["## BURST LEDGER (your offensive audit)"];

  bursts.forEach((b, i) => {
    lines.push(
      `  Burst #${i + 1} — ${fmtTime(b.fromSeconds)}–${fmtTime(b.toSeconds)} | ${formatBurstSpells(b.spells)}`,
    );
    const t = b.dominantTarget;
    if (t) {
      const lowStr = t.hpLow
        ? ` (low ${t.hpLow.pct}% at ${fmtTime(t.hpLow.atSeconds)})`
        : "";
      const hpStr =
        t.hpStartPct !== null && t.hpEndPct !== null
          ? ` ${Math.round(t.hpStartPct)}% → ${Math.round(t.hpEndPct)}%${lowStr}`
          : "";
      // F-L1: the burst's other victim(s) — a fact about who else it hit
      // and killed; the target above is unchanged
      const alsoStr =
        b.otherDeaths.length > 0
          ? ` | also hit: ${b.otherDeaths
              .map(
                (d) =>
                  // `+N.Ns` is from the burst's raw start, like the
                  // dominant target's own DIED offset and `defensivesHit`:
                  // an interval, not a grid reading (the header and DIED
                  // stamps are floored, so 27.95 → 28.05 reads 0:28 (+0.1s))
                  `${d.unitName} DIED ${fmtTime(d.atSeconds)} (+${(d.atSeconds - b.fromSeconds).toFixed(1)}s)`,
              )
              .join("; ")}`
          : "";
      lines.push(
        `    Target: ${t.unitName}${hpStr} | your damage ${fmtM(t.damage)}${t.died ? " | target DIED" : ""}${alsoStr}`,
      );
      for (const d of t.defensivesHit) {
        // 2026-07-16 smoke test: without spelling out "on the target", the
        // responder misreads this as one of our own externals (Pain Suppression
        // can only be cast on a teammate → it reasons "so it is not target
        // mitigation"). The subject must be explicit.
        lines.push(
          `    ${d.isImmunity ? "⚠ Target was IMMUNE" : "Target had a major defensive up"}: ${d.spellName} active ON THE TARGET ${d.overlapSeconds.toFixed(1)}s of this burst${wallUpAtOpen(d) !== undefined ? ` (${wallTimingPhrase(d)})` : ""}`,
        );
      }
    } else if (b.toSeconds > b.fromSeconds) {
      lines.push(`    No damage dealt to enemy players during this burst.`);
    }
    // A zero-length burst (an offensive cooldown with no tracked buff — Soul
    // Fire, whose hit lands after the cast) has no window damage could fall
    // into: saying "No damage dealt" there contradicted the KILL ATTEMPTS
    // row of the same cast (pre-review of the burst-span batch: 50 owner
    // files on 605). Until the observed-chain half (CROSS-THEME G3) gives
    // such a cast its effect, the line says nothing about its damage.
    lines.push(
      b.allyCDsOverlapping.length > 0
        ? `    Aligned with: ${b.allyCDsOverlapping.map((a) => `${a.playerName} (${a.spellName})`).join(", ")}`
        : `    Solo burst — no ally offensive CD overlapped.`,
    );
  });

  const offTarget = targeting.filter(
    (w) => w.onTargetPct < ON_TARGET_GOOD_PCT && !w.followedTeamFocus,
  );
  for (const w of offTarget) {
    lines.push(
      `  Off-target: window ${fmtTime(w.windowFromSeconds)}–${fmtTime(w.windowToSeconds)} target ${w.windowTargetName} — only ${w.onTargetPct}% of your damage on target` +
        (w.topOffTarget
          ? ` (largest off-target: ${w.topOffTarget.unitName} ${fmtM(w.topOffTarget.damage)})`
          : ""),
    );
  }

  if (kicks.length > 0) {
    const parts = kicks.map((k) => {
      const at = fmtTime(k.atSeconds);
      switch (k.result) {
        case "landed":
          return `${at} ${k.kickSpellName} → interrupted ${k.interruptedSpellName}`;
        case "silenced":
          // "no cast interrupted" only when the target had no open cast:
          // a silence stops a bar without a SPELL_INTERRUPT row
          return `${at} ${k.kickSpellName} → silenced ${k.silencedTargetName} (${
            k.openCastSpellName
              ? `their ${k.openCastSpellName} cast did not finish`
              : "no cast interrupted"
          })`;
        case "juked":
          return k.jukedChannelStoppedAgoS !== undefined
            ? `${at} ${k.kickSpellName} → ${jukedByStoppedChannelText(k)}`
            : `${at} ${k.kickSpellName} → JUKED by fake ${k.jukedBySpellName}`;
        case "missed":
          return `${at} ${k.kickSpellName} → hit nothing`;
        default:
          return `${at} ${k.kickSpellName} → outcome unknown (no cast-start data)`;
      }
    });
    lines.push(`  Kicks: ${parts.join(" | ")}`);
  }

  return lines;
}
