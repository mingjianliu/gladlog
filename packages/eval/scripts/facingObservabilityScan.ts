/**
 * Follow-up to logObservabilityPilot: Player-actor facing attribution and
 * sampling. No angle-unit claim and no tactical/facing-target verdict.
 * Usage: npx tsx packages/eval/scripts/facingObservabilityScan.ts <pilot.json> <new-output.json>
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
type Sample = { x: number; y: number; facing: number };
const actors = new Map<string, Map<number, Sample[]>>();
const totals = {
  records: 0,
  actorIsSrc: 0,
  actorIsDest: 0,
  actorNeither: 0,
  minFacing: Infinity,
  maxFacing: -Infinity,
  outsideZeroTau: 0,
  actorTimeGroups: 0,
  multiRecordGroups: 0,
  differingFacingGroups: 0,
  differingPositionGroups: 0,
  stationaryPairs: 0,
  stationaryFacingChanged: 0,
};
const byEvent: Record<string, number> = {};
const neitherByEvent: Record<string, number> = {};
const gaps: number[] = [];
const facingSpreads: number[] = [];
function flush() {
  for (const times of actors.values()) {
    const ordered = [...times].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < ordered.length; i++) {
      const [t, rows] = ordered[i];
      const first = rows[0];
      totals.actorTimeGroups++;
      if (rows.length > 1) totals.multiRecordGroups++;
      if (rows.some((r) => r.facing !== first.facing)) {
        totals.differingFacingGroups++;
        // Numeric spread only: do not presume radians/wrap semantics.
        facingSpreads.push(
          Math.max(...rows.map((r) => r.facing)) -
            Math.min(...rows.map((r) => r.facing)),
        );
      }
      if (rows.some((r) => r.x !== first.x || r.y !== first.y))
        totals.differingPositionGroups++;
      if (i > 0) {
        const [previousT, previousRows] = ordered[i - 1];
        const previous = previousRows[0];
        gaps.push((t - previousT) / 1000);
        // Diagnostic subset, not a production sampling rule. Exclude ambiguous groups.
        const consistent = (rs: Sample[]) =>
          rs.every(
            (r) =>
              r.x === rs[0].x && r.y === rs[0].y && r.facing === rs[0].facing,
          );
        if (
          t - previousT <= 1500 &&
          consistent(rows) &&
          consistent(previousRows) &&
          previous.x === first.x &&
          previous.y === first.y
        ) {
          totals.stationaryPairs++;
          if (previous.facing !== first.facing)
            totals.stationaryFacingChanged++;
        }
      }
    }
  }
  actors.clear();
}
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
  for (const row of raw.split(/\r?\n/)) {
    const p = parseLine(row);
    if (!p) continue;
    // Never create a sampling-gap pair across an observed round boundary.
    if (
      p.eventName === "ARENA_MATCH_START" ||
      p.eventName === "ARENA_MATCH_END"
    ) {
      flush();
      continue;
    }
    const a = p.advanced;
    if (
      !a ||
      !a.actorGuid.startsWith("Player-") ||
      ![a.x, a.y, a.facing].every(Number.isFinite)
    )
      continue;
    totals.records++;
    totals.minFacing = Math.min(totals.minFacing, a.facing);
    totals.maxFacing = Math.max(totals.maxFacing, a.facing);
    if (a.facing < 0 || a.facing > 2 * Math.PI) totals.outsideZeroTau++;
    // When source and destination are identical, source gets precedence.
    if (a.actorGuid === p.base?.srcGuid) totals.actorIsSrc++;
    else if (a.actorGuid === p.base?.destGuid) totals.actorIsDest++;
    else {
      totals.actorNeither++;
      neitherByEvent[p.eventName] = (neitherByEvent[p.eventName] ?? 0) + 1;
    }
    byEvent[p.eventName] = (byEvent[p.eventName] ?? 0) + 1;
    let times = actors.get(a.actorGuid);
    if (!times) actors.set(a.actorGuid, (times = new Map()));
    const rows = times.get(p.timestamp) ?? [];
    rows.push({ x: a.x, y: a.y, facing: a.facing });
    times.set(p.timestamp, rows);
  }
  flush();
}
gaps.sort((a, b) => a - b);
facingSpreads.sort((a, b) => a - b);
const quantile = (xs: number[], q: number) =>
  xs.length ? xs[Math.floor((xs.length - 1) * q)] : null;
const result = {
  manifestSha256: pilot.manifestSha256,
  sampledFiles,
  ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
  scope:
    "Player actors only; reset at observed start/end and file boundaries; not independently validated round segmentation. Exact same-ms differences need interpretation, not automatic error classification. Gaps are sample-pair weighted, not time or player weighted.",
  totals,
  byEvent,
  neitherByEvent,
  facingSpreads: {
    n: facingSpreads.length,
    p50: quantile(facingSpreads, 0.5),
    max: facingSpreads.at(-1) ?? null,
  },
  gaps: {
    n: gaps.length,
    p50: quantile(gaps, 0.5),
    p90: quantile(gaps, 0.9),
    p99: quantile(gaps, 0.99),
    over1_5: gaps.filter((x) => x > 1.5).length,
    over3: gaps.filter((x) => x > 3).length,
    max: gaps.at(-1) ?? null,
  },
};
writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
