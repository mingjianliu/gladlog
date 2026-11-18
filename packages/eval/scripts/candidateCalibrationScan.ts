/**
 * candidateCalibrationScan.ts CLI — dumb shell over
 * `../src/explore/candidateCalibration.ts` for the Task 5 (P1/P2
 * distillation) corpus calibration of the candidate builders
 * (missedSyncWindow / cdHoarded) and the match threat level. Per the plan's global constraint, this file
 * writes no detection/counting logic of its own — it only walks the local
 * match library (same `storeAccess.ts` loader every other explore script
 * uses) and hands each round to `candidateCalibration.ts`.
 *
 * A full-corpus run is slow (500+ matches, each a large JSON parse +
 * `toLegacyMatch` conversion + per-friendly `extractMajorCooldowns` +
 * `matchThreatLevel`'s per-second sampling) — this script is meant to be
 * invoked repeatedly in `--offset/--limit` slices from a front-of-terminal
 * shell loop (never backgrounded — CLAUDE.md's "分批前台" discipline),
 * appending to a partial JSONL file each call so a killed/timed-out batch
 * doesn't lose prior progress.
 *
 * Three subcommands:
 *   scan    tsx candidateCalibrationScan.ts scan --tag <name> [--store DIR] [--offset N] [--limit N]
 *             Counts every builder at PRODUCTION defaults (no overrides —
 *             the module constants ARE the thresholds under test) plus
 *             matchThreatLevel, one row per round, JSONL-appended.
 *   sweep   tsx candidateCalibrationScan.ts sweep --tag <name> [--store DIR] [--offset N] [--limit N]
 *             Builds each round's context ONCE, then re-derives
 *             matchThreatLevel at every damage-window tier
 *             (THREAT_WINDOW_TIERS below) — cheap, in-memory, no re-parsing.
 *             One row per round, JSONL-appended (same resumability shape as
 *             `scan`). cd-hoarded's own {H, crisisHP} grid sweep retired
 *             2026-08-30 (GH #34 decision-point rewrite) — see
 *             candidateCalibration.ts's `countsAtThresholds` doc comment.
 *   report  tsx candidateCalibrationScan.ts report --tag <name> --kind scan|sweep [--out FILE]
 *             Aggregates a tag's partial file into a markdown report
 *             (`scan` → per-type occurrence/mean via `summarize`; `sweep` →
 *             the threshold sensitivity table).
 *
 * `--tag` namespaces the partial files so a `scan` run and a `sweep` run (or
 * two differently-scoped sweeps) never mix in one file.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ensureAnalysisData } from "@gladlog/analysis";

import { resolveEvalHome } from "../src/evalHome.js";
import {
  buildRoundContext,
  countsAtThresholds,
  type RoundCandidateCounts,
  scanRound,
  summarize,
} from "../src/explore/candidateCalibration.js";
import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
} from "../src/explore/storeAccess.js";

const USAGE = `usage:
  candidateCalibrationScan.ts scan --tag <name> [--store <dir>] [--offset N] [--limit N] [--partial-dir <dir>]
  candidateCalibrationScan.ts sweep --tag <name> [--store <dir>] [--offset N] [--limit N] [--partial-dir <dir>]
  candidateCalibrationScan.ts report --tag <name> --kind scan|sweep [--partial-dir <dir>] [--out <file>]`;

/** cd-hoarded's own H/crisis-HP sensitivity grid retired 2026-08-30 (GH #34
 * decision-point rewrite) — `cdHoardedEvents` no longer takes a
 * minLateS/crisisHpPct threshold pair at all (see cooldownTiming.ts's
 * `cdHoardedEvents` doc comment), so there is nothing left for this sweep
 * to vary. The `sweep` subcommand below now only sweeps the threat
 * damage-window tiers. */

/** Threat damage-rate window sensitivity tiers (plan Task 5: "威胁承伤阈三档").
 * `threatActiveAt`'s damage-rate disjunct is "how wide a window around the
 * queried instant counts as the same pressure event" — see
 * `THREAT_DAMAGE_WINDOW_MS`'s doc comment in threatAssessment.ts. Three
 * tiers straddling the calibrated final value (w3000ms — see
 * p1p2-calibration.md for the corpus/hard-acceptance derivation). The other
 * four threat overrides are held at their FINAL calibrated values
 * (`FINAL_THREAT_PARAMS_EXCEPT_WINDOW`) rather than left to fall back to
 * whatever `threatAssessment.ts`'s module constants happen to be at the
 * moment this sweep runs — a sensitivity table is only meaningful when
 * exactly one axis moves at a time. */
const THREAT_WINDOW_TIERS = [2000, 3000, 5000] as const;
const FINAL_THREAT_PARAMS_EXCEPT_WINDOW = {
  lowMinHpPct: 45,
  segmentMinDurationS: 2,
  persistS: 20,
  recoveryWindowS: 15,
};
function threatCellKey(ms: number): string {
  return `w${ms}`;
}

