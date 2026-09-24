/**
 * Positioning grounding scan CLI (backlog #3 hard gate).
 *
 * Usage:
 *   BASE_DIR=<run directory> MANIFEST=<manifest.txt> npx tsx packages/eval/scripts/positioningScan.ts [--mutate]
 *
 * Replays the logs listed in the manifest to rebuild combats (the same path
 * buildCorpus takes), matches each prompt by the matchId in index.json,
 * extracts geometric claims and recomputes them against the raw coordinates.
 * --mutate adds a mutation-sensitivity test (distance +15yd / time +45s,
 * requiring 100% detection).
 * Any violation exits 1. The corpus-level mutation rate is diagnostic only
 * (real movement widens the checked span); the 100 % detection gate lives in
 * the stationary synthetic fixture, packages/eval/test/positioningScan.test.ts.
 */
import fs from "fs-extra";
import path from "path";
import { GladLogParser } from "@gladlog/parser";
import {
  toLegacyMatch,
  toLegacyShuffle,
  CombatUnitReaction,
} from "@gladlog/parser-compat";
import { isHealerSpec } from "@gladlog/analysis";
// The row shape of index.json (including ownerName) is defined single-source by
// buildCorpus — this file used to declare an inline type and hand-add
// ownerName, which meant nothing went red here when whoever writes the index
// added a field.
import type { IndexEntry } from "../src/corpus/buildCorpus";
import {
  checkGeoClaims,
  extractGeoClaims,
  mutationDetectionRate,
} from "../src/quality/positioningScan";

async function main() {
  const baseDir = process.env.BASE_DIR;
  const manifest = process.env.MANIFEST;
  const mutate = process.argv.includes("--mutate");
  if (!baseDir || !manifest) {
    console.error("BASE_DIR and MANIFEST must be set");
    process.exit(1);
  }
  // process.exit(1) above is typed `never`, but that narrowing of `baseDir`
  // to `string` doesn't cross into the nested scanOne() closure below —
  // capture the narrowed value in a new const so it does.
  const dir: string = baseDir;

  // Load the index into a map first (matchId → entry); logs are then parsed
  // one at a time in streaming fashion and discarded once scanned, so nothing
  // OOMs from keeping the whole corpus resident
  const index: IndexEntry[] = await fs.readJson(path.join(dir, "index.json"));
  const entryByMatchId = new Map(index.map((e) => [e.matchId, e]));
  const seen = new Set<string>();

  let totalClaims = 0;
  let totalChecked = 0;
  let totalUnverifiable = 0;
  let totalMutated = 0;
  let totalDetected = 0;
  const mutationByKind: Record<string, { mutated: number; detected: number }> =
    {};
  const allViolations: string[] = [];

  const logPaths = (await fs.readFile(manifest, "utf-8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const pending: Array<{ entry: IndexEntry; combat: any }> = [];
  const collect = (id: string, combat: any) => {
    const entry = entryByMatchId.get(id);
    if (entry) pending.push({ entry, combat });
  };

  for (const logPath of logPaths) {
    try {
      const content = await fs.readFile(logPath, "utf-8");
      const parser = new GladLogParser();
      parser.on("match", (m: any) => collect(m.id, toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        const legacy = toLegacyShuffle(sh);
        (legacy.rounds ?? []).forEach((round: any, idx: number) => {
          const id = sh.rounds[idx]?.id ?? `${sh.rounds[0]?.id}-r${idx}`;
          collect(id, round);
        });
      });
      for (const line of content.split("\n")) parser.push(line);
      parser.end();
    } catch (err) {
      console.warn(`WARN: ${logPath}: ${err}`);
    }

    // Scan this log's matches immediately and release them
    while (pending.length > 0) {
      const { entry, combat } = pending.shift()!;
      seen.add(entry.matchId);
      await scanOne(entry, combat);
    }
  }

  const matchesMissing = index.length - seen.size;

  async function scanOne(entry: IndexEntry, combat: any) {
    const promptText = await fs.readFile(path.join(dir, entry.file), "utf-8");
    const { claims, unitIdMap } = extractGeoClaims(promptText);
    if (claims.length === 0) return;
    totalClaims += claims.length;

    const units: any[] = Object.values(combat.units);
    const players = units.filter((u) => u.info);
    // owner = the prompt's protagonist as recorded in the corpus index (D2:
    // distance claims in a DPS corpus are from the DPS's perspective, so
    // recomputing them against the healer's coordinates yields nothing but
    // false violations); an old corpus without ownerName falls back to the
    // friendly healer (the original behaviour).
    const owner =
      (entry.ownerName
        ? players.find(
            (u) =>
              u.name === entry.ownerName &&
              u.reaction === CombatUnitReaction.Friendly,
          )
        : undefined) ??
      players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
    if (!owner) return;
    const ctx = {
      owner,
      friends: players.filter((u) => u.reaction === owner.reaction),
      enemies: players.filter((u) => u.reaction !== owner.reaction),
      zoneId: String(combat.startInfo?.zoneId ?? ""),
      matchStartMs: combat.startTime,
      unitIdMap,
    };

    const result = checkGeoClaims(claims, ctx);
    totalChecked += result.checked;
    totalUnverifiable += result.unverifiable;
    for (const v of result.violations) {
      allViolations.push(
        `${entry.file}:${v.claim.lineNo} [${v.code}] ${v.detail}\n      ${v.claim.raw.trim().slice(0, 140)}`,
      );
    }

    if (mutate) {
      const { mutated, detected, byKind } = mutationDetectionRate(claims, ctx);
      totalMutated += mutated;
      totalDetected += detected;
      for (const [k, v] of Object.entries(byKind)) {
        const agg = (mutationByKind[k] ??= { mutated: 0, detected: 0 });
        agg.mutated += v.mutated;
        agg.detected += v.detected;
      }
    }
  }

  console.log(
    `Scanned ${index.length} prompts (${matchesMissing} missing from logs): ` +
      `${totalClaims} geo claims, ${totalChecked} checked, ${totalUnverifiable} unverifiable (no coords).`,
  );
  if (mutate) {
    const rate = totalMutated > 0 ? (100 * totalDetected) / totalMutated : 100;
    console.log(
      `Mutation sensitivity: ${totalDetected}/${totalMutated} detected (${rate.toFixed(1)}%).`,
    );
    for (const [k, v] of Object.entries(mutationByKind))
      console.log(
        `  ${k}: ${v.detected}/${v.mutated} (${((100 * v.detected) / Math.max(1, v.mutated)).toFixed(1)}%)`,
      );
    // The corpus-level mutation rate is affected by real movement noise and is
    // diagnostic only; the hard gate on detection rate is carried by the
    // synthetic-fixture unit test (packages/eval/test/positioningScan.test.ts,
    // where units are stationary so every mutation must be detected).
  }
  if (allViolations.length > 0) {
    console.error(`\n${allViolations.length} VIOLATION(S):`);
    for (const v of allViolations) console.error("  " + v);
    process.exit(1);
  }
  console.log("Grounding gate: 0 violations.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
