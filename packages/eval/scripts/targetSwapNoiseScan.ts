/**
 * GH #85 — corrected target-swap incidence, with the sign bug shown side by side.
 *
 * Why this exists: the swap rates posted on GH #85 (library 3.35/min DPS,
 * archive 3.43/min) were measured by `coachCorpusWeekendProbe2.ts` §I and
 * `coachCorpusArchiveProbe.ts` §I with `effectiveAmount <= 0` as the "skip"
 * filter. In the legacy shape (parser-compat convert.ts) real damage is
 * NEGATIVE and SPELL_ABSORBED rows are POSITIVE, so the filter kept absorbs and
 * dropped damage — codex (gpt-6-astra, 2026-09-12 design debate) caught it:
 * 5,497 of 5,675 retained rows on 10 rounds were absorbs. Both probes are
 * fixed; this script re-measures the number those issue comments cited and
 * reports the event-type composition so the mistake cannot recur silently.
 *
 * It is a MEASUREMENT, not a predicate: "observed transition incidence at 3 s
 * granularity" mixes genuine switches with cleave / DoT / pet artifacts and is
 * not an identified noise floor (codex, same debate). Numbers here bound a
 * future estimator; they do not validate one.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/targetSwapNoiseScan.ts [--n 400] [--json]          # local library
 *   npx tsx packages/eval/scripts/targetSwapNoiseScan.ts --manifest <file> [--every N] [--limit N] [--json]
 *                                                        # archive: both teams per round are perspectives
 *
 * Columns: `buggy` = the old filter reproduced verbatim; `all` = every real
 * damage row (direct + periodic, pets already merged into the owner by
 * convert.ts mergePetEvents); `direct` = all minus SPELL_PERIODIC_DAMAGE.
 * Persistence k = a bucket's dominant target must hold for k consecutive
 * non-empty buckets on both sides to count as a swap (k=1 is the raw count).
 */
import { ensureAnalysisData, isHealerSpec } from "@gladlog/analysis";
import { GladLogParser } from "@gladlog/parser";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const BUCKET_MS = 3000;
type Filter = "buggy" | "all" | "direct";
const FILTERS: Filter[] = ["buggy", "all", "direct"];
const PERSIST = [1, 2, 3];

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function keep(
  d: ICombatUnit["damageOut"][number],
  filter: Filter,
): { ok: boolean; amount: number } {
  const ev = d.logLine.event as string;
  if (filter === "buggy") {
    return { ok: d.effectiveAmount > 0, amount: d.effectiveAmount };
  }
  if (ev === "SPELL_ABSORBED" || d.effectiveAmount >= 0) {
    return { ok: false, amount: 0 };
  }
  if (filter === "direct" && ev === "SPELL_PERIODIC_DAMAGE") {
    return { ok: false, amount: 0 };
  }
  return { ok: true, amount: -d.effectiveAmount };
}

/** Dominant enemy per non-empty bucket, in bucket order. */
function dominantSeq(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  startMs: number,
  filter: Filter,
  eventCounts: Map<string, number>,
): string[] {
  const byBucket = new Map<number, Map<string, number>>();
  for (const d of unit.damageOut) {
    if (!enemyIds.has(d.destUnitId)) continue;
    const k = keep(d, filter);
    if (!k.ok) continue;
    const ev = d.logLine.event as string;
    eventCounts.set(ev, (eventCounts.get(ev) ?? 0) + 1);
    const b = Math.floor((d.logLine.timestamp - startMs) / BUCKET_MS);
    const m = byBucket.get(b) ?? new Map<string, number>();
    m.set(d.destUnitId, (m.get(d.destUnitId) ?? 0) + k.amount);
    byBucket.set(b, m);
  }
  return [...byBucket.keys()]
    .sort((x, y) => x - y)
    .map((b) => {
      const m = byBucket.get(b)!;
      return [...m.entries()].sort((x, y) => y[1] - x[1])[0]![0];
    });
}

/** Swaps with persistence k: run-length encode, count run boundaries where
 * both adjacent runs have length ≥ k. */
function swapsWithPersistence(seq: string[], k: number): number {
  const runs: Array<{ t: string; n: number }> = [];
  for (const t of seq) {
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.n++;
    else runs.push({ t, n: 1 });
  }
  let swaps = 0;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i - 1]!.n >= k && runs[i]!.n >= k) swaps++;
  }
  return swaps;
}

/** One (perspective team, enemy team) pair to score. */
interface Side {
  friends: ICombatUnit[];
  enemyIds: Set<string>;
  startMs: number;
  durMin: number;
}

/** Local library rounds: the logging player's team is `friends`, once per round. */
function* librarySides(limit: number): Generator<Side> {
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);
  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies } = splitTeams(legacy);
    yield {
      friends,
      enemyIds: new Set(enemies.map((e) => e.id)),
      startMs: legacy.startTime,
      durMin: Math.max((legacy.endTime - legacy.startTime) / 60000, 0.5),
    };
  }
}

/** Archive files (same loader as coachCorpusArchiveProbe.ts): every round,
 * BOTH teams taken as the perspective team in turn — the archive has full data
 * for both sides. Enemy ids = the other team's PLAYERS (pets are not targets). */
