import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  isKillWindowMajorDefensive,
  KW_MAJOR_DEF_MIN_CD_S,
  kwCooldownSeconds,
} from "../data/abilityProfile";
import { SELF_WALL_AURA_TO_CAST_ID } from "../data/mitigationData";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { spellEffectData } from "../data/spellEffectData";
import { SpellTag } from "../data/spellTypes";
import { supersededAuraBreaks } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import {
  chargeAvailabilityTransitions,
  extractMajorCooldowns,
  specToString,
  unitCooldownOf,
} from "./cooldowns";
import { enemyDefensiveEvents, renderedExternalSpanS } from "./enemyDefensives";
import { fmtTime, renderedWindowSeconds } from "./renderGrid";
// GH #31 ② (2026-09-02): the hand list is replaced by the shared official-face
// predicate; the curated remainder lives as its registered fallback floor.
import { summonOwnerById } from "./summonOwner";
import { firstDeathMs } from "./unitDeath";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** Minimum vulnerability window duration to surface (seconds) */
const MIN_VULN_SECONDS = 5;
/** Fallback buff duration when spellEffectData has no durationSeconds.
 *  GH #34 batch 4 (2026-08-28): of the 39 externalOrBigDefensiveSpellIds this
 *  file tracks, exactly ONE lacks an official duration — Rallying Cry 97462,
 *  whose cast spell has DurationIndex 0 in DB2 (the buff lives on 97463). So
 *  this fallback fires for Rallying Cry only, and 8s under-states it: the 97463
 *  aura's official duration is 10s (SpellDuration 1 → 10000ms). Wiring that is a
 *  data-override decision recorded on the issue, not made here. Any other
 *  id reaching this branch means the generated table regressed. */
const DEFAULT_BUFF_DURATION_S = 8;
// CAPITALIZE_RATIO (1.2× match-average rate) removed 2026-08-19: measured on
// n=300 (GH #16), only 4 of 3486 windows ever cleared it — the denominator
// (whole-match average team rate × a 36s-median window) was unreachable by
// construction, so the prompt printed NOT CAPITALISED on 99.9% of windows.
// The team-level "did we convert" judgment now lives in the [KILL ATTEMPTS]
// block (per-attempt team-focus share + outcome); this block renders facts
// only.

// ── Burst sub-windows (2026-07-17 kill-window redesign) ──────────────────────
// Vulnerability spans are a long-lived STATE (corpus median 36s, p99 156s —
// enemy defensives have 2–3min CDs vs ~8s buffs), not a kill opportunity.
// [KILL WINDOW] rendering anchors on actual team damage bursts inside the
// span; spans with no qualifying burst render as [VULNERABLE] (never punished).
// Shared-predicate rule: these constants are the spec for any gate that
// re-derives bursts from the log.
/** A gap of more than this between team damage events on the target splits bursts. */
export const KW_BURST_GAP_S = 5;
/** Minimum clustered damage for a burst to qualify as a kill attempt. */
export const KW_BURST_MIN_DAMAGE = 30_000;
/** Max bursts rendered per vulnerability span (top by damage, chronological). */
export const KW_MAX_BURSTS = 2;
/**
 * Soft max burst length: sustained dot pressure bridges every 5s gap, so
 * clusters longer than this split recursively at their largest internal lull
 * (first full-corpus pass left p90=50s/max=193s "bursts").
 */
export const KW_BURST_SOFT_MAX_S = 20;

export interface IBurstSubWindow {
  fromSeconds: number;
  toSeconds: number;
  /** Total friendly damage to the target inside this burst. */
  damage: number;
}

/**
 * Clusters friendly damage events on the window's target into bursts
 * (gap > KW_BURST_GAP_S splits; clusters over KW_BURST_SOFT_MAX_S re-split at
 * their largest lull; clusters under KW_BURST_MIN_DAMAGE dropped; top
 * KW_MAX_BURSTS by damage, returned chronologically).
 */
