/**
 * decisionTraceCapture.ts — replay a manifest under ONE fact configuration and
 * write every traced decision opportunity as JSONL (GH #96 D6).
 *
 * The configuration comes from GLADLOG_FACT_CONFIG (read once, immutable for
 * the process — packages/analysis/src/facts/factProviderConfig.ts), so two
 * child processes replay identical inputs under two configurations without any
 * per-consumer branch. decisionDiff.ts drives it.
 *
 * Inputs are the same as acceptanceCapture.ts (every friendly owner of every
 * round), but failures are NOT silently skipped: a candidate-extraction
 * exception writes one `evaluation-error` line for that input, so the diff can
 * tell "removed" from "crashed on one side".
 *
 * Usage:
 *   GLADLOG_FACT_CONFIG='{"temporaryModifierUncertainty":true}' \
 *   npx tsx packages/eval/scripts/decisionTraceCapture.ts \
 *     --manifest <manifest> [--every 30] --out <trace.jsonl>
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import {
  type DecisionRecord,
  setDecisionSink,
} from "@gladlog/analysis/src/facts/decisionTrace";
import { getFactConfig } from "@gladlog/analysis/src/facts/factProviderConfig";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { createWriteStream, readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));
const outPath = arg("--out", "");
if (!manifest || !outPath) {
  console.error(
    "usage: decisionTraceCapture.ts --manifest <path> [--every N] --out <trace.jsonl>",
  );
  process.exit(1);
}

await ensureAnalysisData();
const config = getFactConfig();
const out = createWriteStream(outPath);
out.write(`${JSON.stringify({ _config: config })}\n`);

let current = { input: "", spec: "", bracket: "" };
// Records are buffered per input and reconciled with the FINAL candidate list:
// extractCandidateFindings applies a per-bracket allow-list after every
// producer ran (GH #18 ruling 2026-08-30), so a producer's "emitted" can still
// be dropped. The trace must report what the product actually emits.
let buffer: DecisionRecord[] = [];
setDecisionSink((r: DecisionRecord) => buffer.push(r));
const TRACED_TYPES = new Set<string>();
let inconsistencies = 0;
const flush = (finalIds: Set<string> | null) => {
  for (const r of buffer) {
    TRACED_TYPES.add(r.type);
    let rec = r;
    if (finalIds && r.verdict === "emitted") {
      const kept = r.candidateIds.filter((id) => finalIds.has(id));
      if (kept.length === 0)
        rec = {
          ...r,
          verdict: "suppressed",
          reason: "post-filter",
          candidateIds: [],
        };
      else if (kept.length !== r.candidateIds.length)
        rec = { ...r, candidateIds: kept };
    }
    out.write(
      `${JSON.stringify({
        ...rec,
        opportunityId: `${current.input}|${rec.opportunityId}`,
        input: current.input,
        spec: current.spec,
        bracket: current.bracket,
      })}\n`,
    );
  }
  buffer = [];
};

const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

let owners = 0;
let errors = 0;
for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  let idx = 0;
  for (const m of items) {
    idx++;
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue; // unparseable round: identical on both sides, no opportunity
    }
    const { friends } = splitTeams(legacy);
    const bracket = String(legacy.startInfo?.bracket ?? "?");
    for (const owner of friends) {
      owners++;
      current = {
        input: `${f}#${idx}#${owner.id}`,
        spec: String(owner.spec),
        bracket,
      };
      try {
        const cands = extractCandidateFindings(legacy, owner.id);
        const finalIds = new Set(cands.map((c) => c.id));
        // consistency: every final candidate of a traced type must come from
        // a traced "emitted" opportunity, else the instrumentation drifted
        const tracedEmitted = new Set(
          buffer
            .filter((r) => r.verdict === "emitted")
            .flatMap((r) => r.candidateIds),
        );
        const tracedTypes = new Set(buffer.map((r) => r.type));
        for (const c of cands)
          if (tracedTypes.has(c.type) && !tracedEmitted.has(c.id)) {
            inconsistencies++;
            out.write(
              `${JSON.stringify({
                opportunityId: `${current.input}|untraced:${c.id}`,
                input: current.input,
                type: c.type,
                ownerId: owner.id,
                spec: current.spec,
                bracket,
                verdict: "evaluation-error",
                reason: "candidate-without-traced-opportunity",
                facts: {},
                candidateIds: [c.id],
              })}\n`,
            );
          }
        flush(finalIds);
      } catch (e) {
        buffer = [];
        errors++;
        out.write(
          `${JSON.stringify({
            opportunityId: `${current.input}|evaluation`,
            input: current.input,
            type: "*",
            ownerId: owner.id,
            spec: current.spec,
            bracket,
            verdict: "evaluation-error",
            reason: String((e as Error)?.message ?? e).slice(0, 200),
            facts: {},
            candidateIds: [],
          })}\n`,
        );
      }
    }
  }
}
setDecisionSink(null);
out.end(() =>
  console.log(
    JSON.stringify({
      files: files.length,
      owners,
      errors,
      inconsistencies,
      tracedTypes: [...TRACED_TYPES],
      config,
    }),
  ),
);
