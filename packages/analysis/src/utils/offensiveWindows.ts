import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  countsAsKillWindowDefensiveInHand,
  isKillWindowMajorDefensive,
  KW_MAJOR_DEF_MIN_CD_S,
  kwCooldownSeconds,
  unpressedKitDefensiveInHand,
} from "../data/abilityProfile";
import { SELF_WALL_AURA_TO_CAST_ID } from "../data/mitigationData";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { spellEffectData } from "../data/spellEffectData";
import { SpellTag } from "../data/spellTypes";
import { supersededAuraBreaks } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { extractSpiritOfRedemptionIntervals } from "./combatStates";
import {
  chargeAvailabilityTransitions,
  entryAvailabilityTransitions,
  extractMajorCooldowns,
  specToString,
  unitCooldownEntry,
  unitCooldownOf,
} from "./cooldowns";
import {
  areaSaveSpansOnS,
  enemyDefensiveEvents,
  type ISaveAuraInterval,
  isBelowWallFloorExternal,
  KW_REDIRECT_PROTECTION_AURA_IDS,
  KW_UNTARGETABLE_AURA_IDS,
  ownPressedShieldSpansMs,
  ownSaveSpanS,
  ownWallSpanS,
  renderedExternalSpanS,
  SAVE_CAST_AURA_PAIR_S,
  saveAuraIntervals,
  wallTableIdOfAura,
} from "./enemyDefensives";
import { isDeferralAbsorb } from "./incomingPressure";
import { fmtTime, renderedWindowSeconds } from "./renderGrid";
import { roundEndMs } from "./roundEnd";
// GH #31 ② (2026-09-02): the hand list is replaced by the shared official-face
// predicate; the curated remainder lives as its registered fallback floor.
import { summonOwnerById } from "./summonOwner";
import { firstDeathMs } from "./unitDeath";
import { unusedKitRows } from "./unusedKitRows";

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
  /** Total friendly damage to the target inside this burst — the health it
   * lost. */
  damage: number;
  /** What the target's shields absorbed of the team's hits inside this burst
   * (fact2 R7). A burst is found, floored and ranked on `damage + absorbed`
   * — the measure KILL ATTEMPTS' floor reads. */
  absorbed: number;
}

/**
 * Clusters friendly damage events on the window's target into bursts
 * (gap > KW_BURST_GAP_S splits; clusters over KW_BURST_SOFT_MAX_S re-split at
 * their largest lull; clusters under KW_BURST_MIN_DAMAGE dropped; top
 * KW_MAX_BURSTS by damage, returned chronologically).
 */
