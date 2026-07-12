/**
 * Live end-to-end smoke test for the SP-A (analysis) + SP-B2 (compare) pipelines.
 * Fetches ONE real 2300+ Solo Shuffle log, parses it, and runs both main-process
 * services through the REAL Anthropic client, printing what the LLM produced and
 * what the honesty gates dropped.
 *
 * Run it yourself (so the key never leaves your shell):
 *   ! cd packages/desktop && ANTHROPIC_API_KEY=sk-... npx tsx scripts/smokeAiPipelines.ts
 *
 * Optional: ANTHROPIC_MODEL (default claude-sonnet-5), LOG_PATH (use a local raw
 * combat log instead of the feed).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { GladLogParser } from "@gladlog/parser";
import {
  toLegacyShuffle,
  toLegacyMatch,
  CombatUnitReaction,
} from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  buildMatchContext,
  computeHealerMetrics,
  specToString,
  isHealerSpec,
  enemyCompArchetype,
} from "@gladlog/analysis";
import { createAnalysisService } from "../src/main/analysis";
import { createCompareService } from "../src/main/compare";
import {
  loadBundledCorpus,
  gameBuildFromManifest,
} from "../src/main/corpusLoader";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const KEY = process.env.ANTHROPIC_API_KEY ?? null;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const FEED = "https://wowarenalogs.com/api/graphql";
const STUBS_QUERY = `query Q($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating) {
    combats { ... on ArenaMatchDataStub { id logObjectUrl } ... on ShuffleRoundStub { id logObjectUrl } }
  }
}`;

async function fetchOneLog(): Promise<string> {
  if (process.env.LOG_PATH) return readFileSync(process.env.LOG_PATH, "utf-8");
  const fetch = (await import("node-fetch")).default as any;
  const res = await fetch(FEED, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: STUBS_QUERY,
      variables: {
        wowVersion: "retail",
        bracket: "Rated Solo Shuffle",
        offset: 0,
        count: 5,
        minRating: 2300,
      },
    }),
  });
  const stubs = (await res.json())?.data?.latestMatches?.combats ?? [];
  if (stubs.length === 0) throw new Error("feed returned no stubs");
  const logRes = await fetch(stubs[0].logObjectUrl);
  return await logRes.text();
}

function firstHealerRound(logText: string): any {
  const parser = new GladLogParser();
  const rounds: any[] = [];
  parser.on("shuffle", (sh: any) =>
    (toLegacyShuffle(sh).rounds ?? []).forEach((r: any) => rounds.push(r)),
  );
  parser.on("match", (m: any) => rounds.push(toLegacyMatch(m)));
  for (const line of logText.split("\n")) parser.push(line);
  parser.end();
  for (const r of rounds) {
    const players = (Object.values(r.units) as any[]).filter((u) => u.info);
    const healer = players.find(
      (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
    );
    if (healer) return { round: r, healer, players };
  }
  throw new Error("no round with a Friendly healer found");
}

function collector() {
  const events: Array<{ ch: string; p: any }> = [];
  return {
    emit: (ch: string, p: unknown) => events.push({ ch, p: p as any }),
    events,
  };
}

async function main() {
  console.log(
    `\n=== SP-A/SP-B2 live smoke (model=${MODEL}, key=${KEY ? "set" : "MISSING"}) ===`,
  );
  if (!KEY)
    console.log(
      "!! ANTHROPIC_API_KEY not set — services will take the no-key deterministic path.\n",
    );

  const logText = await fetchOneLog();
  console.log(`log: ${(logText.length / 1e6).toFixed(1)}MB`);
  const { round, healer, players } = firstHealerRound(logText);
  const spec = specToString(healer.spec);
  const bracket = round.startInfo?.bracket ?? "Rated Solo Shuffle";
  const enemies = players.filter((u: any) => u.reaction !== healer.reaction);
  const friends = players.filter((u: any) => u.reaction === healer.reaction);
  const archetype = enemyCompArchetype(enemies);
  console.log(
    `match: ${spec} | ${bracket} | ${archetype} | healer=${healer.name}`,
  );

  const getSettings = () => ({
    anthropicApiKey: KEY,
    anthropicModel: MODEL,
    wowDirectory: null,
  });

  // ---- SP-A: analysis ----
  console.log(`\n--- ANALYSIS ---`);
  const candidates = extractCandidateFindings(round);
  const richContext = buildMatchContext(round, friends, enemies, {
    useTimelinePrompt: true,
  });
  console.log(
    `candidate events: ${candidates.length} (types: ${[...new Set(candidates.map((c) => c.type))].join(", ") || "none"})`,
  );
  const aCol = collector();
  const analysis = createAnalysisService({
    getSettings,
    matchesDir: "/tmp/smoke-a",
    emit: aCol.emit,
  });
  await analysis.run({ matchId: "smoke", candidates, richContext, spec });
  const aDone = aCol.events.find((e) => e.ch === "gladlog:analysis:done")?.p
    ?.result;
  const aErr = aCol.events.find((e) => e.ch === "gladlog:analysis:error")?.p;
  if (aErr) console.log(`analysis ERROR: ${aErr.message}`);
  else {
    console.log(
      `hadNarration: ${aDone.hadNarration} | findings kept: ${aDone.findings.length} | dropped: ${aDone.dropped}`,
    );
    for (const f of aDone.findings.slice(0, 6))
      console.log(
        `  [${f.severity}] ${f.category}: ${f.title}\n     ${f.explanation}`,
      );
  }

  // ---- SP-B2: compare ----
  console.log(`\n--- COMPARE ---`);
  const corpusPath = () =>
    join(__dirname, "../../corpus-tools/data/reference_vectors.json");
  const loadCorpus = loadBundledCorpus(corpusPath);
  let manifest: { build?: string } = {};
  try {
    manifest = JSON.parse(
      readFileSync(
        join(__dirname, "../../analysis/src/data/datagen-manifest.json"),
        "utf-8",
      ),
    );
  } catch {}
  const metrics = computeHealerMetrics(round, healer.name);
  const talents = (healer.info?.talents ?? [])
    .map((t: any) => t.id1)
    .filter(Boolean);
  const cCol = collector();
  const compare = createCompareService({
    getSettings,
    loadCorpus,
    gameBuild: () => gameBuildFromManifest(manifest),
    matchesDir: "/tmp/smoke-c",
    emit: cCol.emit,
  });
  await compare.run({
    matchId: "smoke",
    healerMetrics: metrics as any,
    spec,
    talents,
    bracket,
    archetype,
    wowBuild: gameBuildFromManifest(manifest),
  });
  const cDone = cCol.events.find((e) => e.ch === "gladlog:compare:done")?.p
    ?.result;
  const cErr = cCol.events.find((e) => e.ch === "gladlog:compare:error")?.p;
  if (cErr) console.log(`compare ERROR: ${cErr.message}`);
  else {
    const m = cDone.cellMeta;
    console.log(
      `cohort cell: ${m ? `${m.buildGroup} build · ${m.archetype} · N=${m.sampleN} · fellBackTo=${m.fellBackTo}` : "NO COHORT"}`,
    );
    console.log(
      `dims: ${cDone.verifiedComparison.dims.map((d: any) => `${d.key}=${d.value}(${d.percentile}th)`).join(", ")}`,
    );
    console.log(
      `report: ${cDone.report ?? `(dropped: ${cDone.droppedReason})`}`,
    );
  }
  console.log(`\n=== smoke done ===`);
}
main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
