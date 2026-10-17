/**
 * profilePipeline.ts — where does a corpus scan's wall clock go? Runs the
 * product pipeline the way `acceptanceCapture.ts` runs it (same helpers: one
 * parse per file, one `toLegacyMatch` per round, `roundRawStreams`, the
 * candidate menu as the app builds it, `buildMatchContext` per friendly
 * owner) and times each phase. Nothing is written; the output is a table.
 *
 * Why it exists (2026-10-17): the reference-table regenerations take 1–7 h
 * each, and the guess "it is the analysis" was wrong once already — on the
 * real-match fixture a whole owner costs ~0.2 s (`698fc58`). This measures
 * instead of guessing. Run it on a slice before optimising anything, and
 * with `--cpu-prof` underneath when a phase needs a function-level answer:
 *
 *   npx tsx packages/eval/scripts/profilePipeline.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     --every 300 [--archive-dir <dir>] [--no-raw-streams]
 *   npx tsx packages/eval/scripts/profilePipeline.ts <raw.txt | dir>...
 *
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof --import tsx \
 *     packages/eval/scripts/profilePipeline.ts --manifest … --every 300
 *
 * Phases: read (readFile + gunzip), parse (GladLogParser push + end),
 * legacy (toLegacyMatch per round), rawStreams (roundRawStreams per round —
 * it re-reads the whole file's text for every round of a Solo Shuffle),
 * candidates and context (per owner). The per-phase sums are the numbers to
 * compare; `other` is the wall clock none of them account for.
 *
 * The timing core (`profileText`) is exported for
 * test/profilePipeline.test.ts; only the `process.argv` guard at the bottom
 * runs the CLI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import { buildMatchContext } from "@gladlog/analysis/src/context/buildMatchContext";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

import {
  candidatesAsTheAppRuns,
  roundRawStreams,
} from "../src/corpus/appCandidates";
import { splitTeams } from "../src/explore/storeAccess";

export const PHASES = [
  "read",
  "parse",
  "legacy",
  "rawStreams",
  "candidates",
  "context",
] as const;
export type Phase = (typeof PHASES)[number];

export interface ProfileTally {
  files: number;
  rounds: number;
  owners: number;
  /** Raw text characters read. */
  chars: number;
  candidates: number;
  contextChars: number;
  ms: Record<Phase, number>;
  wallMs: number;
}

export const newProfileTally = (): ProfileTally => ({
  files: 0,
  rounds: 0,
  owners: 0,
  chars: 0,
  candidates: 0,
  contextChars: 0,
  ms: Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<Phase, number>,
  wallMs: 0,
});

export function addProfileTally(into: ProfileTally, t: ProfileTally): void {
  into.files += t.files;
  into.rounds += t.rounds;
  into.owners += t.owners;
  into.chars += t.chars;
  into.candidates += t.candidates;
  into.contextChars += t.contextChars;
  for (const p of PHASES) into.ms[p] += t.ms[p];
  into.wallMs += t.wallMs;
}

/** One file's text through the pipeline, as acceptanceCapture runs it.
 * `rawStreams: false` = the `--no-raw-streams` arm. */
export function profileText(
  text: string,
  opts: { rawStreams?: boolean; now?: () => number } = {},
): ProfileTally {
  const now = opts.now ?? (() => performance.now());
  const useRaw = opts.rawStreams ?? true;
  const t = newProfileTally();
  const wall0 = now();
  t.files = 1;
  t.chars = text.length;

  let a = now();
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  t.ms.parse += now() - a;

  for (const m of items) {
    a = now();
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      t.ms.legacy += now() - a;
      continue;
    }
    t.ms.legacy += now() - a;
    t.rounds++;

    a = now();
    const streams = roundRawStreams(legacy, useRaw ? text : null);
    t.ms.rawStreams += now() - a;

    const { friends, enemies } = splitTeams(legacy);
    for (const owner of friends) {
      t.owners++;
      a = now();
      // the cached streams again — same call the capture makes, no re-parse
      const cands = candidatesAsTheAppRuns(legacy, owner.id, useRaw ? text : null);
      t.ms.candidates += now() - a;
      t.candidates += cands.length;
      a = now();
      const ctx = buildMatchContext(legacy, friends, enemies, {
        owner,
        rawStreams: streams,
      });
      t.ms.context += now() - a;
      t.contextChars += ctx.length;
    }
  }
  t.wallMs = now() - wall0;
  return t;
}

