/**
 * positionSpanScan.ts — the distribution `KITE_DELTA_YARDS` /
 * `STAY_DELTA_YARDS` (utils/positionAnalysis.ts) are placed on, read from the
 * producer's own loop (T78; GH #141 item 3b, GH #147 item 4).
 *
 * The two thresholds were placed in 2026-08 on the distance to the NEAREST
 * enemy (p66 / p39 of the opening distribution); since FT-T12 D2 the loop
 * reads the distance to the span's MEASURED enemy, and the placement was
 * never re-measured. This script renders every owner of every round the way
 * the app does (`buildMatchContext`) with `POSITION_SPAN_PROBE.sink` set,
 * and prints, per stratum, how many burst spans pass the close-range entry
 * gate and where the two thresholds sit in them.
 *
 * Strata (Value-Gate rule 5: stratify before comparing): the owner's
 * personal rating (COMBATANT_INFO) × role (healer / dps). The pooled row is
 * printed last and is not a basis for a threshold move on its own.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/positionSpanScan.ts --manifest <m> [--every N] [--out spans.jsonl]
 */
import { ensureAnalysisData, isHealerSpec } from "@gladlog/analysis";
import { buildMatchContext } from "@gladlog/analysis/src/context/buildMatchContext";
import {
  type IPositionSpanReading,
  POSITION_SPAN_PROBE,
} from "@gladlog/analysis/src/utils/positionAnalysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";

import { roundRawStreams } from "../src/corpus/appCandidates";
import { splitTeams } from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const arg = (name: string, dflt = "") => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? dflt) : dflt;
};
const manifest = arg("--manifest");
const every = Number(arg("--every", "1"));
const outPath = arg("--out");
if (!manifest || !Number.isFinite(every) || every < 1) {
  console.error(
    "usage: positionSpanScan.ts --manifest <path> [--every N] [--out spans.jsonl]",
  );
  process.exit(1);
}
await ensureAnalysisData();

const RATING_EDGES = [1800, 2100, 2400] as const;
function ratingStratum(rating: number | undefined): string {
  if (!rating || rating <= 0) return "unrated";
  if (rating < RATING_EDGES[0]) return `<${RATING_EDGES[0]}`;
  if (rating < RATING_EDGES[1])
    return `${RATING_EDGES[0]}-${RATING_EDGES[1] - 1}`;
  if (rating < RATING_EDGES[2])
    return `${RATING_EDGES[1]}-${RATING_EDGES[2] - 1}`;
  return `>=${RATING_EDGES[2]}`;
}

interface Row extends IPositionSpanReading {
  rating: string;
  role: "healer" | "dps";
}
const rows: Row[] = [];
let rounds = 0;
let owners = 0;
let failed = 0;

const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    failed++;
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const { friends, enemies } = splitTeams(legacy);
    for (const owner of friends) {
      owners++;
      const tag = {
        rating: ratingStratum(owner.info?.personalRating),
        role: isHealerSpec(owner.spec) ? ("healer" as const) : ("dps" as const),
      };
      POSITION_SPAN_PROBE.sink = (r) => rows.push({ ...r, ...tag });
      try {
        buildMatchContext(legacy, friends, enemies, {
          owner,
          rawStreams: roundRawStreams(legacy, null),
        });
      } catch {
        failed++;
      } finally {
        POSITION_SPAN_PROBE.sink = undefined;
      }
    }
  }
}

if (outPath)
  writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const quantile = (sorted: number[], q: number) =>
  sorted.length === 0
    ? Number.NaN
    : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const pct = (n: number, d: number) =>
  d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`;

function describe(label: string, rs: Row[]): string {
  const opened = rs.map((r) => r.openedYards).sort((a, b) => a - b);
  const delta = rs.map((r) => r.deltaYards).sort((a, b) => a - b);
  const kited = rs.filter((r) => r.openedYards >= 10).length;
  const stayed = rs.filter(
    (r) => r.openedYards < 10 && r.deltaYards < 5,
  ).length;
  const q = (xs: number[]) =>
    [0.25, 0.39, 0.5, 0.66, 0.75, 0.9]
      .map((p) => quantile(xs, p).toFixed(1))
      .join(" / ");
  return [
    `${label}: n=${rs.length}`,
    `opened>=10 ${pct(kited, rs.length)}`,
    `else delta<5 ${pct(stayed, rs.length)}`,
    `between ${pct(rs.length - kited - stayed, rs.length)}`,
    `opened<10 is p${pct(opened.filter((x) => x < 10).length, rs.length)}`,
    `delta<5 is p${pct(delta.filter((x) => x < 5).length, rs.length)}`,
    `opened p25/p39/p50/p66/p75/p90 ${q(opened)}`,
    `delta p25/p39/p50/p66/p75/p90 ${q(delta)}`,
    `measured enemy ${pct(rs.filter((r) => r.measuredEnemy).length, rs.length)}`,
  ].join(" | ");
}

console.log(
  `files ${files.length}, rounds ${rounds}, owner renders ${owners}, failed ${failed}, spans past the close-range gate ${rows.length}`,
);
const strata = ["<1800", "1800-2099", "2100-2399", ">=2400", "unrated"];
for (const role of ["healer", "dps"] as const)
  for (const s of strata) {
    const rs = rows.filter((r) => r.role === role && r.rating === s);
    if (rs.length) console.log(describe(`${role} ${s}`, rs));
  }
for (const role of ["healer", "dps"] as const)
  console.log(
    describe(
      `${role} pooled`,
      rows.filter((r) => r.role === role),
    ),
  );
console.log(describe("all pooled (not a basis for a move)", rows));
