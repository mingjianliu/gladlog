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
import { isHealerSpec, specToString } from "../src/utils/cooldowns";
import {
  createBenchmarkAccumulator,
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
  // 两趟设计:pass1 只留映射(避免整语料 legacy 对局驻留内存)
  const sampleToCombat = new Map<string, string>();
  const combatToLog = new Map<string, string>();
  let parsed = 0;
  let failed = 0;

  for (let i = 0; i < logPaths.length; i++) {
    const logPath = logPaths[i];
    try {
      const content = await fs.readFile(logPath, "utf-8");
      const parser = new GladLogParser();
      const combats: { gladId: string; combat: any }[] = [];
      parser.on("match", (m: any) =>
        combats.push({ gladId: m.id, combat: toLegacyMatch(m) }),
      );
      parser.on("shuffle", (sh: any) => {
        const legacy = toLegacyShuffle(sh);
        (legacy.rounds ?? []).forEach((round: any, idx: number) =>
          combats.push({ gladId: sh.rounds[idx]?.id ?? `${sh.rounds[0]?.id}-r${idx}`, combat: round }),
        );
      });
      for (const line of content.split("\n")) parser.push(line);
      parser.end();

      for (const { gladId, combat } of combats) {
        combatToLog.set(gladId, logPath);
        const units: any[] = Object.values(combat.units);
        const players = units.filter((u) => u.info);
        for (const unit of players) {
          if ((unit.info?.personalRating ?? 0) < minRating) continue;
          const spec = specToString(unit.spec) || String(unit.spec);
          const team = players.filter((u) => u.info.teamId === unit.info.teamId);
          const healers = team
            .filter((u) => isHealerSpec(u.spec))
            .map((u) => specToString(u.spec) || String(u.spec))
            .sort();
          const archetype = `${healers.join("+") || "no-healer"}/${team.length - healers.length}`;
          const sampleId = `${gladId}:${unit.id}`;
          pool.push({ id: sampleId, spec, archetype });
          sampleToCombat.set(sampleId, gladId);
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

  // 4. pass2:仅重析入选对局所在文件
  const selectedCombatIds = new Set(
    stratified.selected.map((sel) => sampleToCombat.get(sel.id)).filter(Boolean),
  );
  const selectedLogs = new Set(
    [...selectedCombatIds].map((id) => combatToLog.get(id as string)).filter(Boolean),
  );
  console.log(`  Re-parsing ${selectedLogs.size} selected logs...`);
  const benchAcc = createBenchmarkAccumulator(minRating);
  let matchedCount = 0;
  const seen = new Set<string>();
  for (const logPath of selectedLogs) {
    try {
      const content = await fs.readFile(logPath as string, "utf-8");
      const parser = new GladLogParser();
      parser.on("match", (m: any) => {
        if (selectedCombatIds.has(m.id) && !seen.has(m.id)) {
          seen.add(m.id);
          benchAcc.add(toLegacyMatch(m));
          matchedCount++;
        }
      });
      parser.on("shuffle", (sh: any) => {
        const legacy = toLegacyShuffle(sh);
        (legacy.rounds ?? []).forEach((round: any, idx: number) => {
          const gid = sh.rounds[idx]?.id;
          if (gid && selectedCombatIds.has(gid) && !seen.has(gid)) {
            seen.add(gid);
            benchAcc.add(round);
            matchedCount++;
          }
        });
      });
      for (const line of content.split("\n")) parser.push(line);
      parser.end();
    } catch {
      /* skip */
    }
  }
  console.log(`  Matched combats: ${matchedCount} (deduplicated)`);

  // 5. Compute benchmarks
  console.log(`\nComputing benchmarks...`);
  const benchmarkOutput = benchAcc.finalize();

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
