/**
 * Direction-1 follow-up to facingObservabilityScan (GH #100): calibrate what
 * the advanced-log facing field IS, on the same pilot sample. Diagnostic only —
 * no product facing predicate, no tactical/facing-target verdict.
 *
 *  A. actor-neither records: is the advanced block really the actor's own
 *     state (distance to the actor's own previous sample vs the destination's)?
 *  B. same-ms groups whose facing/position differ: does the LATER log line
 *     agree with the actor's NEXT sample (log order = time order) or not?
 *  C. angle convention from two independent sources: movement heading while
 *     running with a steady facing, and melee-swing bearing to the target
 *     (a melee swing requires the target in the attacker's front arc).
 *  D. sampling coverage per player-round, time-weighted.
 *
 * Usage: npx tsx packages/eval/scripts/facingCalibrationScan.ts <pilot.json> <new-output.json>
 * File contents must still match the pilot hashes. Output contains no names/GUIDs.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { parseLine } from "@gladlog/parser";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("expected pilot.json and new-output.json");
const pilot = JSON.parse(readFileSync(input, "utf8")) as {
  manifestSha256: string;
  files: Array<{ path: string; sha256: string }>;
};

const TAU = 2 * Math.PI;
const wrap = (a: number) => {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};
// Candidate conventions: the angle a displacement (dx,dy) in LOGGED x/y would
// have if facing were measured that way. All eight axis/sign choices compete;
// nothing is presumed.
const CONVENTIONS: Record<string, (dx: number, dy: number) => number> = {
  "atan2(dy,dx)": (dx, dy) => Math.atan2(dy, dx),
  "atan2(-dy,dx)": (dx, dy) => Math.atan2(-dy, dx),
  "atan2(dy,-dx)": (dx, dy) => Math.atan2(dy, -dx),
  "atan2(-dy,-dx)": (dx, dy) => Math.atan2(-dy, -dx),
  "atan2(dx,dy)": (dx, dy) => Math.atan2(dx, dy),
  "atan2(-dx,dy)": (dx, dy) => Math.atan2(-dx, dy),
  "atan2(dx,-dy)": (dx, dy) => Math.atan2(dx, -dy),
  "atan2(-dx,-dy)": (dx, dy) => Math.atan2(-dx, -dy),
};
type ConvStats = Record<
  string,
  { n: number; within30: number; within90: number; sumCos: number }
>;
const newConvStats = (): ConvStats =>
  Object.fromEntries(
    Object.keys(CONVENTIONS).map((k) => [
      k,
      { n: 0, within30: 0, within90: 0, sumCos: 0 },
    ]),
  );
const addConv = (s: ConvStats, dx: number, dy: number, facing: number) => {
  for (const [k, f] of Object.entries(CONVENTIONS)) {
    const d = Math.abs(wrap(facing - f(dx, dy)));
    s[k].n++;
    if (d <= Math.PI / 6) s[k].within30++;
    if (d <= Math.PI / 2) s[k].within90++;
    s[k].sumCos += Math.cos(d);
  }
};
const moveStats = newConvStats();
const swingStats = newConvStats();

type Row = {
  t: number;
  x: number;
  y: number;
  facing: number;
  line: number;
};
const neither = {
  records: 0,
  bySpell: {} as Record<string, number>,
  srcIsNull: 0,
  actorInRoster: 0,
  actorAndDestSameTeam: 0,
  // vs the most recent sample where the unit was itself src or dest
  within1_5ydOfActorsOwnPrev: 0,
  within1_5ydOfDestsPrev: 0,
  maxDistToActorsOwnPrevYd: 0,
};
const sameMs = {
  differingGroups: 0,
  facingOnly: 0,
  positionOnly: 0,
  both: 0,
  // of groups with a next sample within 100 ms:
  withNextWithin100ms: 0,
  lastLineCloserToNext: 0,
  firstLineCloserToNext: 0,
  tie: 0,
};
type Coverage = {
  durS: number;
  cov1_5: number;
  cov3: number;
  longestGapS: number;
};
const coverage: Record<"closedByEnd" | "closedByNextStart", Coverage[]> = {
  closedByEnd: [],
  closedByNextStart: [],
};
const segments = {
  closedByEnd: 0,
  closedByNextStart: 0,
  skippedNoDeathBeforeNextStart: 0,
  skippedTrailingStart: 0,
  rosterPlayersWithUnder2Samples: 0,
};

const skippedFiles: Array<{ path: string; reason: string }> = [];
let sampledFiles = 0;

for (const file of pilot.files) {
  let raw: string;
  try {
    const buf = readFileSync(file.path);
    raw = (file.path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
    if (createHash("sha256").update(raw).digest("hex") !== file.sha256) {
      process.stderr.write(
        `[warn] pilot content hash mismatch: ${file.path}, skipping\n`,
      );
      skippedFiles.push({ path: file.path, reason: "sha256_mismatch" });
      continue;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[warn] failed to read ${file.path}: ${reason}, skipping\n`,
    );
    skippedFiles.push({ path: file.path, reason });
    continue;
  }
  sampledFiles++;
  const parsed = raw.split(/\r?\n/).map((l) => parseLine(l));

  // Segments: START→END, or START→next START (Solo Shuffle logs one END per
  // lobby). Not independently validated round segmentation.
  const segs: Array<{ s: number; e: number; kind: keyof typeof coverage }> = [];
  let start = -1;
  parsed.forEach((p, i) => {
    if (p?.eventName === "ARENA_MATCH_START") {
      if (start >= 0)
        segs.push({ s: start, e: i - 1, kind: "closedByNextStart" });
      start = i;
    } else if (p?.eventName === "ARENA_MATCH_END" && start >= 0) {
      segs.push({ s: start, e: i, kind: "closedByEnd" });
      start = -1;
    }
  });
  if (start >= 0) segments.skippedTrailingStart++;

  for (const { s, e, kind } of segs) {
    const roster = new Map<string, string>(); // guid → team field
    const died = new Map<string, number>();
    const rows = new Map<string, Row[]>();
    const lastOwn = new Map<string, Row>(); // last sample where unit was src/dest
    const swingSrc = new Map<string, Row>();
    const swingDest = new Map<string, Row>();
    for (let i = s; i <= e; i++) {
      const p = parsed[i];
      if (!p) continue;
      if (p.eventName === "COMBATANT_INFO")
        roster.set(p.params[0], p.params[1]);
      if (
        p.eventName === "UNIT_DIED" &&
        p.base &&
        !p.unitDied?.unconscious &&
        !died.has(p.base.destGuid)
      )
        died.set(p.base.destGuid, p.timestamp);
      const a = p.advanced;
      if (
        !a ||
        !a.actorGuid.startsWith("Player-") ||
        ![a.x, a.y, a.facing].every(Number.isFinite)
      )
        continue;
      const row: Row = {
        t: p.timestamp,
        x: a.x,
        y: a.y,
        facing: a.facing,
        line: i,
      };
      const src = p.base?.srcGuid;
      const dest = p.base?.destGuid;
      if (a.actorGuid !== src && a.actorGuid !== dest) {
        // ---- A
        neither.records++;
        const spell = `${p.eventName}:${p.params[8] ?? "?"}`;
        neither.bySpell[spell] = (neither.bySpell[spell] ?? 0) + 1;
        if (src === "0000000000000000") neither.srcIsNull++;
        if (roster.has(a.actorGuid)) neither.actorInRoster++;
        if (
          roster.has(a.actorGuid) &&
          roster.get(a.actorGuid) === roster.get(dest ?? "")
        )
          neither.actorAndDestSameTeam++;
        const own = lastOwn.get(a.actorGuid);
        const other = lastOwn.get(dest ?? "");
        if (own) {
          const d = Math.hypot(own.x - a.x, own.y - a.y);
          if (d <= 1.5) neither.within1_5ydOfActorsOwnPrev++;
          neither.maxDistToActorsOwnPrevYd = Math.max(
            neither.maxDistToActorsOwnPrevYd,
            d,
          );
        }
        if (other && Math.hypot(other.x - a.x, other.y - a.y) <= 1.5)
          neither.within1_5ydOfDestsPrev++;
      } else {
        lastOwn.set(a.actorGuid, row);
      }
      const list = rows.get(a.actorGuid) ?? [];
      list.push(row);
      rows.set(a.actorGuid, list);

      const key = `${p.timestamp}|${src}|${dest}`;
      if (
        p.eventName === "SWING_DAMAGE" &&
        a.actorGuid === src &&
        dest?.startsWith("Player-")
      )
        swingSrc.set(key, row);
      if (
        p.eventName === "SWING_DAMAGE_LANDED" &&
        a.actorGuid === dest &&
        src?.startsWith("Player-")
      )
        swingDest.set(key, row);
    }

    // ---- C2: attacker facing vs bearing to the target, same-ms pair
    for (const [k, attacker] of swingSrc) {
      const target = swingDest.get(k);
      if (!target) continue;
      const dx = target.x - attacker.x;
      const dy = target.y - attacker.y;
      if (Math.hypot(dx, dy) < 1) continue; // stacked: bearing undefined
      addConv(swingStats, dx, dy, attacker.facing);
    }

    // Segment end for coverage.
    const t0 = parsed[s]!.timestamp;
    let tEnd: number;
    if (kind === "closedByEnd") tEnd = parsed[e]!.timestamp;
    else {
      // A shuffle round ends at its first roster death.
      const deaths = [...died].filter(([g]) => roster.has(g)).map(([, t]) => t);
      if (!deaths.length) {
        segments.skippedNoDeathBeforeNextStart++;
        tEnd = NaN;
      } else tEnd = Math.min(...deaths);
    }
    if (Number.isFinite(tEnd)) segments[kind]++;

    for (const [guid, list] of rows) {
      list.sort((a, b) => a.t - b.t || a.line - b.line);
      // ---- B
      for (let i = 0; i < list.length;) {
        let j = i;
        while (j < list.length && list[j].t === list[i].t) j++;
        const first = list[i];
        const last = list[j - 1];
        const group = list.slice(i, j);
        const fDiff = group.some((r) => r.facing !== first.facing);
        const pDiff = group.some((r) => r.x !== first.x || r.y !== first.y);
        if (fDiff || pDiff) {
          sameMs.differingGroups++;
          if (fDiff && pDiff) sameMs.both++;
          else if (fDiff) sameMs.facingOnly++;
          else sameMs.positionOnly++;
          const next = list[j];
          if (next && next.t - first.t <= 100) {
            sameMs.withNextWithin100ms++;
            const cost = (r: Row) =>
              Math.hypot(r.x - next.x, r.y - next.y) +
              Math.abs(wrap(r.facing - next.facing));
            const cl = cost(last);
            const cf = cost(first);
            if (cl < cf) sameMs.lastLineCloserToNext++;
            else if (cf < cl) sameMs.firstLineCloserToNext++;
            else sameMs.tie++;
          }
        }
        i = j;
      }
      // ---- C1: running with a steady facing
      const uniq = list.filter((r, i) => i === 0 || r.t !== list[i - 1].t);
      for (let i = 1; i < uniq.length; i++) {
        const a = uniq[i - 1];
        const b = uniq[i];
        const dt = (b.t - a.t) / 1000;
        if (dt <= 0 || dt > 0.5) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const speed = dist / dt;
        // Diagnostic subset: ≥1.5 yd displacement at a plausible run speed
        // (5–12 yd/s) with facing steady across the pair. Players also
        // strafe and backpedal, so agreement is expected to be partial.
        if (dist < 1.5 || speed < 5 || speed > 12) continue;
        if (Math.abs(wrap(a.facing - b.facing)) > 0.1) continue;
        addConv(moveStats, dx, dy, b.facing);
      }
      // ---- D
      if (!roster.has(guid) || !Number.isFinite(tEnd)) continue;
      const end = Math.min(tEnd, died.get(guid) ?? Infinity);
      const ts = uniq.map((r) => r.t).filter((t) => t >= t0 && t <= end);
      if (ts.length < 2) {
        segments.rosterPlayersWithUnder2Samples++;
        continue;
      }
      // From the player's first sample (prep time is not combat) to their
      // death or the segment end.
      const span = end - ts[0];
      if (span <= 0) continue;
      let c15 = 0;
      let c3 = 0;
      let longest = 0;
      const points = [...ts, end];
      for (let i = 1; i < points.length; i++) {
        const g = points[i] - points[i - 1];
        if (g <= 1500) c15 += g;
        if (g <= 3000) c3 += g;
        longest = Math.max(longest, g);
      }
      coverage[kind].push({
        durS: span / 1000,
        cov1_5: c15 / span,
        cov3: c3 / span,
        longestGapS: longest / 1000,
      });
    }
    if (Number.isFinite(tEnd))
      for (const g of roster.keys())
        if (!rows.has(g)) segments.rosterPlayersWithUnder2Samples++;
  }
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) * q)] : null;
};
const round4 = (x: number) => +x.toFixed(4);
const finishConv = (s: ConvStats) =>
  Object.fromEntries(
    Object.entries(s).map(([k, v]) => [
      k,
      {
        n: v.n,
        within30: round4(v.within30 / v.n),
        within90: round4(v.within90 / v.n),
        meanCos: round4(v.sumCos / v.n),
      },
    ]),
  );
const finishCoverage = (cs: Coverage[]) => {
  const total = cs.reduce((a, c) => a + c.durS, 0);
  const col = (k: keyof Coverage) => cs.map((c) => c[k]);
  return {
    playerRounds: cs.length,
    totalPlayerSeconds: Math.round(total),
    timeWeightedCov1_5: round4(
      cs.reduce((a, c) => a + c.cov1_5 * c.durS, 0) / total,
    ),
    timeWeightedCov3: round4(
      cs.reduce((a, c) => a + c.cov3 * c.durS, 0) / total,
    ),
    perPlayerRoundCov1_5: {
      min: quantile(col("cov1_5"), 0),
      p10: quantile(col("cov1_5"), 0.1),
      p50: quantile(col("cov1_5"), 0.5),
    },
    perPlayerRoundCov3: {
      min: quantile(col("cov3"), 0),
      p10: quantile(col("cov3"), 0.1),
      p50: quantile(col("cov3"), 0.5),
    },
    longestGapS: {
      p50: quantile(col("longestGapS"), 0.5),
      p90: quantile(col("longestGapS"), 0.9),
      max: quantile(col("longestGapS"), 1),
    },
  };
};
const result = {
  manifestSha256: pilot.manifestSha256,
  sampledFiles,
  ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
  scope:
    "Player actors only, same pilot sample. Exploration sample: establishes convention and mechanism, does not estimate season rates. Coverage = share of a roster player's first-sample→death/segment-end span lying in sample gaps ≤1.5 s / ≤3 s; stealth, LoS and idle time are not separated out.",
  segments,
  actorNeither: neither,
  sameMs,
  movementHeading: finishConv(moveStats),
  meleeSwingBearing: finishConv(swingStats),
  coverage: {
    closedByEnd: finishCoverage(coverage.closedByEnd),
    closedByNextStart: finishCoverage(coverage.closedByNextStart),
  },
};
writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
