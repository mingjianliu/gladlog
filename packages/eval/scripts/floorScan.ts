 
/**
 * CLI: measure arena walkable-floor outlines from the corpus (floor occupancy
 * scan).
 *
 * The CDN minimap only has the pillar point cloud, not the arena edges or the
 * starting rooms. This script accumulates an occupancy grid per zone from the
 * advancedSamples positions of real matches, traces the boundary of the binary
 * grid (Moore neighborhood) and simplifies it with RDP, emitting one outer
 * outline polygon per map in world coordinates for the replay to draw arena
 * boundaries. Starting rooms are naturally included when the corpus sampled them.
 *
 * Usage: tsx packages/eval/scripts/floorScan.ts \
 *   --dirs <logDir1,logDir2> [--limit 600] [--cell 1] [--min 3] \
 *   [--out packages/desktop/src/renderer/src/report/data/arenaFloors.json]
 */

import { GladLogParser } from "@gladlog/parser";
import fs from "fs-extra";
import path from "path";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    dirs: "",
    limit: 600,
    cell: 1,
    min: 3,
    out: "packages/desktop/src/renderer/src/report/data/arenaFloors.json",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--dirs") out.dirs = a[i + 1];
    else if (a[i] === "--limit") out.limit = Number(a[i + 1]);
    else if (a[i] === "--cell") out.cell = Number(a[i + 1]);
    else if (a[i] === "--min") out.min = Number(a[i + 1]);
    else if (a[i] === "--out") out.out = a[i + 1];
  }
  if (!out.dirs) {
    console.error("Usage: floorScan --dirs <dir1,dir2> [...]");
    process.exit(1);
  }
  return out;
}

type Grid = Map<string, number>; // "cx,cy" -> count
interface ZoneAcc {
  grid: Grid;
  samples: number;
  matches: number;
}

/** Largest connected component (4-neighborhood) — drops noise islands formed by
 * teleports and bogus coordinates. */
function largestComponent(cells: Set<string>): Set<string> {
  const seen = new Set<string>();
  let best: Set<string> = new Set();
  for (const start of cells) {
    if (seen.has(start)) continue;
    const comp = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const c = stack.pop()!;
      if (comp.has(c)) continue;
      comp.add(c);
      seen.add(c);
      const [x, y] = c.split(",").map(Number);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = `${x + dx},${y + dy}`;
        if (cells.has(n) && !comp.has(n)) stack.push(n);
      }
    }
    if (comp.size > best.size) best = comp;
  }
  return best;
}

/** Moore-neighborhood boundary tracing: returns the ordered sequence of boundary
 * cell centers. */