/** The report: per-phase totals, their share of the wall clock, and the
 * per-round / per-owner means. */
export function formatProfile(t: ProfileTally): string[] {
  const wall = t.wallMs + t.ms.read;
  const accounted = PHASES.reduce((n, p) => n + t.ms[p], 0);
  const pct = (ms: number) => (wall > 0 ? (100 * ms) / wall : 0);
  const lines = [
    `files=${t.files} rounds=${t.rounds} owners=${t.owners} raw=${(t.chars / 1e6).toFixed(1)} MB chars candidates=${t.candidates} context=${(t.contextChars / 1e6).toFixed(2)} M chars`,
    `wall ${(wall / 1000).toFixed(1)} s`,
  ];
  for (const p of PHASES)
    lines.push(
      `  ${p.padEnd(11)} ${(t.ms[p] / 1000).toFixed(2).padStart(9)} s  ${pct(t.ms[p]).toFixed(1).padStart(5)} %`,
    );
  lines.push(
    `  ${"other".padEnd(11)} ${((wall - accounted) / 1000).toFixed(2).padStart(9)} s  ${pct(wall - accounted).toFixed(1).padStart(5)} %`,
  );
  if (t.rounds > 0)
    lines.push(
      `per round: parse+legacy ${((t.ms.parse + t.ms.legacy) / t.rounds).toFixed(0)} ms, rawStreams ${(t.ms.rawStreams / t.rounds).toFixed(0)} ms`,
    );
  if (t.owners > 0)
    lines.push(
      `per owner: candidates ${(t.ms.candidates / t.owners).toFixed(0)} ms, context ${(t.ms.context / t.owners).toFixed(0)} ms`,
    );
  return lines;
}

function rawFiles(arg: string): string[] {
  if (!statSync(arg).isDirectory()) return [arg];
  const out: string[] = [];
  for (const entry of readdirSync(arg).sort()) {
    const p = path.join(arg, entry);
    if (statSync(p).isDirectory()) out.push(...rawFiles(p));
    else if (entry === "raw.txt" || entry.endsWith(".txt.gz")) out.push(p);
  }
  return out;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 1,
    archiveDir: "",
    rawStreams: true,
    paths: [] as string[],
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
    else if (a[i] === "--no-raw-streams") out.rawStreams = false;
    else out.paths.push(a[i]!);
  }
  if (
    (!out.manifest && out.paths.length === 0) ||
    !Number.isFinite(out.every) ||
    out.every < 1
  ) {
    console.error(
      "usage: profilePipeline.ts (--manifest <path> [--every N] [--archive-dir <dir>] | <raw.txt | dir>...) [--no-raw-streams]",
    );
    process.exit(2);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  await ensureAnalysisData();
  const files = args.manifest
    ? readFileSync(args.manifest, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((_, i) => i % args.every === 0)
        .map((f) =>
          f.startsWith("/") || !args.archiveDir
            ? f
            : path.resolve(args.archiveDir, f),
        )
    : args.paths.flatMap(rawFiles);

  const total = newProfileTally();
  let unread = 0;
  for (const f of files) {
    const a = performance.now();
    let text: string;
    try {
      const raw = readFileSync(f);
      text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      unread++;
      continue;
    }
    total.ms.read += performance.now() - a;
    addProfileTally(total, profileText(text, { rawStreams: args.rawStreams }));
  }
  for (const line of formatProfile(total)) console.log(line);
  // a scan that read nothing is not a measurement (verification.md)
  if (unread > 0) console.log(`UNREAD ${unread} of ${files.length} files`);
  process.exit(total.files === 0 ? 1 : 0);
}

if (process.argv[1]?.includes("profilePipeline")) void main();
