import type { ReportSource } from "./types";
import { sideOfUnit, type TeamSide } from "./teamSide";

export interface ReplaySample {
  t: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface ReplayTrack {
  unitId: string;
  name: string;
  classId: number;
  specId: number;
  /** Which team this unit is on, via the shared `sideOfUnit` predicate
   * (anchored on combatant-info `teamId`). NOT the log's `reaction` flags —
   * Mind Control (605) flips a unit's flags mid-match, and flag-vote flips
   * used to put a mind-controlled teammate in the enemy column (issue #9).
   * Falls back to `reaction` only when `sideOfUnit` answers "unknown"
   * (imported log with no `playerTeamId`). */
  side: TeamSide;
  /** Samples in ascending order; at least 1. */
  samples: ReplaySample[];
  /** Timestamp of the first non-unconscious death (absolute ms); null = never
   * died. */
  deathT: number | null;
}

interface ReplayBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface ReplayData {
  startTime: number;
  endTime: number;
  bounds: ReplayBounds;
  tracks: ReplayTrack[];
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** Legacy fallback mapping for logs where `sideOfUnit` cannot answer (no
 * `playerTeamId`): the flag-vote reaction, collapsed onto the TeamSide axis.
 * Neutral/Unknown map to "unknown" (mute ring, enemy-side grouping —
 * unchanged from the pre-#9 rendering of those values). */
const sideFromReaction = (reaction: string): TeamSide =>
  reaction === "Friendly"
    ? "friendly"
    : reaction === "Hostile"
      ? "enemy"
      : "unknown";

/** Index of the first `samples[i].t >= t` (or length if none). The replay tick
 * path calls sampleAt x3 + pathUpTo x1 per track per frame; a linear scan
 * burns tens of thousands of iterations per frame on long matches (2500+
 * samples in a single track) — so all of them use binary search, point-for-
 * point equivalent to the linear version in semantics (asserted by
 * test/report.replay.bsearch.test.ts). */
function lowerBound(s: ReplaySample[], t: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Extract each player's positional track from advancedSamples (2D replay
 * data). Only player units that have coordinate samples are included; bounds
 * is the bounding box over all sample coordinates.
 */
export function deriveReplay(m: ReportSource): ReplayData {
  const tracks: ReplayTrack[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const u of Object.values(m.units)) {
    if (u.kind !== "Player") continue;
    const samples: ReplaySample[] = [];
    for (const s of u.advancedSamples) {
      if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
        samples.push({
          t: s.timestamp,
          x: s.x,
          y: s.y,
          hp: s.hp,
          maxHp: s.maxHp,
        });
      }
    }
    if (samples.length === 0) continue;
    for (const s of samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    }
    const death = u.deaths.find((d) => !d.unconscious);
    const side = sideOfUnit(m, u.id);
    tracks.push({
      unitId: u.id,
      name: u.name,
      classId: u.classId,
      specId: u.specId,
      side: side === "unknown" ? sideFromReaction(u.reaction) : side,
      samples,
      deathT: death ? death.timestamp : null,
    });
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }

  return {
    startTime: m.startTime,
    endTime: m.endTime,
    bounds: { minX, maxX, minY, maxY },
    tracks,
  };
}

/**
 * A unit's interpolated position/HP at a given moment (absolute ms).
 * null = not displayed at this moment (already dead). Outside the first/last
 * sample the value is clamped to that endpoint.
 */
export function sampleAt(
  track: ReplayTrack,
  t: number,
): { x: number; y: number; hp: number; maxHp: number } | null {
  const s = track.samples;
  if (s.length === 0) return null;
  if (track.deathT != null && t >= track.deathT) return null;
  const first = s[0]!;
  if (t <= first.t)
    return { x: first.x, y: first.y, hp: first.hp, maxHp: first.maxHp };
  const last = s[s.length - 1]!;
  if (t >= last.t)
    return { x: last.x, y: last.y, hp: last.hp, maxHp: last.maxHp };
  // The early returns guarantee first.t < t < last.t, so lowerBound is in
  // [1, length-1]
  const hi = Math.max(1, lowerBound(s, t));
  const a = s[hi - 1]!;
  const b = s[hi]!;
  const f = (t - a.t) / (b.t - a.t || 1);
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    hp: lerp(a.hp, b.hp, f),
    maxHp: lerp(a.maxHp, b.maxHp, f),
  };
}

/**
 * Movement trail points up to time t (within the most recent windowMs
 * window), used to draw the motion trail. Frozen at the moment of death once
 * the unit has died. Returns [] for an empty track.
 */
export function pathUpTo(
  track: ReplayTrack,
  t: number,
  windowMs = 6000,
): Array<{ x: number; y: number }> {
  const s = track.samples;
  if (s.length === 0) return [];
  const cut = track.deathT != null ? Math.min(t, track.deathT) : t;
  const from = cut - windowMs;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = lowerBound(s, from); i < s.length; i++) {
    const p = s[i]!;
    if (p.t > cut) break;
    pts.push({ x: p.x, y: p.y });
  }
  const cur = sampleAt(track, cut);
  if (cur) pts.push({ x: cur.x, y: cur.y });
  return pts;
}

/** A unit's death position (the last sample before the moment of death);
 * returns null if it never died or has no samples. */
export function deathPosition(
  track: ReplayTrack,
): { x: number; y: number } | null {
  if (track.deathT == null || track.samples.length === 0) return null;
  const s = track.samples;
  // The last sample with t <= deathT; when all samples are later than deathT,
  // keep the old semantics (take the first sample).
  // lowerBound(deathT+1) = index of the first t > deathT (t is integer ms).
  const idx = lowerBound(s, track.deathT + 1) - 1;
  const p = s[Math.max(0, idx)]!;
  return { x: p.x, y: p.y };
}

/**
 * Whether this unit's position at time t is actually EVIDENCED.
 *
 * Coordinates ride along on only a few kinds of combat records (`*_DAMAGE`
 * records the damage taker, `*_HEAL` the heal target, `SPELL_CAST_SUCCESS` the
 * caster) — and simply RUNNING produces no combat log record at all. So if
 * someone is just running at the start of a round without casting, taking
 * damage, or being healed, the log contains not a single record about them —
 * measured on real matches, the first sample arrives as late as +14.2s, and in
 * one shuffle round all six players' first samples were later than +4.4s.
 *
 * During that blind window `sampleAt` pins the position to the FIRST sample
 * (the only coordinate available), so the view draws the player at "wherever
 * they first got pulled into the fight" — usually most of an arena away from
 * their actual starting point. The render layer must use this predicate to
 * mark that span as "position unknown" instead of drawing it as a known
 * position.
 *
 * Single-source predicate: rendering and tests share this function; do not
 * re-implement `t >= samples[0].t` inside a component.
 */
export function positionKnownAt(track: ReplayTrack, t: number): boolean {
  const first = track.samples[0];
  if (!first) return false;
  if (track.deathT != null && t >= track.deathT) return false;
  return t >= first.t;
}
