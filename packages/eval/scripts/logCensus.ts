 
/**
 * logCensus.ts — full-manifest census of the combat-log archive (GH #100,
 * the audit's last step; user go-ahead 2026-09-23).
 *
 * Why it exists: every earlier #100 number came from a slice (24-file pilot,
 * 600 / 2,110-file probes), which can establish that something exists but not
 * how common it is, and can miss what only a few specs / maps / recorders
 * produce. This counts the whole manifest, programmatically, with explicit
 * denominators — files, rounds, unique rounds (the same lobby recorded by
 * several players collapses to one) — and explicit failure counts. No model
 * calls, one file in memory at a time.
 *
 * Two steps:
 *   scan    appends one JSON row per file to --out; RESUMABLE — files already
 *           in --out are skipped, so an interrupted run just continues.
 *   report  aggregates a rows file into markdown.
 *
 * Usage:
 *   nice -n 10 npx tsx packages/eval/scripts/logCensus.ts scan \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt \
 *     --out $GLADLOG_EVAL_HOME/reports/log-census-<date>/rows.jsonl [--offset N] [--limit N]
 *   npx tsx packages/eval/scripts/logCensus.ts report --in <rows.jsonl> > report.md
 *
 * Rows carry file paths and GUID-derived dedupe keys: keep them in
 * GLADLOG_EVAL_HOME, never in git.
 */
import { specToString } from "@gladlog/analysis/src/utils/cooldowns";
import {
  checkParserInvariants,
  GladLogParser,
  type GladMatchBase,
  parseLine,
} from "@gladlog/parser";
import type { CombatUnitSpec } from "@gladlog/parser-compat";
import { createHash } from "crypto";
import { appendFileSync, existsSync, readFileSync } from "fs";
import { gunzipSync } from "zlib";

interface RoundRow {
  bracket: string;
  zoneId: string;
  kind: string;
  seq: number;
  week: string;
  adv: boolean;
  ownerSpec: number;
  players: number;
  /** players with at least one advanced sample */
  advPlayers: number;
  durationS: number;
  /** same lobby from any recorder → same key */
  key: string;
  inv: Record<string, number>;
}

