/* eslint-disable no-console */
/**
 * CLI: Collect benchmarks from local WoW combat logs
 *
 * Reads a manifest of log file paths, parses each with GladLogParser,
 * stratifies by spec×archetype, and aggregates benchmark statistics.
 *
 * Usage:
 *   tsx packages/analysis/scripts/collectBenchmarks.ts \
 *     --manifest <path> \
 *     [--min-rating 2100] \
 *     [--min-n 30] \
 *     [--per-stratum-cap 40] \
 *     [--out packages/analysis/benchmarks/benchmark_data.json]
 */

import fs from "fs-extra";
import path from "path";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { stratifiedSample, type SampleMeta } from "../src/benchmark/stratify";
import {
  computeBenchmarks,
  type BenchmarkOutput,
  type SpecSummary,
} from "../src/benchmark/metrics";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(): {
  manifest: string;
  minRating: number;
  minN: number;
  perStratumCap: number;
  out: string;
} {
  const args = process.argv.slice(2);
  const result = {
    manifest: "",
    minRating: 2100,
    minN: 30,
    perStratumCap: 40,
    out: "packages/analysis/benchmarks/benchmark_data.json",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") result.manifest = args[i + 1];
    else if (args[i] === "--min-rating")
      result.minRating = parseInt(args[i + 1], 10);
    else if (args[i] === "--min-n") result.minN = parseInt(args[i + 1], 10);
    else if (args[i] === "--per-stratum-cap")
      result.perStratumCap = parseInt(args[i + 1], 10);
    else if (args[i] === "--out") result.out = args[i + 1];
  }

  if (!result.manifest) {
    console.error("Error: --manifest <path> is required");
    process.exit(1);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const {
    manifest: manifestPath,
    minRating,
    minN,
    perStratumCap,
    out,
  } = parseArgs();

  console.log("Collecting benchmark data from local logs");
  console.log(
    `  minRating=${minRating}  minN=${minN}  perStratumCap=${perStratumCap}`,
  );
  console.log();

  // 1. Read manifest
  console.log(`Reading manifest from ${manifestPath}...`);
  let logPaths: string[] = [];
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    logPaths = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    console.error(`Failed to read manifest: ${err}`);
    process.exit(1);
  }

  console.log(`  ${logPaths.length} log file(s) to process`);
  console.log();

  // 2. Parse logs and collect samples
  console.log(`Parsing logs...`);
  const pool: SampleMeta[] = [];
  let parsed = 0;
  let failed = 0;

  for (let i = 0; i < logPaths.length; i++) {
    const logPath = logPaths[i];
    try {
      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.split("\n");
      const parser = new GladLogParser();
      const matches: Array<{ type: "match"; data: any }> = [];

      parser.on("arena_match_ended", (match) => {
        matches.push({ type: "match", data: match });
      });
      parser.on("shuffle_completed", (shuffle) => {
        // If shuffle has rounds, we process each round
        if (shuffle.rounds) {
          for (const round of shuffle.rounds) {
            matches.push({ type: "round", data: round });
          }
        }
      });

      for (const line of lines) {
        parser.parseLine(line);
      }
      parser.flush();

      // Process collected matches
      for (const m of matches) {
        // Convert to legacy format
        const legacyMatch = m.type === "match" ? toLegacyMatch(m.data) : m.data;

        // Extract player units and filter by rating
        const allUnits = Object.values(legacyMatch.units);
        const playerUnits = allUnits.filter((u: any) => u.type === 0); // CombatUnitType.Player

        for (const unit of playerUnits) {
          if ((unit.info?.personalRating ?? 0) >= minRating) {
            const spec = String(unit.spec);
            // Determine archetype from team composition
            const friendlyUnits = allUnits.filter((u: any) => u.reaction === 0); // Friendly
            const healerSpecs = new Set<string>();
            let nonHealerCount = 0;

            for (const fu of friendlyUnits) {
              const fuSpec = String(fu.spec);
              // Heuristic: specs with "Healer" in common names or healing focus
              if (
                fuSpec.includes("Holy") ||
                fuSpec.includes("Restoration") ||
                fuSpec.includes("Discipline") ||
                fuSpec.includes("Mistweaver")
              ) {
                healerSpecs.add(fuSpec);
              } else {
                nonHealerCount++;
              }
            }

            const archetype =
              Array.from(healerSpecs).sort().join("+") +
              (healerSpecs.size > 0 ? "/" : "") +
              nonHealerCount;

            pool.push({
              id: `${logPath}:${unit.id}`,
              spec,
              archetype,
            });
          }
        }
      }

      parsed++;
    } catch (err) {
      console.warn(`  WARN: ${logPath}: ${err}`);
      failed++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  processed ${i + 1} / ${logPaths.length}`);
    }
  }

  console.log(`\nParsed: ${parsed}  Failed: ${failed}`);
  console.log(`Pool size: ${pool.length} samples`);

  // 3. Stratified sampling
  console.log(`\nStratifying sample (cap=${perStratumCap}, minN=${minN})...`);
  const stratified = stratifiedSample(pool, { perStratumCap, minN });
  console.log(`  Selected: ${stratified.selected.length} samples`);
  console.log(`  Unique specs: ${Object.keys(stratified.perSpec).length}`);
  for (const [spec, info] of Object.entries(stratified.perSpec)) {
    const suffix = info.insufficient ? " (INSUFFICIENT)" : "";
    console.log(`    ${spec}: n=${info.n}${suffix}`);
  }

  // 4. Re-parse selected logs to get full combat objects
  console.log(`\nRe-parsing selected logs for benchmark computation...`);
  const selectedIds = new Set(stratified.selected.map((s) => s.id));
  const matches = [];
  let selectedParsed = 0;

  for (let i = 0; i < logPaths.length; i++) {
    const logPath = logPaths[i];
    try {
      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.split("\n");
      const parser = new GladLogParser();
      const logMatches: any[] = [];

      parser.on("arena_match_ended", (match) => {
        logMatches.push(match);
      });
      parser.on("shuffle_completed", (shuffle) => {
        if (shuffle.rounds) {
          logMatches.push(...shuffle.rounds);
        }
      });

      for (const line of lines) {
        parser.parseLine(line);
      }
      parser.flush();

      // Check if any unit from this log is in selected
      for (const m of logMatches) {
        const legacyMatch = "playerId" in m ? toLegacyMatch(m) : m;
        const allUnits = Object.values(legacyMatch.units);
        for (const unit of allUnits) {
          if (selectedIds.has(`${logPath}:${unit.id}`)) {
            matches.push(legacyMatch);
            selectedParsed++;
            break;
          }
        }
      }
    } catch {
      // Skip failed parses
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  re-parsed ${i + 1} / ${logPaths.length}`);
    }
  }

  // Deduplicate matches
  const uniqueMatches = Array.from(
    new Map(matches.map((m) => [m.id, m])).values(),
  );
  console.log(`  Matched combats: ${uniqueMatches.length} (deduplicated)`);

  // 5. Compute benchmarks
  console.log(`\nComputing benchmarks...`);
  const benchmarkOutput = computeBenchmarks(uniqueMatches, minRating);

  // 6. Write output
  const outputDir = path.dirname(out);
  await fs.ensureDir(outputDir);

  const output = {
    generatedAt: new Date().toISOString(),
    parser: "gladlog",
    minRating,
    sampleSizes: stratified.perSpec,
    ...benchmarkOutput,
  };

  await fs.writeJson(out, output, { spaces: 2 });
  console.log(`\nOutput → ${out}`);

  // 7. Console summary
  const bySpec = benchmarkOutput.bySpec;
  if (Object.keys(bySpec).length > 0) {
    console.log(
      "\n── Pressure P90 (dmg/10s) ──────────────────────────────────────────",
    );
    for (const [spec, s] of Object.entries(bySpec).sort(
      (a, b) => b[1].sampleCount - a[1].sampleCount,
    )) {
      const p90 = Math.round(s.pressureWindows.p90 / 1000);
      const hpsStr = s.hps ? `  HPS p50: ${Math.round(s.hps.p50 / 1000)}k` : "";
      const durStr = `  matchDur p50: ${Math.round(s.matchDuration.p50)}s`;
      console.log(
        `  ${spec.padEnd(30)} n=${String(s.sampleCount).padEnd(4)} P90: ${p90}k${hpsStr}${durStr}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