export function computeBurstSubWindows(
  damageEvents: Array<{ t: number; amount: number }>,
  spanFrom: number,
  spanTo: number,
): IBurstSubWindow[] {
  if (damageEvents.length === 0) return [];
  const sorted = [...damageEvents].sort((a, b) => a.t - b.t);

  // Gap-based clustering, keeping the event lists for recursive splitting.
  type Ev = { t: number; amount: number };
  const rawClusters: Ev[][] = [];
  let cur: Ev[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.t - cur[cur.length - 1].t > KW_BURST_GAP_S) {
      rawClusters.push(cur);
      cur = [e];
    } else {
      cur.push(e);
    }
  }
  rawClusters.push(cur);

  // Sustained dot pressure bridges every gap; chop over-long clusters at their
  // largest internal lull so each burst stays a single readable attempt.
  const splitLong = (events: Ev[]): Ev[][] => {
    const dur = events[events.length - 1].t - events[0].t;
    if (dur <= KW_BURST_SOFT_MAX_S || events.length < 2) return [events];
    let splitAt = 1;
    let maxGap = -1;
    for (let i = 1; i < events.length; i++) {
      const gap = events[i].t - events[i - 1].t;
      if (gap > maxGap) {
        maxGap = gap;
        splitAt = i;
      }
    }
    return [
      ...splitLong(events.slice(0, splitAt)),
      ...splitLong(events.slice(splitAt)),
    ];
  };

  const clusters: IBurstSubWindow[] = rawClusters
    .flatMap(splitLong)
    .map((evs) => ({
      fromSeconds: evs[0].t,
      toSeconds: evs[evs.length - 1].t,
      damage: evs.reduce((s, e) => s + e.amount, 0),
    }));

  return (
    clusters
      .filter((c) => c.damage >= KW_BURST_MIN_DAMAGE)
      .sort((a, b) => b.damage - a.damage)
      .slice(0, KW_MAX_BURSTS)
      .sort((a, b) => a.fromSeconds - b.fromSeconds)
      // Widen to at least ~2s (single-hit clusters would render zero-width),
      // clamped to the vulnerability span.
      .map((c) => ({
        ...c,
        fromSeconds: Math.max(spanFrom, c.fromSeconds - 0.5),
        toSeconds: Math.min(
          spanTo,
          Math.max(c.toSeconds + 0.5, c.fromSeconds + 1.5),
        ),
      }))
  );
}

// ── Event-driven state machine types ─────────────────────────────────────────

type EventKind = "CD_READY" | "CD_USED" | "BUFF_EXPIRED";

interface IStateEvent {
  time: number;
  kind: EventKind;
  spellId: string;
  spellName: string;
  /** CD_USED only: this press spent the spell's LAST charge in hand (−1 to
   * the available count); a press with a charge left keeps it available. */
  spendsLast?: boolean;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface IFriendlyOffensiveState {
  playerName: string;
  playerSpec: string;
  spellName: string;
  /** true when the CD was available but no cast occurred inside the vulnerability window */
  wasIdled: boolean;
  /** seconds the player was under any CC during this vulnerability window */
  ccDurationInWindow: number;
}

export interface IOffensiveWindow {
  targetUnitId: string;
  targetName: string;
  targetSpec: string;
  fromSeconds: number;
  toSeconds: number;
  durationSeconds: number;
  /** Total friendly damage dealt to this enemy during the window */
  friendlyDamageInWindow: number;
  /** friendlyDamageInWindow / expected damage for same duration at match average rate */
  // damageRatio / capitalized removed 2026-08-19 — see the note where
  // CAPITALIZE_RATIO used to live.
  /** Per-player offensive CD state during this window */
  friendlyOffensives: IFriendlyOffensiveState[];
  /**
   * Team damage bursts inside the span (kill attempts). Empty = the enemy sat
   * defenseless and was never meaningfully punished.
   */
  bursts: IBurstSubWindow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns how many seconds a unit was under any CC aura during [windowFrom, windowTo].
 * Uses the same aura-tracking pattern as enemyCDs.ts (SPELL_AURA_APPLIED / REMOVED pairs).
 */
function ccSecondsInWindow(
  unit: ICombatUnit,
  matchStartMs: number,
  windowFrom: number,
  windowTo: number,
): number {
  const windowStartMs = matchStartMs + windowFrom * 1000;
  const windowEndMs = matchStartMs + windowTo * 1000;

  // Track per-spellId CC start times. Overlaps are collected per CC and merged
  // before summing (same rule as enemyCDs.ts's healer-CC block): two different
  // CCs running at once are one CC'd stretch, not two.
  const ccStartBySpell = new Map<string, number>();
  const spans: { start: number; end: number }[] = [];

  // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08)
  const notTheEnd = supersededAuraBreaks(unit.auraEvents);
  for (const a of unit.auraEvents) {
    if (!a.spellId || notTheEnd.has(a)) continue;
    const entry = SPELLS[a.spellId];
    if (entry?.type !== "cc") continue;

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
      ccStartBySpell.delete(a.spellId);

      // Clamp to window
      if (ccStart > 0 && ccStart < windowEndMs && ccEnd > windowStartMs) {
        spans.push({
          start: Math.max(ccStart, windowStartMs),
          end: Math.min(ccEnd, windowEndMs),
        });
      }
    }
  }

