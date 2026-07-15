import { ICombatUnit } from "@gladlog/parser-compat";

import { ArenaObstacle, arenaObstacles } from "../data/arenaGeometry";

// ---------------------------------------------------------------------------
// Position interpolation
// ---------------------------------------------------------------------------

export interface IPosition {
  x: number;
  y: number;
}

/**
 * Interpolate a unit's game position at a given absolute timestamp (ms).
 * Returns null when advanced logging is absent or the timestamp is outside
 * the unit's advancedActions range.
 *
 * Position snapshots are event-driven (damage taken, heals received, casts),
 * so an idle unit (drinking, stealthed, out of combat) produces none — the
 * straight line interpolated across such a gap is fabricated, not observed.
 * Pass `maxGapMs` to return null when the query time is further than maxGapMs
 * from the NEAREST recorded snapshot (interpolation error is bounded by
 * movement speed × that distance, so proximity to either bracketing snapshot
 * keeps the estimate honest; also applies past the last snapshot).
 * Omitted = legacy behavior: interpolate any gap, hold the last position forever.
 */
export function getUnitPositionAtTime(
  unit: ICombatUnit,
  timestampMs: number,
  maxGapMs?: number,
): IPosition | null {
  const actions = unit.advancedActions;
  if (actions.length === 0) return null;

  // Before first recorded action
  if (timestampMs < actions[0].timestamp) return null;
  // After last recorded action — use last known position (until maxGapMs elapses)
  if (timestampMs >= actions[actions.length - 1].timestamp) {
    const last = actions[actions.length - 1];
    if (maxGapMs !== undefined && timestampMs - last.timestamp > maxGapMs)
      return null;
    return { x: last.advancedActorPositionX, y: last.advancedActorPositionY };
  }

  for (let i = 0; i < actions.length - 1; i++) {
    const curr = actions[i];
    const next = actions[i + 1];
    if (curr.timestamp <= timestampMs && next.timestamp > timestampMs) {
      if (
        maxGapMs !== undefined &&
        Math.min(timestampMs - curr.timestamp, next.timestamp - timestampMs) >
          maxGapMs
      ) {
        return null;
      }
      const t =
        (timestampMs - curr.timestamp) / (next.timestamp - curr.timestamp);
      return {
        x:
          curr.advancedActorPositionX +
          (next.advancedActorPositionX - curr.advancedActorPositionX) * t,
        y:
          curr.advancedActorPositionY +
          (next.advancedActorPositionY - curr.advancedActorPositionY) * t,
      };
    }
  }

  return null;
}

/**
 * Nearest RAW sampled position within `maxGapMs` of the instant — no interpolation.
 * Line-of-sight is a topological predicate: an interpolated point between two
 * real samples can sit on the wrong side of a pillar edge that neither real
 * position crossed (2026-07-14 audit: a "go break LoS" suggestion fired at an
 * interpolated in-LoS point while every raw sample was pillar-blocked). Use this
 * for LoS decisions; keep getUnitPositionAtTime for continuous quantities
 * (distance), where interpolation is sound.
 */
export function getUnitRawPositionAtTime(
  unit: ICombatUnit,
  timestampMs: number,
  maxGapMs: number,
): IPosition | null {
  const actions = unit.advancedActions;
  if (actions.length === 0) return null;
  let best: (typeof actions)[number] | null = null;
  let bestDt = Infinity;
  for (const a of actions) {
    const dt = Math.abs(a.timestamp - timestampMs);
    if (dt < bestDt) {
      bestDt = dt;
      best = a;
    }
    if (a.timestamp > timestampMs && dt > bestDt) break; // sorted — past the minimum
  }
  if (!best || bestDt > maxGapMs) return null;
  return { x: best.advancedActorPositionX, y: best.advancedActorPositionY };
}

// ---------------------------------------------------------------------------
// 2D geometry helpers
// ---------------------------------------------------------------------------

/** Check if line segment AB intersects a circle with center C and radius r. */
function segmentIntersectsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;

  const sqrtD = Math.sqrt(discriminant);
  const t1 = (-b - sqrtD) / (2 * a);
  const t2 = (-b + sqrtD) / (2 * a);

  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

/** Check if line segment AB intersects a convex polygon. */
function segmentIntersectsPolygon(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  vertices: [number, number][],
): boolean {
  if (vertices.length < 3) return false;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = vertices[i];
    const [qx, qy] = vertices[(i + 1) % n];
    if (segmentsIntersect(ax, ay, bx, by, px, py, qx, qy)) return true;
  }
  // Check if either endpoint is inside the polygon
  return pointInPolygon(ax, ay, vertices) || pointInPolygon(bx, by, vertices);
}

