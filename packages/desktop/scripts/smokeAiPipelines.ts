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
import { readFileSync, writeFileSync, mkdirSync } from "fs";
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
import { realClientFactory } from "../src/main/ai";
import {
  loadBundledCorpus,
  gameBuildFromManifest,
} from "../src/main/corpusLoader";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const KEY = process.env.ANTHROPIC_API_KEY ?? null;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const MODE = process.env.MODE ?? (KEY ? "live" : "dump");
const DIR = process.env.DUMP_DIR ?? "/tmp/smoke-replay";

// A client that CAPTURES the prompt the service built (dump mode).
function captureClient(sink: { prompt?: string }): any {
  return {
    stream(p: any) {
      sink.prompt = p.messages[0].content;
      return (async function* () {})();
    },
  };
}
// A client that INJECTS a canned response as the LLM stream (replay mode).
function injectClient(text: string): any {
  return {
    stream() {
      return (async function* () {
        if (text) yield { delta: text };
      })();
    },
  };
}
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

const corpusPath = () =>
  join(__dirname, "../../corpus-tools/data/reference_vectors.json");
const loadCorpus = loadBundledCorpus(corpusPath);
function manifestBuild(): string {
  try {
    return gameBuildFromManifest(
      JSON.parse(
        readFileSync(
          join(__dirname, "../../analysis/src/data/datagen-manifest.json"),
          "utf-8",
        ),
      ),
    );
  } catch {
    return "0.0.0.0";
  }
}
const getSettings = () => ({
  anthropicApiKey: KEY ?? "replay-dummy",
  anthropicModel: MODEL,
  wowDirectory: null,
  aiBackend:
    (process.env.AI_BACKEND as "anthropic" | "claudeCli" | "agy" | undefined) ??
    "anthropic",
  aiBackendCommand: null,
});

async function deriveInputs() {
  const logText = await fetchOneLog();
  const { round, healer, players } = firstHealerRound(logText);
  const spec = specToString(healer.spec);
  const bracket = round.startInfo?.bracket ?? "Rated Solo Shuffle";
  const enemies = players.filter((u: any) => u.reaction !== healer.reaction);
  const friends = players.filter((u: any) => u.reaction === healer.reaction);
  const archetype = enemyCompArchetype(enemies);
  const candidates = extractCandidateFindings(round);
  const richContext = buildMatchContext(round, friends, enemies, {
    useTimelinePrompt: true,
  });
  const metrics = computeHealerMetrics(round, healer.name);
  const talents = (healer.info?.talents ?? [])
    .map((t: any) => t.id1)
    .filter(Boolean);
  const analysisInput = { matchId: "smoke", candidates, richContext, spec };
  const compareInput = {
    matchId: "smoke",
    healerMetrics: metrics as any,
    spec,
    talents,
    bracket,
    archetype,
    wowBuild: manifestBuild(),
  };
  return {
    analysisInput,
    compareInput,
    meta: { spec, bracket, archetype, healer: healer.name, candidates },
  };
}

async function runAnalysis(input: any, clientFactory: any) {
  const c = collector();
  const s = createAnalysisService({
    getSettings,
    clientFactory,
    matchesDir: "/tmp/smoke-a",
    emit: c.emit,
  });
  await s.run(input);
  return c;
}
async function runCompare(input: any, clientFactory: any) {
  const c = collector();
  const s = createCompareService({
    getSettings,
    clientFactory,
    loadCorpus,
    gameBuild: manifestBuild,
    matchesDir: "/tmp/smoke-c",
    emit: c.emit,
  });
  await s.run(input);
  return c;
}

async function dump() {
  const { analysisInput, compareInput, meta } = await deriveInputs();
  console.log(
    `match: ${meta.spec} | ${meta.bracket} | ${meta.archetype} | healer=${meta.healer}`,
  );
  console.log(
    `candidate events: ${meta.candidates.length} (${[...new Set(meta.candidates.map((c: any) => c.type))].join(", ") || "none"})`,
  );
  const aSink: { prompt?: string } = {};
  const cSink: { prompt?: string } = {};
  await runAnalysis(analysisInput, () => captureClient(aSink));
  await runCompare(compareInput, () => captureClient(cSink));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    join(DIR, "inputs.json"),
    JSON.stringify({ analysisInput, compareInput }),
  );
  writeFileSync(
    join(DIR, "analysisPrompt.txt"),
    aSink.prompt ?? "(no analysis prompt — no candidates/cohort)",
  );
  writeFileSync(
    join(DIR, "comparePrompt.txt"),
    cSink.prompt ?? "(no compare prompt — no cohort)",
  );
  console.log(`\n=== DUMPED to ${DIR} ===`);
  console.log(`  inputs.json, analysisPrompt.txt, comparePrompt.txt`);
  console.log(
    `Have a response-agent answer each prompt, save to RESP_ANALYSIS / RESP_COMPARE, then:`,
  );
  console.log(
    `  MODE=replay RESP_ANALYSIS=<file> RESP_COMPARE=<file> npx tsx scripts/smokeAiPipelines.ts`,
  );
}