  // Any CC aura still open at the end of the window
  for (const [, ccStart] of ccStartBySpell) {
    if (ccStart < windowEndMs) {
      spans.push({ start: Math.max(ccStart, windowStartMs), end: windowEndMs });
    }
  }

  spans.sort((a, b) => a.start - b.start);
  let totalMs = 0;
  let cur: { start: number; end: number } | null = null;
  for (const sp of spans) {
    if (cur && sp.start <= cur.end) {
      cur.end = Math.max(cur.end, sp.end);
    } else {
      if (cur) totalMs += Math.max(0, cur.end - cur.start);
      cur = { ...sp };
    }
  }
  if (cur) totalMs += Math.max(0, cur.end - cur.start);
  return totalMs / 1000;
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Finds windows where an enemy had NO major defensive buff active and NO major
 * defensive CD available — i.e. their defensives were both spent and expired.
 *
 * Uses an event-driven state machine with three event kinds:
 *   CD_READY   — CD becomes available (start of match, or after cooldown elapses)
 *   CD_USED    — cast detected; buff begins, CD goes on cooldown
 *   BUFF_EXPIRED — buff duration ends; enemy is now defenseless
 *
 * Vulnerability = Available == 0 AND Active == 0.
 */
/** Consume one emptying flip recorded at `t` (see computeOffensiveWindows). */
function takeFlip(flips: Map<number, number>, t: number): boolean {
  const n = flips.get(t) ?? 0;
  if (n <= 0) return false;
  flips.set(t, n - 1);
  return true;
}

/** `spans` minus every interval of `cuts` (both in seconds; `cuts` may
 * overlap each other). Pieces keep their order. */
export function subtractIntervals(
  spans: ReadonlyArray<{ from: number; to: number }>,
  cuts: ReadonlyArray<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  let out = spans.map((s) => ({ ...s }));
  for (const c of cuts) {
    // an empty cut removes nothing — it must not split a span in two
    if (!(c.to > c.from)) continue;
    const next: Array<{ from: number; to: number }> = [];
    for (const s of out) {
      if (c.to <= s.from || c.from >= s.to) {
        next.push(s);
        continue;
      }
      if (c.from > s.from) next.push({ from: s.from, to: c.from });
      if (c.to < s.to) next.push({ from: c.to, to: s.to });
    }
    out = next;
  }
  return out;
}

/** Inverse of `SELF_WALL_AURA_TO_CAST_ID`: a cast-keyed wall → its logged aura. */
const WALL_CAST_TO_AURA_ID: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(SELF_WALL_AURA_TO_CAST_ID).map(([aura, cast]) => [
      cast,
      aura,
    ]),
  );

export function computeOffensiveWindows(
  enemies: ICombatUnit[],
  friendlies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IOffensiveWindow[] {
  const matchStartMs = combat.startTime;
  const matchDurationSeconds = (combat.endTime - matchStartMs) / 1000;
  const windows: IOffensiveWindow[] = [];

  // (whole-match average damage rate deleted with damageRatio/capitalized —
  // see the CAPITALIZE_RATIO removal note above.)

  // Pre-compute friendly offensive CDs once (used for all enemy vulnerability windows)
  const friendlyOffensiveCDs = friendlies.map((f) => ({
    unit: f,
    cds: extractMajorCooldowns(f, combat).filter(
      (c) => c.tag === SpellTag.Offensive,
    ),
  }));

  // F-C10 (triage res-readiness, user ruling A47 2026-09-30): the team's
  // damage in a window counts owned pets / guardians, attributed by the
  // source GUID (GH #99, `summonOwnerById` — the one owner predicate).
  const allUnits = Object.values(combat.units ?? {}) as ICombatUnit[];
  const friendlySources = new Set<string>([
    ...friendlies.map((f) => f.id),
    ...allUnits
      .filter((u) => summonOwnerById(allUnits, u.id, friendlies) !== undefined)
      .map((u) => u.id),
  ]);

  // Externals each enemy RECEIVED, as [from, to] seconds from the round's
  // start (step 2b): the pair the `[ENEMY DEF]` line prints for that press —
  // its rendered second and its printed length (`renderedExternalSpanS`), so
  // a `defenseless …–m:ss` end and the next span's start are what a reader
  // gets from the line itself.
  const externalsReceived = new Map<
    string,
    Array<{ from: number; to: number }>
  >();
  for (const caster of enemies) {
    for (const d of enemyDefensiveEvents(caster, enemies, combat)) {
      if (d.kind !== "external" || !d.recipientId) continue;
      const span = renderedExternalSpanS(d);
      if (!span) continue;
      const list = externalsReceived.get(d.recipientId) ?? [];
      list.push(span);
      externalsReceived.set(d.recipientId, list);
    }
  }

  for (const enemy of enemies) {
    // ── 1. Build event list for this enemy's major defensives ─────────────────

    const events: IStateEvent[] = [];

    // Scan spellCastEvents directly — do not use extractMajorCooldowns on enemies
    const castsBySpell = new Map<string, number[]>();
    for (const cast of enemy.spellCastEvents) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const { spellId } = cast;
      if (!spellId || !isKillWindowMajorDefensive(spellId)) continue;
      if (!spellEffectData[spellId]) continue;
      // Admission on the official number the predicate itself reads
      // (kwCooldownSeconds) — it already enforced >= KW_MAJOR_DEF_MIN_CD_S.
      if (kwCooldownSeconds(spellId) < KW_MAJOR_DEF_MIN_CD_S) continue;
      const list = castsBySpell.get(spellId) ?? [];
      list.push((cast.logLine.timestamp - matchStartMs) / 1000);
      castsBySpell.set(spellId, list);
    }

    for (const [spellId, casts] of castsBySpell) {
      const effectData = spellEffectData[spellId]!;
      casts.sort((a, b) => a - b);
      // The enemy's own cooldown and charge cap (`unitCooldownOf`: talents,
      // PvP talents, spec passives) and buff length (`buffFullDurationForCaster`)
      // — talent impact audit 2026-09-26: base numbers opened a window while a
      // second Pain Suppression / Obsidian Scales charge or a talent-shortened
      // Blessing of Sacrifice was back in hand.
      const own = unitCooldownOf(enemy, spellId);
      const cooldownSeconds =
        own?.cooldownSeconds ?? kwCooldownSeconds(spellId);
      const cap = Math.max(1, own?.charges ?? 1);
      // Charge-state transitions — the shared sequential-recharge timeline
      // (`chargeAvailabilityTransitions`, chargesAvailableAt's rules).
      const flips = chargeAvailabilityTransitions(
        casts,
        cooldownSeconds,
        cap,
        matchDurationSeconds,
      );
      for (const f of flips)
        if (f.available && f.atSeconds < matchDurationSeconds)
          events.push({
            time: f.atSeconds,
            kind: "CD_READY",
            spellId,
            spellName: effectData.name,
          });
      // one flip per emptying press, even when two presses share a timestamp
      const emptiedAt = new Map<number, number>();
      for (const f of flips)
        if (!f.available)
          emptiedAt.set(f.atSeconds, (emptiedAt.get(f.atSeconds) ?? 0) + 1);
      for (const castTimeSeconds of casts) {
        // A wall whose DB2 duration sits on its logged aura, not on the cast
        // (Greater Invisibility 110959 → 110960, 20 s), is timed by that aura
        // — the length the [ENEMY DEF] line prints for the same press.
        const castBuff = buffFullDurationForCaster(
          WALL_CAST_TO_AURA_ID[spellId] ?? spellId,
          enemy,
          matchStartMs + castTimeSeconds * 1000,
        );
        const buffDuration =
          castBuff && castBuff > 0 ? castBuff : DEFAULT_BUFF_DURATION_S;
        events.push({
          time: castTimeSeconds,
          kind: "CD_USED",
          spellId,
          spellName: effectData.name,
          spendsLast: takeFlip(emptiedAt, castTimeSeconds),
        });
        events.push({
          time: castTimeSeconds + buffDuration,
          kind: "BUFF_EXPIRED",
          spellId,
          spellName: effectData.name,
        });
      }
    }

    // Count distinct tracked defensive spells this enemy actually used
    const trackedSpellIds = new Set(events.map((e) => e.spellId));
    const numTracked = trackedSpellIds.size;

    if (numTracked === 0) {
      // No major defensives detected — no meaningful vulnerability windows to surface
      continue;
    }

    // Each tracked spell starts match in CD_READY state (available at t=0)
    const initialAvailable = numTracked; // all start ready
    events.push({
      time: 0,
      kind: "CD_READY",
      spellId: "__init__",
      spellName: "",
    }); // sentinel handled below
    events.sort(
      (a, b) => a.time - b.time || (a.kind === "BUFF_EXPIRED" ? -1 : 1),
    );

    // ── 2. Walk events; find windows where available==0 AND active==0 ─────────

    let available = initialAvailable; // CDs ready to be pressed
    let active = 0; // Buffs currently mitigating
    let vulnStart: number | null = null;
    const vulnWindows: Array<{ from: number; to: number }> = [];

    const isVulnerable = () => available === 0 && active === 0;

    const closeWindow = (endTime: number) => {
      if (vulnStart !== null && endTime - vulnStart >= MIN_VULN_SECONDS) {
        vulnWindows.push({ from: vulnStart, to: endTime });
      }
      vulnStart = null;
    };

    for (const ev of events) {
      if (ev.kind === "CD_READY" && ev.spellId === "__init__") continue; // skip sentinel

      const wasVuln = isVulnerable();

      switch (ev.kind) {
        case "CD_USED":
          if (ev.spendsLast) available = Math.max(0, available - 1);
          active++;
          break;
        case "BUFF_EXPIRED":
          active = Math.max(0, active - 1);
          break;
        case "CD_READY":
          available++;
          break;
      }

      const nowVuln = isVulnerable();

      if (!wasVuln && nowVuln) {
        vulnStart = ev.time;
      } else if (wasVuln && !nowVuln) {
        closeWindow(ev.time);
      }
    }

    // Close any open window at match end
    if (isVulnerable() && vulnStart !== null) {
      closeWindow(matchDurationSeconds);
    }

    if (vulnWindows.length === 0) continue;

    // ── 2b. An external RECEIVED is not "defenseless" either ──────────────────
    // Enemy-def F-E2: the state machine above reads only the target's own
    // presses, so a Guardian Spirit / Pain Suppression / Blessing of
    // Protection a teammate put on the target left the span open (69546267:
    // `defenseless 1:47–2:51` across a 12 s Guardian Spirit). The intervals
    // are the `[ENEMY DEF]` external events' own (`enemyDefensiveEvents`), so
    // the span and the timeline line agree on when the external was up.
    const received = externalsReceived.get(enemy.id) ?? [];
    // ── 2c. A dead target is not "defenseless" — it is dead ───────────────────
    // T12 ① a (user ruling 2026-10-10, D1): the state machine reads only the
    // target's presses, so a wall whose nominal end fell after the target's
    // death opened a span on a corpse (1bad0a5c: `[VULNERABLE] 1:38–1:50` on a
    // shaman dead at 1:35.8), and kick-priority read "the kill target at 0 %"
    // off it 2.3 s after the death (65-1 t=79.4). The span ends at the death
    // (`firstDeathMs`, the one death instant); a span that starts at or after
    // it does not exist. Cut at the source so every reader moves together.
    const deathS = (firstDeathMs(enemy) - matchStartMs) / 1000;
    const cutWindows = subtractIntervals(vulnWindows, received)
      .filter((w) => w.from < deathS)
      .map((w) => ({ from: w.from, to: Math.min(w.to, deathS) }))
      .filter((w) => w.to - w.from >= MIN_VULN_SECONDS);

    // ── 3. Per-window metrics ──────────────────────────────────────────────────

    for (const vw of cutWindows) {
      const windowDuration = vw.to - vw.from;

      // Friendly damage dealt to this specific enemy during the window
      const windowDmgEvents: Array<{ t: number; amount: number }> = [];
      for (const d of enemy.damageIn) {
        if (!friendlySources.has(d.srcUnitId)) continue;
        const t = (d.logLine.timestamp - matchStartMs) / 1000;
        if (t < vw.from || t > vw.to) continue;
        windowDmgEvents.push({ t, amount: Math.abs(d.effectiveAmount) });
      }
      const windowDmg = windowDmgEvents.reduce((sum, e) => sum + e.amount, 0);

      // ── 4. Friendly offensive CD state w/ CC context ─────────────────────────

      const friendlyOffensives: IFriendlyOffensiveState[] = [];

      for (const { unit: f, cds } of friendlyOffensiveCDs) {
        for (const cd of cds) {
          // Was this CD available at any point during the vulnerability window?
          const availableOverlap = cd.availableWindows.find(
            (aw) =>
              Math.min(aw.toSeconds, vw.to) -
                Math.max(aw.fromSeconds, vw.from) >
              0,
          );
          if (!availableOverlap) continue;

          // Was it cast during the window?
          const wasCast = cd.casts.some(
            (c) => c.timeSeconds >= vw.from && c.timeSeconds <= vw.to,
          );

          // How much of the window was the player CC'd?
          const ccSeconds = ccSecondsInWindow(f, matchStartMs, vw.from, vw.to);

          friendlyOffensives.push({
            playerName: f.name,
            playerSpec: specToString(f.spec),
            spellName: cd.spellName,
            wasIdled: !wasCast,
            ccDurationInWindow: Math.round(ccSeconds * 10) / 10,
          });
        }
      }

      windows.push({
        targetUnitId: enemy.id,
        targetName: enemy.name,
        targetSpec: specToString(enemy.spec),
        fromSeconds: vw.from,
        toSeconds: vw.to,
        durationSeconds: windowDuration,
        friendlyDamageInWindow: windowDmg,
        friendlyOffensives,
        bursts: computeBurstSubWindows(windowDmgEvents, vw.from, vw.to),
      });
    }
  }

  return windows.sort((a, b) => a.fromSeconds - b.fromSeconds);
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatOffensiveWindowsForContext(
  windows: IOffensiveWindow[],
): string[] {
  const lines: string[] = [];
  lines.push(
    "ENEMY VULNERABILITY WINDOWS (defensive buff expired AND no CD available):",
  );

  if (windows.length === 0) {
    lines.push("  No significant vulnerability windows detected.");
    return lines;
  }

  for (const w of windows) {
    const dmgM = (w.friendlyDamageInWindow / 1_000_000).toFixed(2);

    lines.push("");
    lines.push(
      `  ${w.targetSpec} (${w.targetName}) — vulnerable ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} (${renderedWindowSeconds(w.fromSeconds, w.toSeconds)}s)`,
    );
    lines.push(`    Damage dealt: ${dmgM}M`);

    if (w.friendlyOffensives.length === 0) {
      lines.push(
        "    Friendly offensive CDs: none tracked as available during this window.",
      );
    } else {
      for (const fo of w.friendlyOffensives) {
        if (!fo.wasIdled) {
          lines.push(
            `    ${fo.playerSpec} used ${fo.spellName} during this window.`,
          );
        } else {
          const ccNote =
            fo.ccDurationInWindow > 0
              ? ` Note: ${fo.playerSpec} was CC'd for ${fo.ccDurationInWindow}s of this window.`
              : "";
          lines.push(
            `    ${fo.playerSpec} had ${fo.spellName} ready but did not use it.${ccNote}`,
          );
        }
      }
    }
  }

  return lines;
}