function cross2D(ux: number, uy: number, vx: number, vy: number): number {
  return ux * vy - uy * vx;
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross2D(dx - cx, dy - cy, ax - cx, ay - cy);
  const d2 = cross2D(dx - cx, dy - cy, bx - cx, by - cy);
  const d3 = cross2D(bx - ax, by - ay, cx - ax, cy - ay);
  const d4 = cross2D(bx - ax, by - ay, dx - ax, dy - ay);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

function pointInPolygon(
  px: number,
  py: number,
  vertices: [number, number][],
): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function obstacleBlocksSegment(
  obs: ArenaObstacle,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (obs.type === "circle") {
    return segmentIntersectsCircle(ax, ay, bx, by, obs.cx, obs.cy, obs.r);
  } else {
    return segmentIntersectsPolygon(ax, ay, bx, by, obs.vertices);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if caster has unobstructed line of sight to target (no arena
 * obstacle intersects the line between them).
 *
 * Returns null when:
 *   - the zoneId has no geometry data (arena not yet mapped), or
 *   - either position is unavailable (no advanced logging).
 *
 * Note: this is a 2D approximation — Z-axis elevation and pillar overhangs
 * are not modelled. Accurate for standard arena play where players stay on
 * the ground level.
 */
// No arena obstacle fully separates two units this close together — approximate
// minimap-derived geometry that claims otherwise is wrong. 100-game sweep
// (2026-07-07): 142 landed CCs carried "LoS blocked", clustered on Dalaran
// Sewers / Tiger's Peak / Lordaeron / Nokhudon, many at <6yd.
const NEAR_RANGE_LOS_EXEMPT_YARDS = 8;

export function hasLineOfSight(
  zoneId: string,
  casterPos: IPosition,
  targetPos: IPosition,
): boolean | null {
  const obstacles = arenaObstacles[zoneId];
  // Unknown arena or no geometry mapped yet
  if (!obstacles || obstacles.length === 0) return null;

  if (distanceBetween(casterPos, targetPos) < NEAR_RANGE_LOS_EXEMPT_YARDS)
    return true;

  for (const obs of obstacles) {
    if (
      obstacleBlocksSegment(
        obs,
        casterPos.x,
        casterPos.y,
        targetPos.x,
        targetPos.y,
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Convenience: compute distance between two positions in game yards.
 */
export function distanceBetween(a: IPosition, b: IPosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Distance in yards from a position to the EDGE of the nearest arena obstacle
 * (0 when inside one). Returns null when the zone has no geometry mapped.
 * Powers "a pillar was ~Xyd away" coaching hints on exposure windows.
 */
export function distanceToNearestObstacleEdge(
  zoneId: string,
  pos: IPosition,
): number | null {
  const obstacles = arenaObstacles[zoneId];
  if (!obstacles || obstacles.length === 0) return null;

  let best = Infinity;
  for (const obs of obstacles) {
    let d: number;
    if (obs.type === "circle") {
      d = Math.max(0, Math.hypot(pos.x - obs.cx, pos.y - obs.cy) - obs.r);
    } else if (pointInPolygon(pos.x, pos.y, obs.vertices)) {
      d = 0;
    } else {
      d = Infinity;
      const n = obs.vertices.length;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = obs.vertices[i];
        const [bx, by] = obs.vertices[(i + 1) % n];
        d = Math.min(d, distancePointToSegment(pos.x, pos.y, ax, ay, bx, by));
      }
    }
    best = Math.min(best, d);
  }
  return best;
}

export interface ILosBreakOption {
  /** Distance from the healer to the verified LoS-breaking spot (yards). */
  repositionYards: number;
  /** The exposed enemy that spot pillar-blocks. */
  blocksEnemyName: string;
}

/** F194: nearest spot that VERIFIABLY breaks LoS to at least one of the given enemies —
 * directional, unlike distanceToNearestObstacleEdge (bare geometry that may block nobody).
 * Candidates are sampled just behind each obstacle relative to each enemy and validated
 * with hasLineOfSight, so an emitted option always blocks the named enemy. */
export function nearestLosBreakOption(
  zoneId: string,
  healerPos: IPosition,
  enemies: { name: string; pos: IPosition }[],
): ILosBreakOption | null {
  const obstacles = arenaObstacles[zoneId];
  if (!obstacles || obstacles.length === 0 || enemies.length === 0) return null;

  const MARGIN_YARDS = 2;
  const MAX_EXIT_WALK_YARDS = 50;
  let best: ILosBreakOption | null = null;

  for (const obs of obstacles) {
    // Obstacle center: circle center, or polygon vertex centroid.
    const cx =
      obs.type === "circle"
        ? obs.cx
        : obs.vertices.reduce((s, v) => s + v[0], 0) / obs.vertices.length;
    const cy =
      obs.type === "circle"
        ? obs.cy
        : obs.vertices.reduce((s, v) => s + v[1], 0) / obs.vertices.length;

    for (const enemy of enemies) {
      const dx = cx - enemy.pos.x;
      const dy = cy - enemy.pos.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue; // enemy standing on the obstacle center — degenerate
      const ux = dx / len;
      const uy = dy / len;

      // Exit distance from the center along (ux, uy): analytic for circles, sampled for polygons.
      let exit: number;
      if (obs.type === "circle") {
        exit = obs.r;
      } else {
        exit = MAX_EXIT_WALK_YARDS;
        for (let t = 0.5; t <= MAX_EXIT_WALK_YARDS; t += 0.5) {
          if (!pointInPolygon(cx + ux * t, cy + uy * t, obs.vertices)) {
            exit = t;
            break;
          }
        }
      }

      const candidate: IPosition = {
        x: cx + ux * (exit + MARGIN_YARDS),
        y: cy + uy * (exit + MARGIN_YARDS),
      };
      // Ground truth: the spot must actually break LoS to this enemy (the near-range
      // exemption inside hasLineOfSight correctly rejects unblockable close threats).
      if (hasLineOfSight(zoneId, candidate, enemy.pos) !== false) continue;

      const yards = distanceBetween(healerPos, candidate);
      if (best === null || yards < best.repositionYards) {
        best = { repositionYards: yards, blocksEnemyName: enemy.name };
      }
    }
  }
  return best;
}