async function replay() {
  const { analysisInput, compareInput } = JSON.parse(
    readFileSync(join(DIR, "inputs.json"), "utf-8"),
  );
  const respA = process.env.RESP_ANALYSIS
    ? readFileSync(process.env.RESP_ANALYSIS, "utf-8")
    : "";
  const respC = process.env.RESP_COMPARE
    ? readFileSync(process.env.RESP_COMPARE, "utf-8")
    : "";

  console.log(`\n--- ANALYSIS (replaying response-agent output) ---`);
  const aCol = await runAnalysis(analysisInput, () => injectClient(respA));
  const aDone = aCol.events.find((e) => e.ch === "gladlog:analysis:done")?.p
    ?.result;
  const aErr = aCol.events.find((e) => e.ch === "gladlog:analysis:error")?.p;
  if (aErr) console.log(`analysis ERROR: ${aErr.message}`);
  else {
    console.log(
      `hadNarration: ${aDone.hadNarration} | findings kept: ${aDone.findings.length} | dropped: ${aDone.dropped}`,
    );
    for (const f of aDone.findings)
      console.log(
        `  [${f.severity}] ${f.category}: ${f.title}\n     ${f.explanation}`,
      );
    if (aDone.findings.length === 0)
      console.log(
        `  (all findings dropped by the honesty gate — see the response for raw digits / causal claims / bad eventIds)`,
      );
  }

  console.log(`\n--- COMPARE (replaying response-agent output) ---`);
  const cCol = await runCompare(compareInput, () => injectClient(respC));
  const cDone = cCol.events.find((e) => e.ch === "gladlog:compare:done")?.p
    ?.result;
  const cErr = cCol.events.find((e) => e.ch === "gladlog:compare:error")?.p;
  if (cErr) console.log(`compare ERROR: ${cErr.message}`);
  else {
    const m = cDone.cellMeta;
    console.log(
      `cohort cell: ${m ? `${m.buildGroup} build · ${m.archetype} · N=${m.sampleN}` : "NO COHORT"}`,
    );
    console.log(
      `report: ${cDone.report ?? `(dropped: ${cDone.droppedReason})`}`,
    );
  }
  console.log(`\n=== replay done ===`);
}

async function live() {
  const { analysisInput, compareInput, meta } = await deriveInputs();
  console.log(
    `match: ${meta.spec} | ${meta.bracket} | ${meta.archetype} | healer=${meta.healer}`,
  );
  const factory = (k: string) => realClientFactory(k);
  const aCol = await runAnalysis(analysisInput, factory);
  const aDone = aCol.events.find((e) => e.ch === "gladlog:analysis:done")?.p
    ?.result;
  console.log(
    `ANALYSIS: hadNarration=${aDone?.hadNarration} kept=${aDone?.findings.length} dropped=${aDone?.dropped}`,
  );
  (aDone?.findings ?? []).forEach((f: any) =>
    console.log(`  [${f.severity}] ${f.title} — ${f.explanation}`),
  );
  const cCol = await runCompare(compareInput, factory);
  const cDone = cCol.events.find((e) => e.ch === "gladlog:compare:done")?.p
    ?.result;
  console.log(
    `COMPARE: ${cDone?.report ?? `(dropped: ${cDone?.droppedReason})`}`,
  );
}

// Like live(), but injects NO clientFactory — the services call resolveAiClient
// with getSettings().aiBackend (set via AI_BACKEND=agy|claudeCli), exercising the
// real local-CLI backend end-to-end: real match → prompt → local model → gates.
async function local() {
  const { analysisInput, compareInput, meta } = await deriveInputs();
  console.log(
    `match: ${meta.spec} | ${meta.bracket} | ${meta.archetype} | healer=${meta.healer} | backend=${process.env.AI_BACKEND ?? "anthropic"}`,
  );
  const aCol = await runAnalysis(analysisInput, undefined);
  const aDone = aCol.events.find((e) => e.ch === "gladlog:analysis:done")?.p
    ?.result;
  const aErr = aCol.events.find((e) => e.ch === "gladlog:analysis:error")?.p;
  if (aErr) console.log(`ANALYSIS ERROR: ${aErr.message}`);
  console.log(
    `ANALYSIS: hadNarration=${aDone?.hadNarration} kept=${aDone?.findings.length} dropped=${aDone?.dropped}`,
  );
  (aDone?.findings ?? []).forEach((f: any) =>
    console.log(`  [${f.severity}] ${f.title} — ${f.explanation}`),
  );
  const cCol = await runCompare(compareInput, undefined);
  const cDone = cCol.events.find((e) => e.ch === "gladlog:compare:done")?.p
    ?.result;
  const cErr = cCol.events.find((e) => e.ch === "gladlog:compare:error")?.p;
  if (cErr) console.log(`COMPARE ERROR: ${cErr.message}`);
  console.log(
    `COMPARE: ${cDone?.report ?? `(dropped: ${cDone?.droppedReason})`}`,
  );
}

async function main() {
  console.log(`\n=== SP-A/SP-B2 smoke (MODE=${MODE}) ===`);
  if (MODE === "dump") return dump();
  if (MODE === "replay") return replay();
  if (MODE === "local") return local();
  return live();
}
main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