function traceBoundary(cells: Set<string>): [number, number][] {
  if (cells.size === 0) return [];
  // Start point: the bottom-left-most cell
  let sx = Infinity;
  let sy = Infinity;
  for (const c of cells) {
    const [x, y] = c.split(",").map(Number);
    if (y < sy || (y === sy && x < sx)) {
      sx = x;
      sy = y;
    }
  }
  const dirs: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const has = (x: number, y: number) => cells.has(`${x},${y}`);
  const out: [number, number][] = [];
  let cx = sx;
  let cy = sy;
  let dir = 0; // index of the direction we arrived from
  const maxSteps = cells.size * 8;
  for (let step = 0; step < maxSteps; step++) {
    out.push([cx, cy]);
    // Back up 2 counter-clockwise from the arrival direction, then search
    // clockwise for the next boundary cell
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8;
      const [dx, dy] = dirs[d];
      if (has(cx + dx, cy + dy)) {
        cx += dx;
        cy += dy;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break; // single isolated cell
    if (cx === sx && cy === sy && out.length > 2) break;
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification. */
function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const d2 = (
    p: [number, number],
    a: [number, number],
    b: [number, number],
  ) => {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return (px - ax) ** 2 + (py - ay) ** 2;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return (px - qx) ** 2 + (py - qy) ** 2;
  };
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = d2(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps * eps) {
    const left = rdp(pts.slice(0, idx + 1), eps);
    const right = rdp(pts.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0], pts[pts.length - 1]];
}

async function main() {
  const args = parseArgs();
  const zones = new Map<string, ZoneAcc>();
  const files: string[] = [];
  for (const dir of args.dirs.split(",")) {
    const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".txt"));
    for (const n of names) files.push(path.join(dir, n));
  }
  const picked = files.slice(0, args.limit);
  console.log(`scanning ${picked.length}/${files.length} logs`);

  let done = 0;
  for (const f of picked) {
    const parser = new GladLogParser();
    const combats: { zoneId: string; units: Record<string, unknown> }[] = [];
    parser.on("match", (m: unknown) => combats.push(m as (typeof combats)[0]));
    parser.on("shuffle", (sh: unknown) => {
      for (const r of (sh as { rounds?: unknown[] }).rounds ?? [])
        combats.push(r as (typeof combats)[0]);
    });
    try {
      const text = await fs.readFile(f, "utf-8");
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const c of combats) {
      const zoneId = String(
        (c as { zoneId?: unknown; startInfo?: { zoneId?: unknown } }).zoneId ??
          (c as { startInfo?: { zoneId?: unknown } }).startInfo?.zoneId ??
          "",
      );
      if (!zoneId) continue;
      const acc =
        zones.get(zoneId) ??
        zones
          .set(zoneId, { grid: new Map(), samples: 0, matches: 0 })
          .get(zoneId)!;
      acc.matches++;
      for (const u of Object.values(c.units ?? {})) {
        const unit = u as {
          kind?: string;
          advancedSamples?: { x: number; y: number }[];
        };
        if (unit.kind !== "Player") continue;
        for (const s of unit.advancedSamples ?? []) {
          if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
          const key = `${Math.floor(s.x / args.cell)},${Math.floor(s.y / args.cell)}`;
          acc.grid.set(key, (acc.grid.get(key) ?? 0) + 1);
          acc.samples++;
        }
      }
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${picked.length}`);
  }

  /** Morphological smoothing: first fill holes (fill a cell when ≥5/8 neighbors
   * are occupied), then strip whiskers (delete a cell with ≤2/8 neighbors); two
   * rounds of each. */
  const smooth = (cells: Set<string>): Set<string> => {
    const neigh = (s: Set<string>, x: number, y: number) => {
      let n = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (s.has(`${x + dx},${y + dy}`)) n++;
        }
      return n;
    };
    let cur = cells;
    for (let round = 0; round < 2; round++) {
      // Fill holes: scan the empty neighbors of currently occupied cells
      const fill = new Set(cur);
      const candidates = new Set<string>();
      for (const c of cur) {
        const [x, y] = c.split(",").map(Number);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            candidates.add(`${x + dx},${y + dy}`);
      }
      for (const c of candidates) {
        if (fill.has(c)) continue;
        const [x, y] = c.split(",").map(Number);
        if (neigh(cur, x, y) >= 5) fill.add(c);
      }
      // Strip whiskers
      const pruned = new Set<string>();
      for (const c of fill) {
        const [x, y] = c.split(",").map(Number);
        if (neigh(fill, x, y) > 2) pruned.add(c);
      }
      cur = pruned;
    }
    return cur;
  };

  const result: Record<
    string,
    { samples: number; matches: number; outline: [number, number][] }
  > = {};
  for (const [zoneId, acc] of zones) {
    let cells = new Set<string>();
    for (const [k, n] of acc.grid) if (n >= args.min) cells.add(k);
    cells = smooth(cells);
    const comp = largestComponent(cells);
    if (comp.size < 50) continue; // too few samples, skip
    const boundary = traceBoundary(comp);
    const simplified = rdp(boundary, 1.5);
    // Grid coordinates → world coordinates (cell centers)
    const outline = simplified.map(
      ([gx, gy]) =>
        [
          Math.round((gx + 0.5) * args.cell * 10) / 10,
          Math.round((gy + 0.5) * args.cell * 10) / 10,
        ] as [number, number],
    );
    result[zoneId] = { samples: acc.samples, matches: acc.matches, outline };
    console.log(
      `zone ${zoneId}: matches=${acc.matches} samples=${acc.samples} cells=${comp.size} outline=${outline.length} pts`,
    );
  }

  await fs.writeFile(args.out, JSON.stringify(result, null, 1), "utf-8");
  console.log(`wrote ${args.out}: ${Object.keys(result).length} zones`);
}

void main();