function scanFile(partialDir: string, tag: string, kind: string): string {
  return join(partialDir, `candidate-calibration-${kind}-${tag}.rows.jsonl`);
}
function processedFile(partialDir: string, tag: string, kind: string): string {
  return join(partialDir, `candidate-calibration-${kind}-${tag}.processed.txt`);
}
function errorsFile(partialDir: string, tag: string, kind: string): string {
  return join(partialDir, `candidate-calibration-${kind}-${tag}.errors.txt`);
}

function readProcessedIds(
  partialDir: string,
  tag: string,
  kind: string,
): Set<string> {
  const f = processedFile(partialDir, tag, kind);
  if (!existsSync(f)) return new Set();
  return new Set(
    readFileSync(f, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

/** Mirrors cdLedgerRotScan.ts's own `countRounds` — reads just far enough
 * into `match.json` to get a shuffle round count without loading the full
 * round twice. */
function countRounds(matchesDir: string, matchId: string): number | undefined {
  const doc = JSON.parse(
    readFileSync(join(matchesDir, matchId, "match.json"), "utf8"),
  ) as { kind?: string; data?: { rounds?: unknown[] } };
  if (doc.kind !== "shuffle") return undefined;
  return doc.data?.rounds?.length ?? 0;
}

interface SweepRow {
  matchId: string;
  roundSeq?: number;
  threat: Record<string, string>;
}

async function runScan(args: {
  store: string;
  tag: string;
  offset: number;
  limit: number | undefined;
  partialDir: string;
}): Promise<void> {
  await ensureAnalysisData();
  mkdirSync(args.partialDir, { recursive: true });

  const allRows = loadIndex(args.store);
  const already = readProcessedIds(args.partialDir, args.tag, "scan");
  const pending = allRows.filter((r) => !already.has(r.id));
  const slice =
    args.limit !== undefined
      ? pending.slice(args.offset, args.offset + args.limit)
      : pending.slice(args.offset);

  console.log(
    `[candidateCalibrationScan:scan] tag=${args.tag} total=${allRows.length} already-done=${already.size} this-run=${slice.length}`,
  );

  let errors = 0;
  let skippedNoTeams = 0;
  for (const row of slice) {
    try {
      const roundCount = countRounds(args.store, row.id);
      const roundSeqs: (number | undefined)[] =
        roundCount === undefined ? [undefined] : [...Array(roundCount).keys()];
      for (const roundSeq of roundSeqs) {
        const { legacy } = loadLegacyRound(args.store, row.id, roundSeq);
        const counts = scanRound(row.id, legacy, roundSeq);
        if (counts === null) {
          skippedNoTeams++;
          continue;
        }
        appendFileSync(
          scanFile(args.partialDir, args.tag, "scan"),
          JSON.stringify(counts) + "\n",
        );
      }
      appendFileSync(
        processedFile(args.partialDir, args.tag, "scan"),
        row.id + "\n",
      );
    } catch (err) {
      errors++;
      appendFileSync(
        errorsFile(args.partialDir, args.tag, "scan"),
        `${row.id}\t${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  console.log(
    `[candidateCalibrationScan:scan] done this-run=${slice.length} errors=${errors} skipped(no-teams)=${skippedNoTeams} remaining=${pending.length - slice.length}`,
  );
}

async function runSweep(args: {
  store: string;
  tag: string;
  offset: number;
  limit: number | undefined;
  partialDir: string;
}): Promise<void> {
  await ensureAnalysisData();
  mkdirSync(args.partialDir, { recursive: true });

  const allRows = loadIndex(args.store);
  const already = readProcessedIds(args.partialDir, args.tag, "sweep");
  const pending = allRows.filter((r) => !already.has(r.id));
  const slice =
    args.limit !== undefined
      ? pending.slice(args.offset, args.offset + args.limit)
      : pending.slice(args.offset);

  console.log(
    `[candidateCalibrationScan:sweep] tag=${args.tag} total=${allRows.length} already-done=${already.size} this-run=${slice.length}`,
  );

  let errors = 0;
  let skippedNoTeams = 0;
  for (const row of slice) {
    try {
      const roundCount = countRounds(args.store, row.id);
      const roundSeqs: (number | undefined)[] =
        roundCount === undefined ? [undefined] : [...Array(roundCount).keys()];
      for (const roundSeq of roundSeqs) {
        const { legacy } = loadLegacyRound(args.store, row.id, roundSeq);
        const ctx = buildRoundContext(row.id, legacy, roundSeq);
        if (ctx === null) {
          skippedNoTeams++;
          continue;
        }
        const threat: Record<string, string> = {};
        for (const ms of THREAT_WINDOW_TIERS) {
          threat[threatCellKey(ms)] = countsAtThresholds(ctx, {
            threatOverrides: {
              ...FINAL_THREAT_PARAMS_EXCEPT_WINDOW,
              damageWindowMs: ms,
            },
          }).threatLevel;
        }
        const sweepRow: SweepRow = {
          matchId: row.id,
          roundSeq,
          threat,
        };
        appendFileSync(
          scanFile(args.partialDir, args.tag, "sweep"),
          JSON.stringify(sweepRow) + "\n",
        );
      }
      appendFileSync(
        processedFile(args.partialDir, args.tag, "sweep"),
        row.id + "\n",
      );
    } catch (err) {
      errors++;
      appendFileSync(
        errorsFile(args.partialDir, args.tag, "sweep"),
        `${row.id}\t${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  console.log(
    `[candidateCalibrationScan:sweep] done this-run=${slice.length} errors=${errors} skipped(no-teams)=${skippedNoTeams} remaining=${pending.length - slice.length}`,
  );
}

function loadScanRows(partialDir: string, tag: string): RoundCandidateCounts[] {
  const f = scanFile(partialDir, tag, "scan");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RoundCandidateCounts);
}

function loadSweepRows(partialDir: string, tag: string): SweepRow[] {
  const f = scanFile(partialDir, tag, "sweep");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SweepRow);
}

function formatScanReport(tag: string, partialDir: string): string {
  const rows = loadScanRows(partialDir, tag);
  const matches = readProcessedIds(partialDir, tag, "scan").size;
  const errFile = errorsFile(partialDir, tag, "scan");
  const errors = existsSync(errFile)
    ? readFileSync(errFile, "utf8").split("\n").filter(Boolean).length
    : 0;
  const s = summarize(rows);
  const lines = [
    `# candidate calibration scan — ${tag}`,
    "",
    `matches processed: ${matches} (errored/skipped: ${errors})`,
    `rounds scanned: ${s.roundsScanned}`,
    "",
    "## per-type (at production/final thresholds)",
    "",
    "| type | 发生率 (% rounds ≥1) | 场均条数 (capped) | 场均条数 (raw, pre-cap) |",
    "|---|---|---|---|",
    ...(
      Object.entries(s.perType) as [
        string,
        (typeof s.perType)[keyof typeof s.perType],
      ][]
    ).map(
      ([name, t]) =>
        `| ${name} | ${t.occurrenceRatePct.toFixed(1)}% | ${t.meanCappedPerRound.toFixed(2)} | ${t.meanRawPerRound.toFixed(2)} |`,
    ),
    "",
    "## threat-level distribution",
    "",
    `low=${s.threatDistributionPct.low.toFixed(1)}% med=${s.threatDistributionPct.med.toFixed(1)}% high=${s.threatDistributionPct.high.toFixed(1)}%`,
    "",
  ];
  return lines.join("\n");
}

function formatSweepReport(tag: string, partialDir: string): string {
  const rows = loadSweepRows(partialDir, tag);
  const matches = readProcessedIds(partialDir, tag, "sweep").size;
  const n = rows.length;
  const lines = [
    `# candidate calibration sweep — ${tag}`,
    "",
    `matches processed: ${matches}`,
    `rounds swept: ${n}`,
    "",
    // cd-hoarded's own {H, crisisHP} sensitivity table retired 2026-08-30
    // (GH #34 decision-point rewrite) — see runSweep's doc comment above.
  ];
  lines.push(
    "## threat damage-window sensitivity (threat-level distribution per tier)",
  );
  lines.push("");
  lines.push("| window | low% | med% | high% |");
  lines.push("|---|---|---|---|");
  for (const ms of THREAT_WINDOW_TIERS) {
    const key = threatCellKey(ms);
    const levels = rows.map((r) => r.threat[key]);
    const pct = (lvl: string) =>
      n === 0 ? 0 : (levels.filter((l) => l === lvl).length / n) * 100;
    lines.push(
      `| ${ms}ms | ${pct("low").toFixed(1)}% | ${pct("med").toFixed(1)}% | ${pct("high").toFixed(1)}% |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      store: { type: "string" },
      tag: { type: "string" },
      kind: { type: "string" },
      offset: { type: "string" },
      limit: { type: "string" },
      "partial-dir": { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: true,
  });

  const cmd = positionals[0];
  if (!cmd || !values.tag) throw new Error(USAGE);

  const store = values.store ?? DEFAULT_MATCH_DIR;
  const evalHome = resolveEvalHome();
  const partialDir =
    values["partial-dir"] ??
    join(evalHome, "reports", "candidate-calibration-partial");

  if (cmd === "scan") {
    await runScan({
      store,
      tag: values.tag,
      offset: values.offset ? Number(values.offset) : 0,
      limit: values.limit ? Number(values.limit) : undefined,
      partialDir,
    });
  } else if (cmd === "sweep") {
    await runSweep({
      store,
      tag: values.tag,
      offset: values.offset ? Number(values.offset) : 0,
      limit: values.limit ? Number(values.limit) : undefined,
      partialDir,
    });
  } else if (cmd === "report") {
    if (values.kind !== "scan" && values.kind !== "sweep") {
      throw new Error(`report requires --kind scan|sweep\n${USAGE}`);
    }
    const report =
      values.kind === "scan"
        ? formatScanReport(values.tag, partialDir)
        : formatSweepReport(values.tag, partialDir);
    const out =
      values.out ??
      join(
        evalHome,
        "reports",
        `candidate-calibration-${values.kind}-${values.tag}.md`,
      );
    writeFileSync(out, report);
    console.log(`[candidateCalibrationScan:report] written: ${out}`);
  } else {
    throw new Error(USAGE);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(USAGE);
  process.exit(1);
});
