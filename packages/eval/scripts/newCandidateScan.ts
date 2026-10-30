 
/**
 * Corpus-empirical scan of the three new candidate types (arenacoach batch 1
 * Task 6): quantify the occurrence rate of death-unused-defensive /
 * external-unused / wasted-trinket on the real corpus (matches with at least
 * one occurrence / applicable denominator / entries per match), and export the
 * top 5 entries per type with full facts plus their provenance (log path +
 * match/round start time) for manual spot checks.
 *
 * Definition of the applicable denominator (task-6-brief.md Step 1):
 *  - death-unused-defensive: the owner died in this match
 *  - external-unused:        a teammate (not the owner) died in this match AND
 *                            the owner has an external (at least one big CD in
 *                            the kit passing isAllyCastableDefensive; it need
 *                            not have been used)
 *  - wasted-trinket:         the owner used a PvP trinket in this match
 *                            (trinketUseTimes non-empty)
 *
 * Owner resolution matches the candidateFindings gate (playerId first, falling
 * back to the friendly healer) — it mirrors the existing logic in
 * packages/desktop/.../report/derive/analysisInput.ts and
 * packages/eval/scripts/confidenceAudit.ts; do not start a second copy.
 *
 * Usage: npx tsx packages/eval/scripts/newCandidateScan.ts --manifest <file>
 */
import {
  analyzePlayerCCAndTrinket,
  type CandidateEvent,
  ensureAnalysisData,
  extractCandidateFindings,
  extractMajorCooldowns,
  isAllyCastableDefensive,
  isHealerSpec,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction,toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import path from "path";

function parseArgs(): { manifest: string } {
  const a = process.argv.slice(2);
  let manifest = "";
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") manifest = a[i + 1] ?? "";
  }
  if (!manifest) {
    console.error("Usage: newCandidateScan --manifest <file>");
    process.exit(1);
  }
  return { manifest };
}

const TYPES = [
  "death-unused-defensive",
  "external-unused",
  "wasted-trinket",
] as const;
type TType = (typeof TYPES)[number];

const SAMPLE_CAP = 5;

interface Sample {
  source: string;
  facts: Record<string, string>;
}

interface TypeStats {
  applicableMatches: number;
  matchesWithEmit: number;
  totalEvents: number;
  samples: Sample[];
}

function freshStats(): TypeStats {
  return {
    applicableMatches: 0,
    matchesWithEmit: 0,
    totalEvents: 0,
    samples: [],
  };
}

