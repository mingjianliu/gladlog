/**
 * A/B pair pre-selection (2026-09-12, GH #78/#80 100-pair rerun): walk a
 * manifest (plain or .gz archive logs), pick each round's owner with the SAME
 * predicate `buildCorpus` uses (`selectCorpusOwner`), run the candidate
 * extractor, and keep the files whose owner prompt would carry at least one of
 * the named candidate types — i.e. the rounds where control and treatment
 * prompts differ. Stops once `--target` differing rounds are collected, and
 * writes decompressed copies (buildCorpus reads plain text) plus a manifest.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/abPairSelect.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     --every 7 --owner recorder --types backlash-dispel,backlash-dispel-window,kick-priority-missed,kick-priority-team \
 *     --target 110 --out-dir $GLADLOG_EVAL_HOME/corpus/ab-2026-09-12-100 \
 *     --manifest-out $GLADLOG_EVAL_HOME/corpus/manifest-ab-2026-09-12-100.txt
 *
 * Output (stdout): one line per kept file — path, rounds, differing rounds,
 * per-type counts — and a summary. The manifest lists the decompressed copies.
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, resolve } from "path";
import { gunzipSync } from "zlib";

import { candidatesAsTheAppRuns } from "../src/corpus/appCandidates";

import { selectCorpusOwner } from "../src/corpus/buildCorpus";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 1,
    owner: "recorder" as "healer" | "dps" | "recorder",
    types: [] as string[],
    target: 100,
    outDir: "",
    manifestOut: "",
    archiveDir: process.cwd(),
    offset: 0,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--offset") out.offset = Number(a[++i]);
    else if (a[i] === "--owner") out.owner = a[++i] as never;
    else if (a[i] === "--types")
      out.types = (a[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a[i] === "--target") out.target = Number(a[++i]);
    else if (a[i] === "--out-dir") out.outDir = a[++i] ?? "";
    else if (a[i] === "--manifest-out") out.manifestOut = a[++i] ?? "";
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
  }
  if (
    !out.manifest ||
    out.types.length === 0 ||
    !out.outDir ||
    !out.manifestOut
  ) {
    console.error(
      "usage: abPairSelect.ts --manifest <path> --types a,b [--every N] [--offset K] [--owner recorder|healer|dps] [--target N] --out-dir <dir> --manifest-out <file>",
    );
    process.exit(1);
  }
  return out;
}

const args = parseArgs();
await ensureAnalysisData();
mkdirSync(args.outDir, { recursive: true });
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === args.offset % args.every);
const wanted = new Set(args.types);
const kept: string[] = [];
const totals = new Map<string, number>();
let scanned = 0;
let roundsSeen = 0;
let ownerMissing = 0;
let differing = 0;
const t0 = Date.now();
for (const f of files) {
  if (differing >= args.target) break;
  scanned++;
  const p = f.startsWith("/") ? f : resolve(args.archiveDir, f);
  let text: string;
  try {
    const raw = readFileSync(p);
    text = (p.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  let fileDiff = 0;
  let fileRounds = 0;
  const perType = new Map<string, number>();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    fileRounds++;
    roundsSeen++;
    const players = Object.values(legacy.units as Record<string, any>).filter(
      (u: any) => u.info,
    );
    const owner = selectCorpusOwner(players, legacy as never, args.owner);
    if (!owner) {
      ownerMissing++;
      continue;
    }
    let cands: ReturnType<typeof extractCandidateFindings> = [];
    try {
      cands = candidatesAsTheAppRuns(legacy, owner.id, text);
    } catch {
      continue;
    }
    const hit = cands.filter((c) => wanted.has(c.type));
    if (hit.length === 0) continue;
    fileDiff++;
    for (const c of hit) {
      perType.set(c.type, (perType.get(c.type) ?? 0) + 1);
      totals.set(c.type, (totals.get(c.type) ?? 0) + 1);
    }
  }
  if (fileDiff === 0) {
    if (scanned % 50 === 0)
      console.error(
        `scanned ${scanned}/${files.length} files, ${differing} differing rounds | ${Math.round((Date.now() - t0) / 1000)}s`,
      );
    continue;
  }
  differing += fileDiff;
  const name = basename(p).replace(/\.gz$/, "");
  const dst = resolve(args.outDir, name);
  writeFileSync(dst, text);
  kept.push(dst);
  console.log(
    `${dst}\trounds=${fileRounds}\tdiffering=${fileDiff}\t${[...perType.entries()].map(([k, v]) => `${k}=${v}`).join(",")}`,
  );
}
writeFileSync(args.manifestOut, kept.join("\n") + "\n");
console.log(
  `summary: scanned ${scanned}/${files.length} files, rounds ${roundsSeen}, owner-missing ${ownerMissing}, kept files ${kept.length}, differing rounds ${differing} | ${[...totals.entries()].map(([k, v]) => `${k}=${v}`).join(", ")} | ${Math.round((Date.now() - t0) / 1000)}s`,
);