export function computeBurstSubWindows(
  damageEvents: Array<{ t: number; amount: number; absorbed?: true }>,
  spanFrom: number,
  spanTo: number,
): IBurstSubWindow[] {
  // fact2 R7, user ruling 2026-10-20 (option A): absorbed hits count — the
  // burst is found and floored on what the team's hits did, landed or eaten
  // by a shield (605 against landed-only: +412 [KILL WINDOW], −217
  // [VULNERABLE] "not punished", no candidate moved)
  if (damageEvents.length === 0) return [];
  const sorted = [...damageEvents].sort((a, b) => a.t - b.t);

  // Gap-based clustering, keeping the event lists for recursive splitting.
  type Ev = { t: number; amount: number; absorbed?: true };
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
      damage: evs.reduce((s, e) => s + (e.absorbed ? 0 : e.amount), 0),
      absorbed: evs.reduce((s, e) => s + (e.absorbed ? e.amount : 0), 0),
    }));
  const hit = (c: IBurstSubWindow) => c.damage + c.absorbed;

  return (
    clusters
      .filter((c) => hit(c) >= KW_BURST_MIN_DAMAGE)
      .sort((a, b) => hit(b) - hit(a))
      .slice(0, KW_MAX_BURSTS)
      .sort((a, b) => a.fromSeconds - b.fromSeconds)
      // Widen to at least ~2s (single-hit clusters would render zero-width),
      // clamped to the vulnerability span.
      .map((c) => ({
        ...c,
        // the absorbed part over the cluster's own hits — the same stretch
        // `damage` sums — whether or not it counted toward finding it
        absorbed: damageEvents
          .filter(
            (e) => e.absorbed && e.t >= c.fromSeconds && e.t <= c.toSeconds,
          )
          .reduce((s, e) => s + e.amount, 0),
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
  /** CD_USED only: the press puts up nothing the span counts as a defense
   * (`KW_IN_HAND_ONLY_DEFENSIVE_IDS`: a rewind) — it only spends the charge. */
  holdsNothing?: boolean;
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
  /** Total friendly damage dealt to this enemy during the window — the health
   * it lost (absorbed hits not counted) */
  friendlyDamageInWindow: number;
  /** What the enemy's shields absorbed of the same team's hits in the window
   * (fact2 R7) — printed beside the total, never folded into it */
  friendlyAbsorbedInWindow: number;
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

/**
 * Does the span's state machine time a CAST of this spell (step 1)? A roster
 * spell with official data — admission on the official number the predicate
 * itself reads (`kwCooldownSeconds`; it already enforced
 * >= KW_MAJOR_DEF_MIN_CD_S). One test for the cast scan and for step 2b's
 * "is this wall's press the machine's" (`ownWallSpanS`).
 */
function timesCastOf(spellId: string): boolean {
  return (
    isKillWindowMajorDefensive(spellId) &&
    !!spellEffectData[spellId] &&
    kwCooldownSeconds(spellId) >= KW_MAJOR_DEF_MIN_CD_S
  );
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
  // T12 ① a (user ruling 2026-10-10): a kill window does not run past the
  // round's end either. `roundEndMs` is the one round end — a Solo Shuffle
  // round is over at its first player death, and the log runs on for a
  // couple of seconds after it (the state machine below closes a still-open
  // span at the LOG's end). See step 2c.
  const roundEnd = (roundEndMs(combat) - matchStartMs) / 1000;
  const roundEndS = Number.isFinite(roundEnd) ? roundEnd : Infinity;
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
  // gets from the line itself. An external whose end the log never showed
  // prints `end not logged` (ruling D6) and still cuts the span, at the
  // interval's official-length cap: "defenseless" says nothing was up, and
  // an aura that may still be up cannot be read as gone.
  //
  // …and the 20–99 % walls each enemy put up ITSELF that the state machine
  // below does not time (R08 d, gap 1, 2026-10-13). The machine holds "not
  // defenseless" only for a CAST of a roster spell (`timesCastOf`), and its
  // roster is a curated list: a wall outside it (Survival of the Fittest
  // 264735, Retribution's Divine Protection 403876 — both entered the
  // mitigation table after the list was frozen), and a roster wall's aura
  // with no cast of its id behind it (310e5c6d, raw 12:56:44.478: Ancient of
  // Lore 473909 applied in the millisecond the Reforestation buff 392360 is
  // removed, 28 ms after a Swiftmend), left the span open across the wall's
  // own `[ENEMY DEF]` line — f4da82c5 round 5: `defenseless 1:35–2:51` on a
  // hunter whose Survival of the Fittest went up at 2:04 (raw 11:15:51.992).
  // Such a wall is taken out for as long as its aura was up (`ownWallSpanS`,
  // the event its line is rendered from — an aura of a `MITIGATION_TABLE`
  // 20–99 % row the unit applied to itself), so every table wall is covered
  // whatever the roster holds; a pressed self defensive that is no wall is
  // not an event of this kind (Roar of Sacrifice — a redirect, rulings A20 +
  // U3). A press the machine times keeps its reading (ruling D6).
  // The roster was widened by user ruling (2026-10-20: Survival of the
  // Fittest, Retribution's Divine Protection, Dark Pact), together with the
  // owned-but-unpressed half (an `[UNUSED]` roster defensive in the kit keeps
  // the unit out of every span, the check before step 2) — docs/predicate-index R08 d.
  // fact1215 R7 (2026-10-18): the unit's own immunities and self-saves cut
  // it too (`ownSaveSpanS`), and an area save cuts every unit that carries
  // its aura (`areaSaveSpanOnS`) — a Vanish, a 494k Anti-Magic Shell, a
  // Rallying Cry sat inside spans that said nothing was up.
  const savesUpOn = new Map<string, Array<{ from: number; to: number }>>();
  const addSave = (
    holderId: string | undefined,
    span?: { from: number; to: number },
  ) => {
    if (!holderId || !span) return;
    const list = savesUpOn.get(holderId) ?? [];
    list.push(span);
    savesUpOn.set(holderId, list);
  };
  const intervalsOf = new Map<string, ISaveAuraInterval[]>();
  const holderIntervals = (u: ICombatUnit) => {
    let ivs = intervalsOf.get(u.id);
    if (!ivs) {
      ivs = saveAuraIntervals(u, enemies, combat);
      intervalsOf.set(u.id, ivs);
    }
    return ivs;
  };
  for (const caster of enemies) {
    for (const d of enemyDefensiveEvents(caster, enemies, combat)) {
      // F15 C1: a 15 % ally copy cuts no span, as a 15 % own aura does not
      if (isBelowWallFloorExternal(d)) continue;
      if (d.kind === "area") {
        const lifetimeS =
          buffFullDurationForCaster(d.spellId, caster, matchStartMs) ??
          SAVE_CAST_AURA_PAIR_S;
        const fromCaster = (src: string | undefined) =>
          src === caster.id ||
          (!!src &&
            allUnits.some((u) => u.id === src && u.ownerId === caster.id));
        for (const holder of enemies)
          for (const span of areaSaveSpansOnS(
            d,
            holderIntervals(holder),
            fromCaster,
            lifetimeS,
          ))
            addSave(holder.id, span);
        continue;
      }
      const timed = timesCastOf(wallTableIdOfAura(d.spellId));
      addSave(
        d.kind === "external" ? d.recipientId : caster.id,
        d.kind === "external"
          ? renderedExternalSpanS(d)
          : d.kind === "self"
            ? ownWallSpanS(d, timed)
            : ownSaveSpanS(d, timed),
      );
    }
  }

  // the holder's first own press or hit after `fromS` (seconds; Infinity
  // when none) — where an unseen aura's end is read
  const firstActionAfterS = (u: ICombatUnit, fromS: number): number => {
    let first = Infinity;
    const after = (ms: number) => (ms - matchStartMs) / 1000;
    for (const c of u.spellCastEvents ?? [])
      if (c.logLine.event === LogEvent.SPELL_CAST_SUCCESS) {
        const t = after(c.logLine.timestamp);
        if (t > fromS && t < first) first = t;
      }
    for (const d of u.damageOut ?? []) {
      const t = after(d.logLine.timestamp);
      if (t > fromS && t < first) first = t;
    }
    return first;
  };
  // User rulings 2026-10-21: the target's own Power Word: Shield / Void
  // Shield and an Intervene on it end the span while their aura is up
  // (`KW_OWN_ROTATIONAL_ABSORB_AURA_IDS`, `KW_REDIRECT_PROTECTION_AURA_IDS`)
  // …and every other own absorb shield it pressed that the log shows
  // absorbing for it, within a minute of a press of it
  // (`ownPressedShieldSpansMs`, corpusFactScan2 defenselessSaveUp / E6)
  for (const holder of enemies) {
    for (const iv of holderIntervals(holder)) {
      if (KW_REDIRECT_PROTECTION_AURA_IDS.has(iv.spellId)) {
        addSave(holder.id, { from: iv.fromS, to: iv.toS });
        continue;
      }
      const shieldSpans =
        iv.srcUnitId === holder.id
          ? ownPressedShieldSpansMs(
              holder,
              iv.spellId,
              matchStartMs + iv.fromS * 1000,
              matchStartMs + iv.toS * 1000,
            )
          : [];
      for (const sp of shieldSpans)
        addSave(holder.id, {
          from: (sp.fromMs - matchStartMs) / 1000,
          to: (sp.toMs - matchStartMs) / 1000,
        });
      if (shieldSpans.length > 0) continue;
      if (KW_UNTARGETABLE_AURA_IDS.has(iv.spellId))
        // round-3 q6 / fact3 D54: Mass Invisibility and Phase Shift; an end
        // the log never showed is the holder's first action after it
        addSave(holder.id, {
          from: iv.fromS,
          to: iv.inferredEnd
            ? Math.min(iv.toS, firstActionAfterS(holder, iv.fromS))
            : iv.toS,
        });
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
      // the roster's presses, and the rewinds that count only while in hand
      // (user ruling 2026-10-20: a ready Alter Time is a major defensive in
      // hand; pressed, it is no defense that was up — fact1215 R7)
      if (
        !spellId ||
        !(
          timesCastOf(spellId) ||
          (countsAsKillWindowDefensiveInHand(spellId) &&
            !!spellEffectData[spellId])
        )
      )
        continue;
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
      // Charge-state transitions under the shared cooldown model
      // (`unitCooldownEntry` → `entryAvailabilityTransitions`: the enemy's
      // presses as the ledger identifies them, per-press talent effects —
      // cooldown mastery round 2026-10-20); the static sequential-recharge
      // timeline only for a spell DB2 has no row for.
      const entry = unitCooldownEntry(enemy, combat, spellId);
      if (entry) {
        casts.splice(
          0,
          casts.length,
          ...entry.casts
            .map((c) => c.timeSeconds)
            .filter((t) => t <= matchDurationSeconds)
            .sort((a, b) => a - b),
        );
      }
      const flips = entry
        ? entryAvailabilityTransitions(entry, matchDurationSeconds)
        : chargeAvailabilityTransitions(
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
      const holdsNothing = !timesCastOf(spellId);
      for (const castTimeSeconds of casts) {
        if (holdsNothing) {
          events.push({
            time: castTimeSeconds,
            kind: "CD_USED",
            spellId,
            spellName: effectData.name,
            spendsLast: takeFlip(emptiedAt, castTimeSeconds),
            holdsNothing,
          });
          continue;
        }
        // A wall whose DB2 duration sits on its logged aura, not on the cast
        // (Greater Invisibility 110959 → 110960, 20 s), is timed by that
        // aura's OFFICIAL length. This state machine never reads the aura
        // interval — every press, whatever the log shows of its end, holds
        // "not defenseless" for the official length — so ruling D6 (an aura
        // the log never shows end is no cause "already up" in KILL ATTEMPTS,
        // and prints `end not logged`) leaves it as it is, on purpose:
        // "defenseless" claims the wall was DOWN, and for a mage who went
        // unseen the log shows that no more than it shows the wall up. The
        // official length is the longest the wall can have lasted, so the
        // span opens no earlier than the log can support.
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

    // A roster defensive in the kit and never pressed this round is in hand
    // the whole round (user ruling 2026-10-20, fact1215 retest idx 60
    // 「都要」: `target defenseless 0:49–1:47` on a Restoration Druid whose
    // kit printed `Barkskin [60s, lasts 12s] [UNUSED]` — KILL ATTEMPTS said
    // `gated (Barkskin in hand)` of the same unit). Such a unit is never
    // defenseless. The kit row is the ledger's ownership rule
    // (`unusedKitRows`, the one KILL ATTEMPTS' wall tier reads).
    if (
      unusedKitRows(enemy, combat).some(
        (r) =>
          unpressedKitDefensiveInHand(r.spellId) &&
          !castsBySpell.has(r.spellId),
      )
    )
      continue;

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
          if (!ev.holdsNothing) active++;
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
    // The unit's own 20–99 % walls are in the same list (see `savesUpOn`).
    const received = savesUpOn.get(enemy.id) ?? [];
    // ── 2c. A dead target is not "defenseless" — it is dead; a round that is
    //        over has no kill window ─────────────────────────────────────────
    // T12 ① a (user ruling 2026-10-10, D1): the state machine reads only the
    // target's presses, so a wall whose nominal end fell after the target's
    // death opened a span on a corpse (1bad0a5c: `[VULNERABLE] 1:38–1:50` on a
    // shaman dead at 1:35.8), and kick-priority read "the kill target at 0 %"
    // off it 2.3 s after the death (65-1 t=79.4). The span ends at the death
    // (`firstDeathMs`, the one death instant); a span that starts at or after
    // it does not exist. Cut at the source so every reader moves together.
    // …and so is a round that is over: the same cut at the round's end
    // (`roundEndS`), whichever comes first. A Solo Shuffle round ends at its
    // first player death — anyone's — so a span on a SURVIVING enemy ran to
    // the log's end, ~2 s later (1,000 of 8,219 Solo Shuffle `[KILL WINDOW]` /
    // `[VULNERABLE]` spans on the 605-file capture ended more than 1 s after
    // the round's first `[DEATH]` line), and kick-priority and the missed
    // purges read casts after the round as "inside a kill window".
    const deathS = (firstDeathMs(enemy) - matchStartMs) / 1000;
    const endS = Math.min(deathS, roundEndS);
    // ── 2d. A priest in Spirit of Redemption form is not "defenseless"
    //        either — it cannot be hit ───────────────────────────────────────
    // F17 (user ruling 2026-10-11, option b): the state machine times the
    // pressed form (215769) as any other press, on an official length, and
    // does not see the on-death one (27827) at all, so a span sat on or ran
    // across the form — 174-1-1061: `[VULNERABLE] 1:06–1:26 … never punished`
    // on a Holy Priest in the form until 1:07.4 (raw APPLIED 58.39 s, REMOVED
    // 67.42 s), and `defenseless 0:39–1:27` across a whole form elsewhere.
    // The form's interval is the `[STATE]` tick's own
    // (`extractSpiritOfRedemptionIntervals`, read off the aura on the unit),
    // taken out like an external received: the span ends where the form
    // begins and the next one starts where it ends. 81 logs, 300 pressed
    // forms: no damage row lands on the holder later than 1.47 s after the
    // aura went up (40 rows in 13 of them, hits already in flight), and none
    // dies in it. Only this form — Nullifying Shroud and stealth are not read.
    const inForm = extractSpiritOfRedemptionIntervals(enemy, combat).map(
      (g) => ({ from: g.startSeconds, to: g.endSeconds }),
    );
    const cutWindows = subtractIntervals(vulnWindows, [...received, ...inForm])
      .filter((w) => w.from < endS)
      .map((w) => ({ from: w.from, to: Math.min(w.to, endS) }))
      .filter((w) => w.to - w.from >= MIN_VULN_SECONDS);

    // ── 3. Per-window metrics ──────────────────────────────────────────────────

    for (const vw of cutWindows) {
      const windowDuration = vw.to - vw.from;

      // Friendly damage dealt to this specific enemy during the window: the
      // health it lost, and — beside it — what its shields ate of the same
      // team's hits (`absorbsIn`, the victim-keyed SPELL_ABSORBED stream).
      // fact2 R7 (2026-10-20, user ruling 3): `[VULNERABLE] … never punished
      // (team damage 0k total)` on a rogue whose shields took 381k of the
      // team's hits in the span (8a820ea3). The bursts are found on both, the
      // measure KILL ATTEMPTS' `KW_BURST_MIN_DAMAGE` floor already reads
      // (`damageOut` carries the SPELL_ABSORBED rows); the printed total keeps
      // the health lost and states the absorbed part apart.
      const windowDmgEvents: Array<{
        t: number;
        amount: number;
        absorbed?: true;
      }> = [];
      for (const d of enemy.damageIn) {
        if (!friendlySources.has(d.srcUnitId)) continue;
        const t = (d.logLine.timestamp - matchStartMs) / 1000;
        if (t < vw.from || t > vw.to) continue;
        windowDmgEvents.push({ t, amount: Math.abs(d.effectiveAmount) });
      }
      for (const a of enemy.absorbsIn ?? []) {
        if (!a.attackerId || !friendlySources.has(a.attackerId)) continue;
        // a deferral shield only delayed the hit (Time Dilation, Stretch
        // Time): counted when it lands, never as absorbed (FT-T02b,
        // `isDeferralAbsorb`; codex 20-F16-01 #2)
        if (isDeferralAbsorb(a)) continue;
        const t = (a.logLine.timestamp - matchStartMs) / 1000;
        if (t < vw.from || t > vw.to) continue;
        windowDmgEvents.push({
          t,
          amount: Math.abs(a.absorbedAmount),
          absorbed: true,
        });
      }
      const windowDmg = windowDmgEvents.reduce(
        (sum, e) => sum + (e.absorbed ? 0 : e.amount),
        0,
      );
      const windowAbsorbed = windowDmgEvents.reduce(
        (sum, e) => sum + (e.absorbed ? e.amount : 0),
        0,
      );

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
        friendlyAbsorbedInWindow: windowAbsorbed,
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