async function main() {
  const { manifest } = parseArgs();
  await ensureAnalysisData();

  const files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const stats: Record<TType, TypeStats> = {
    "death-unused-defensive": freshStats(),
    "external-unused": freshStats(),
    "wasted-trinket": freshStats(),
  };

  let logsRead = 0;
  let logsUnreadable = 0;
  let matchesTotal = 0;
  let matchesNoOwner = 0;
  let matchesFailed = 0;

  for (const [fileIdx, f] of files.entries()) {
    const t0 = Date.now();
    let content: string;
    try {
      content = readFileSync(f, "utf8");
      logsRead++;
    } catch {
      console.error(`skip unreadable log: ${f}`);
      logsUnreadable++;
      continue;
    }
    // Progress logging (needed for diagnosis: 70 logs, individually up to
    // hundreds of MB — without per-file output there is no way to tell a hang
    // or OOM from a run that is simply still going).
    console.log(
      `[${fileIdx + 1}/${files.length}] ${path.basename(f)} (${(content.length / 1e6).toFixed(1)}MB) …`,
    );

    const parser = new GladLogParser();
    const items: GladMatch[] = [];
    parser.on("match", (m) => items.push(m));
    parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
    for (const line of content.split("\n")) parser.push(line);
    parser.end();
    // content and the per-line array are only needed within this iteration;
    // release the reference explicitly so resident memory does not accumulate
    // across 70 large logs (the old content should be GC-able before the next
    // readFileSync).
    content = "";

    console.log(
      `  parsed: ${items.length} match/round(s), ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    items.forEach((m, idx) => {
      try {
        const legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
        const units = Object.values(legacy.units);
        const players = units.filter((u) => u.info);
        const owner =
          players.find(
            (u) =>
              u.id === legacy.playerId &&
              u.reaction === CombatUnitReaction.Friendly,
          ) ??
          players.find(
            (u) =>
              isHealerSpec(u.spec) &&
              u.reaction === CombatUnitReaction.Friendly,
          );
        matchesTotal++;
        if (!owner) {
          matchesNoOwner++;
          return;
        }

        const source = `${path.basename(f)}#${idx} start=${new Date(legacy.startTime).toISOString()}`;
        const candidates = extractCandidateFindings(legacy, owner.id);

        // --- denominator: death-unused-defensive (the owner died this match) ---
        const ownerDied =
          (legacy.units[owner.id]?.deathRecords ?? []).length > 0;
        if (ownerDied) stats["death-unused-defensive"].applicableMatches++;

        // --- denominator: external-unused (a teammate died AND the owner has an external) ---
        const friends = players.filter((u) => u.reaction === owner.reaction);
        const enemies = players.filter((u) => u.reaction !== owner.reaction);
        const teammateDied = friends.some(
          (u) => u.id !== owner.id && (u.deathRecords ?? []).length > 0,
        );
        let ownerHasExternal = false;
        try {
          ownerHasExternal = extractMajorCooldowns(owner, legacy).some((cd) =>
            isAllyCastableDefensive(cd.spellId),
          );
        } catch {
          /* CD summary not computable → conservatively assume no external */
        }
        if (teammateDied && ownerHasExternal)
          stats["external-unused"].applicableMatches++;

        // --- denominator: wasted-trinket (the owner used a trinket this match) ---
        let ownerUsedTrinket = false;
        try {
          const enemyIds = new Set(enemies.map((u) => u.id));
          const enemyPets = units.filter(
            (u) => u.ownerId && enemyIds.has(u.ownerId),
          );
          ownerUsedTrinket =
            analyzePlayerCCAndTrinket(owner, enemies, legacy, enemyPets)
              .trinketUseTimes.length > 0;
        } catch {
          /* CC/trinket summary not computable → conservatively assume unused */
        }
        if (ownerUsedTrinket) stats["wasted-trinket"].applicableMatches++;

        // --- counting and sampling ---
        const byType = new Map<string, CandidateEvent[]>();
        for (const c of candidates) {
          if (!TYPES.includes(c.type as TType)) continue;
          const arr = byType.get(c.type) ?? [];
          arr.push(c);
          byType.set(c.type, arr);
        }
        for (const t of TYPES) {
          const evs = byType.get(t) ?? [];
          if (evs.length === 0) continue;
          const s = stats[t];
          s.matchesWithEmit++;
          s.totalEvents += evs.length;
          if (s.samples.length < SAMPLE_CAP) {
            s.samples.push({ source, facts: evs[0]!.facts });
          }
        }
      } catch (err) {
        matchesFailed++;
        console.error(`  match #${idx} failed: ${(err as Error).message}`);
      }
    });
    console.log(
      `  done: total=${matchesTotal} no-owner=${matchesNoOwner} failed=${matchesFailed} (${((Date.now() - t0) / 1000).toFixed(1)}s file total)`,
    );
  }

  console.log(
    `logs: read=${logsRead} unreadable=${logsUnreadable}; matches: total=${matchesTotal} no-owner=${matchesNoOwner} failed=${matchesFailed}`,
  );
  console.log();
  console.log(
    "type".padEnd(26) +
      "emit-matches".padEnd(14) +
      "applicable".padEnd(12) +
      "rate".padEnd(9) +
      "events".padEnd(9) +
      "events/applicable",
  );
  for (const t of TYPES) {
    const s = stats[t];
    const rate =
      s.applicableMatches > 0
        ? ((100 * s.matchesWithEmit) / s.applicableMatches).toFixed(1) + "%"
        : "n/a(denom=0)";
    const perApplicable =
      s.applicableMatches > 0
        ? (s.totalEvents / s.applicableMatches).toFixed(2)
        : "n/a";
    console.log(
      t.padEnd(26) +
        String(s.matchesWithEmit).padEnd(14) +
        String(s.applicableMatches).padEnd(12) +
        rate.padEnd(9) +
        String(s.totalEvents).padEnd(9) +
        perApplicable,
    );
  }

  for (const t of TYPES) {
    console.log(`\n=== ${t}: 抽检样本(前 ${SAMPLE_CAP}) ===`);
    stats[t].samples.forEach((s, i) => {
      console.log(`  [${i + 1}] ${s.source}`);
      console.log(`      facts = ${JSON.stringify(s.facts)}`);
    });
    if (stats[t].samples.length === 0) console.log("  (无样本)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
