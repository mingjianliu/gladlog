/**
 * decisionTraceCount.ts — count GH #96 D6 decision-trace records per
 * (candidate type, verdict, reason) over a manifest, as the app runs the
 * candidate layer (raw streams on).
 *
 * Born 2026-09-25 (reliability audit A2b): an acceptance capture only sees
 * EMITTED candidates, so a feasibility filter that removes points which were
 * already beyond the cap moves no candidate id — crisis-no-response went
 * 12 → 12 on the 605-file slice while the trace showed 3 crossings newly
 * suppressed as `wall-active`. This is how to tell "the filter never fires"
 * from "it fires below the cap".
 *
 * Usage:
 *   npx tsx packages/eval/scripts/decisionTraceCount.ts --manifest <file> \
 *     [--every N] [--types cd-hoarded,crisis-no-response] [--healers-only]
 */
import { extractCandidateFindings } from "@gladlog/analysis/src/analysis/candidateFindings";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { setDecisionSink } from "@gladlog/analysis/src/facts/decisionTrace";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { parseRawStreams } from "@gladlog/analysis/src/utils/rawStreams";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const manifest = flag("--manifest");
if (!manifest) {
  console.error(
    "usage: decisionTraceCount.ts --manifest <file> [--every N] [--types a,b] [--healers-only]",
  );
  process.exit(1);
}
const every = Number(flag("--every") ?? 1);
const types = new Set((flag("--types") ?? "").split(",").filter(Boolean));
const healersOnly = argv.includes("--healers-only");

await ensureAnalysisData();
const counts = new Map<string, number>();
setDecisionSink((r) => {
  if (types.size && !types.has(r.type)) return;
  const k = `${r.type}  ${r.verdict}  ${r.reason ?? ""}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
});

const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);
let owners = 0;
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const raw = parseRawStreams(
      text,
      legacy.startTime ?? 0,
      ((legacy.endTime ?? 0) - (legacy.startTime ?? 0)) / 1000,
    );
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (u.type !== 1 || !u.info) continue;
      if (healersOnly && !isHealerSpec(u.spec)) continue;
      owners++;
      try {
        extractCandidateFindings(legacy, u.id, raw);
      } catch {
        /* not computable → no records */
      }
    }
  }
}
console.log(`files=${files.length} owners=${owners}`);
for (const [k, v] of [...counts].sort())
  console.log(`${String(v).padStart(7)}  ${k}`);