interface FileRow {
  file: string;
  bytes: number;
  lines: number;
  /** lines the parser dropped (parseLine returned null) */
  failed: number;
  events: Record<string, number>;
  /** events parseLine returned with known === false */
  unknown: Record<string, number>;
  rounds: RoundRow[];
  segmentsDropped: number;
  error?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isoWeek(ms: number): string {
  const d = new Date(ms);
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

function roundRow(m: GladMatchBase, kind: string, seq: number): RoundRow {
  const units = Object.values(m.units);
  const players = units.filter((u) => u.kind === "Player");
  const inv: Record<string, number> = {};
  for (const v of checkParserInvariants(m))
    inv[v.code] = (inv[v.code] ?? 0) + 1;
  const guids = players
    .map((p) => p.id)
    .sort()
    .join(",");
  return {
    bracket: m.bracket,
    zoneId: m.zoneId,
    kind,
    seq,
    week: isoWeek(m.startTime),
    adv: m.hasAdvancedLogging,
    ownerSpec: m.units[m.playerId]?.specId ?? 0,
    players: players.length,
    advPlayers: players.filter((p) => p.advancedSamples.length > 0).length,
    durationS: Math.round((m.endTime - m.startTime) / 1000),
    key: createHash("sha1")
      .update(
        `${m.bracket}|${m.zoneId}|${seq}|${guids}|${Math.floor(m.startTime / 60000)}`,
      )
      .digest("hex")
      .slice(0, 16),
    inv,
  };
}

const KNOWN = new Map<string, boolean>();

function scanFile(path: string): FileRow {
  const row: FileRow = {
    file: path,
    bytes: 0,
    lines: 0,
    failed: 0,
    events: {},
    unknown: {},
    rounds: [],
    segmentsDropped: 0,
  };
  let text: string;
  try {
    const raw = readFileSync(path);
    row.bytes = raw.length;
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch (e) {
    row.error = `read: ${(e as Error).message}`;
    return row;
  }
  const parser = new GladLogParser();
  parser.on("match", (m) => row.rounds.push(roundRow(m, "match", 0)));
  parser.on("shuffle", (s) => {
    for (const r of s.rounds)
      row.rounds.push(roundRow(r, "shuffleRound", r.sequenceNumber));
  });
  try {
    for (let line of text.split("\n")) {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim().length === 0) continue;
      row.lines++;
      // Event name straight off the line: parseLine's `known` is a function
      // of the event name alone (every branch keys on it), so it is resolved
      // once per name and cached — parsing every line twice doubled the
      // runtime (0.55 s/file ≈ 10 h for the manifest).
      const sep = line.indexOf("  ");
      const comma = sep < 0 ? -1 : line.indexOf(",", sep + 2);
      if (comma > 0) {
        const name = line.slice(sep + 2, comma);
        row.events[name] = (row.events[name] ?? 0) + 1;
        let known = KNOWN.get(name);
        if (known === undefined) {
          const p = parseLine(line);
          if (p !== null) {
            known = p.known;
            KNOWN.set(name, known);
          }
        }
        if (known === false) row.unknown[name] = (row.unknown[name] ?? 0) + 1;
      }
      parser.push(line);
    }
    parser.end();
    row.segmentsDropped = parser.stats().segmentsDropped;
    row.failed = parser.stats().linesDropped;
  } catch (e) {
    row.error = `parse: ${(e as Error).message}`;
  }
  return row;
}

function scan(): void {
  const manifest = arg("--manifest");
  const out = arg("--out");
  if (!manifest || !out) {
    console.error(
      "usage: logCensus.ts scan --manifest <file> --out <rows.jsonl> [--offset N] [--limit N]",
    );
    process.exit(1);
  }
  let files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const offset = Number(arg("--offset") ?? 0);
  const limit = Number(arg("--limit") ?? 0);
  files = files.slice(offset, limit ? offset + limit : undefined);
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n"))
      if (l) done.add((JSON.parse(l) as FileRow).file);
  const t0 = Date.now();
  let n = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    appendFileSync(out, JSON.stringify(scanFile(f)) + "\n");
    n++;
    if (n % 500 === 0)
      console.error(
        `${n} new (${done.size + n}/${files.length}) | ${Math.round((Date.now() - t0) / 1000)}s`,
      );
  }
  console.error(
    `done: ${n} new, ${done.size} resumed, ${files.length} in slice, ${Math.round((Date.now() - t0) / 1000)}s`,
  );
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : "–");
const fmt = (n: number) => n.toLocaleString("en-US");

function report(): void {
  const input = arg("--in");
  if (!input) {
    console.error("usage: logCensus.ts report --in <rows.jsonl>");
    process.exit(1);
  }
  const rows = readFileSync(input, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FileRow);

  const errors = rows.filter((r) => r.error);
  const noRounds = rows.filter((r) => !r.error && r.rounds.length === 0);
  const lines = rows.reduce((s, r) => s + r.lines, 0);
  const failed = rows.reduce((s, r) => s + r.failed, 0);
  const segDropped = rows.reduce((s, r) => s + r.segmentsDropped, 0);

  // Unique rounds: first occurrence of each dedupe key wins.
  const seen = new Set<string>();
  const unique: RoundRow[] = [];
  let allRounds = 0;
  for (const r of rows)
    for (const rd of r.rounds) {
      allRounds++;
      if (seen.has(rd.key)) continue;
      seen.add(rd.key);
      unique.push(rd);
    }
  const fileBracket = (r: FileRow) => r.rounds[0]?.bracket ?? "(no round)";

  const out: string[] = [];
  out.push(`# Combat-log census`, "");
  out.push(`Rows: ${input}`, "");
  out.push(`## Denominators`, "");
  out.push(`| | count |`, `|---|---:|`);
  out.push(`| files | ${fmt(rows.length)} |`);
  out.push(`| files unreadable / parse error | ${fmt(errors.length)} |`);
  out.push(`| files with no complete round | ${fmt(noRounds.length)} |`);
  out.push(`| non-empty lines | ${fmt(lines)} |`);
  out.push(
    `| lines parseLine rejected | ${fmt(failed)} (${pct(failed, lines)} %) |`,
  );
  out.push(
    `| segments dropped (unclosed / double start) | ${fmt(segDropped)} |`,
  );
  out.push(`| rounds (all recordings) | ${fmt(allRounds)} |`);
  out.push(
    `| unique rounds (same lobby + round collapsed) | ${fmt(unique.length)} |`,
  );
  out.push("");

  out.push(`## Unique rounds by bracket × advanced logging`, "");
  out.push(
    `| bracket | rounds | advanced logging on | % | all players sampled | % |`,
    `|---|---:|---:|---:|---:|---:|`,
  );
  const byBracket = new Map<string, RoundRow[]>();
  for (const u of unique)
    byBracket.set(u.bracket, [...(byBracket.get(u.bracket) ?? []), u]);
  for (const [b, us] of [...byBracket].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const adv = us.filter((u) => u.adv).length;
    const full = us.filter((u) => u.adv && u.advPlayers === u.players).length;
    out.push(
      `| ${b} | ${fmt(us.length)} | ${fmt(adv)} | ${pct(adv, us.length)} | ${fmt(full)} | ${pct(full, us.length)} |`,
    );
  }
  out.push("");

  out.push(`## Unique rounds by week`, "");
  out.push(`| week | rounds |`, `|---|---:|`);
  const byWeek = new Map<string, number>();
  for (const u of unique) byWeek.set(u.week, (byWeek.get(u.week) ?? 0) + 1);
  for (const [w, n] of [...byWeek].sort()) out.push(`| ${w} | ${fmt(n)} |`);
  out.push("");

  out.push(`## Recorder (owner) spec, unique rounds`, "");
  out.push(`| spec | rounds | % | advanced on % |`, `|---|---:|---:|---:|`);
  const bySpec = new Map<number, RoundRow[]>();
  for (const u of unique)
    bySpec.set(u.ownerSpec, [...(bySpec.get(u.ownerSpec) ?? []), u]);
  for (const [s, us] of [...bySpec].sort((a, b) => b[1].length - a[1].length)) {
    const name = s ? specToString(String(s) as CombatUnitSpec) : "(unknown)";
    out.push(
      `| ${name} | ${fmt(us.length)} | ${pct(us.length, unique.length)} | ${pct(us.filter((u) => u.adv).length, us.length)} |`,
    );
  }
  out.push("");

  out.push(`## Maps (zoneId), unique rounds`, "");
  out.push(`| zoneId | rounds |`, `|---|---:|`);
  const byZone = new Map<string, number>();
  for (const u of unique) byZone.set(u.zoneId, (byZone.get(u.zoneId) ?? 0) + 1);
  for (const [z, n] of [...byZone].sort((a, b) => b[1] - a[1]))
    out.push(`| ${z} | ${fmt(n)} |`);
  out.push("");

  out.push(`## Parser invariant violations (unique rounds)`, "");
  const inv = new Map<string, number>();
  for (const u of unique)
    for (const [c, n] of Object.entries(u.inv))
      inv.set(c, (inv.get(c) ?? 0) + (n > 0 ? 1 : 0));
  if (inv.size === 0) out.push(`None.`);
  else {
    out.push(`| code | rounds with ≥ 1 |`, `|---|---:|`);
    for (const [c, n] of [...inv].sort()) out.push(`| ${c} | ${fmt(n)} |`);
  }
  out.push("");

  out.push(`## Event types`, "");
  const brackets = [...byBracket.keys()].sort();
  out.push(
    `Lines and files over every recording (duplicates included — these describe what files contain). “unknown” = lines L1 returns with known: false. Per-bracket columns: % of that bracket's files containing the event (file bracket = its first round's).`,
    "",
  );
  const filesPerBracket = new Map<string, number>();
  for (const r of rows)
    filesPerBracket.set(
      fileBracket(r),
      (filesPerBracket.get(fileBracket(r)) ?? 0) + 1,
    );
  out.push(
    `| event | lines | files | % files | unknown lines | ${brackets.join(" | ")} |`,
    `|---|---:|---:|---:|---:|${brackets.map(() => "---:").join("|")}|`,
  );
  const evLines = new Map<string, number>();
  const evFiles = new Map<string, number>();
  const evUnknown = new Map<string, number>();
  const evFilesByBracket = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const b = fileBracket(r);
    for (const [e, n] of Object.entries(r.events)) {
      evLines.set(e, (evLines.get(e) ?? 0) + n);
      evFiles.set(e, (evFiles.get(e) ?? 0) + 1);
      const m = evFilesByBracket.get(e) ?? new Map<string, number>();
      m.set(b, (m.get(b) ?? 0) + 1);
      evFilesByBracket.set(e, m);
    }
    for (const [e, n] of Object.entries(r.unknown))
      evUnknown.set(e, (evUnknown.get(e) ?? 0) + n);
  }
  for (const [e, n] of [...evLines].sort((a, b) => b[1] - a[1])) {
    const perB = brackets.map((b) =>
      pct(evFilesByBracket.get(e)?.get(b) ?? 0, filesPerBracket.get(b) ?? 0),
    );
    out.push(
      `| ${e} | ${fmt(n)} | ${fmt(evFiles.get(e) ?? 0)} | ${pct(evFiles.get(e) ?? 0, rows.length)} | ${fmt(evUnknown.get(e) ?? 0)} | ${perB.join(" | ")} |`,
    );
  }
  out.push("");
  if (errors.length) {
    out.push(`## Errors (first 20)`, "");
    for (const r of errors.slice(0, 20)) out.push(`- ${r.error}`);
  }
  console.log(out.join("\n"));
}

const cmd = process.argv[2];
if (cmd === "scan") scan();
else if (cmd === "report") report();
else {
  console.error("usage: logCensus.ts scan|report …");
  process.exit(1);
}