function* archiveSides(
  manifestPath: string,
  every: number,
  limit: number,
  shard: { k: number; n: number } | null,
  progress: (files: number) => void,
): Generator<Side> {
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  // `--shard k/n`: file i goes to shard i % n. One process parses ~1.5 files/s
  // (the full 63k-file archive is ~12 h single-threaded), so a handful of
  // shards run side by side and the JSON outputs are merged by weighting
  // `swaps` and `minutes` (both totals are in the table rows for that reason).
  if (shard) files = files.filter((_, i) => i % shard.n === shard.k);
  if (every > 1) files = files.filter((_, i) => i % every === 0);
  if (limit) files = files.slice(0, limit);
  let n = 0;
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    n++;
    if (n % 500 === 0) progress(n);
    for (const legacy of combats) {
      const units: ICombatUnit[] = Object.values(legacy.units ?? {});
      const players = units.filter((u) => u.info);
      const byTeam = new Map<string, ICombatUnit[]>();
      for (const p of players) {
        const tid = String(p.info?.teamId ?? "?");
        byTeam.set(tid, [...(byTeam.get(tid) ?? []), p]);
      }
      if (byTeam.size !== 2) continue;
      const durMin = Math.max((legacy.endTime - legacy.startTime) / 60000, 0.5);
      if (durMin < 1) continue; // same ≥ 60 s floor as the library path
      for (const [tid, team] of byTeam) {
        const other = [...byTeam.entries()].find(([k]) => k !== tid)![1];
        yield {
          friends: team,
          enemyIds: new Set(other.map((o) => o.id)),
          startMs: legacy.startTime,
          durMin,
        };
      }
    }
  }
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const limit = argOf("--n", 400);
  const manifest = process.argv.includes("--manifest")
    ? process.argv[process.argv.indexOf("--manifest") + 1]
    : undefined;
  const every = argOf("--every", 1);
  const fileLimit = argOf("--limit", 0);
  const shardArg = process.argv.includes("--shard")
    ? process.argv[process.argv.indexOf("--shard") + 1]
    : undefined;
  const shard = shardArg
    ? (() => {
        const [k, n] = shardArg.split("/").map(Number);
        if (
          !Number.isInteger(k) ||
          !Number.isInteger(n) ||
          n < 1 ||
          k < 0 ||
          k >= n
        )
          throw new Error(
            `--shard must be k/n with 0 ≤ k < n, got ${shardArg}`,
          );
        return { k: k!, n: n! };
      })()
    : null;
  type Acc = { players: number; minutes: number; swaps: number[] };
  const acc = new Map<string, Acc>(); // key = filter|role|k
  const events = new Map<Filter, Map<string, number>>(
    FILTERS.map((f) => [f, new Map()]),
  );
  let rounds = 0;
  const sides = manifest
    ? archiveSides(manifest, every, fileLimit, shard, (n) =>
        console.error(`… ${n} files`),
      )
    : librarySides(limit);
  for (const side of sides) {
    const { friends, enemyIds, startMs, durMin } = side;
    rounds++;
    for (const f of friends) {
      const role = isHealerSpec(f.spec) ? "healer" : "dps";
      for (const filter of FILTERS) {
        const seq = dominantSeq(
          f,
          enemyIds,
          startMs,
          filter,
          events.get(filter)!,
        );
        for (const k of PERSIST) {
          const key = `${filter}|${role}|${k}`;
          const a = acc.get(key) ?? { players: 0, minutes: 0, swaps: [] };
          a.players++;
          a.minutes += durMin;
          a.swaps.push(swapsWithPersistence(seq, k));
          acc.set(key, a);
        }
      }
    }
  }
  const table = [...acc.entries()].map(([key, a]) => {
    const [filter, role, k] = key.split("|");
    const total = a.swaps.reduce((s, x) => s + x, 0);
    return {
      filter,
      role,
      persistence: Number(k),
      playerRounds: a.players,
      swaps: total,
      minutes: a.minutes,
      swapsPerMin: total / a.minutes,
    };
  });
  const composition = Object.fromEntries(
    FILTERS.map((f) => [f, Object.fromEntries(events.get(f)!)]),
  );
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rounds, table, composition }, null, 1));
    return;
  }
  console.log(`rounds ${rounds}\n`);
  console.log("event rows retained per filter:");
  for (const f of FILTERS) console.log(`  ${f.padEnd(7)}`, composition[f]);
  console.log("\nswaps per minute (3 s buckets):");
  console.log(
    `${"filter".padEnd(8)}${"role".padEnd(8)}${"k".padEnd(4)}${"player-rounds".padStart(14)}${"swaps/min".padStart(11)}`,
  );
  for (const r of table.sort(
    (a, b) =>
      FILTERS.indexOf(a.filter as Filter) -
        FILTERS.indexOf(b.filter as Filter) ||
      a.role.localeCompare(b.role) ||
      a.persistence - b.persistence,
  )) {
    console.log(
      `${r.filter.padEnd(8)}${r.role.padEnd(8)}${String(r.persistence).padEnd(4)}${String(r.playerRounds).padStart(14)}${r.swapsPerMin.toFixed(2).padStart(11)}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
) {
  void main();
}
