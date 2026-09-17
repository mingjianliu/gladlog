/**
 * teammateCrisisCardDump.ts — value gate for `teammate-crisis-idle` (GH #95,
 * CLAUDE.md Value-Gate rule 1: a complete real-match output example before
 * anything else). Walks a manifest slice, runs the shipped candidate
 * assembly for every healer owner and prints every teammate-crisis-idle
 * CandidateEvent as the menu line the model sees (facts block), plus the
 * archive file / owner / bracket so a human can open the round.
 *
 * Usage: npx tsx packages/eval/scripts/teammateCrisisCardDump.ts --manifest <m> [--every 30] [--max 20]
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
} from "@gladlog/analysis";
import { serializeFactsBlock } from "@gladlog/analysis/src/analysis/factFormat";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));
const max = Number(arg("--max", "20"));

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

let printed = 0;
let rounds = 0;
for (const f of files) {
  if (printed >= max) break;
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
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    for (const owner of (Object.values(legacy.units ?? {}) as any[]).filter(
      (u) => u.info && isHealerSpec(u.spec),
    )) {
      let cands;
      try {
        cands = extractCandidateFindings(legacy, owner.id);
      } catch {
        continue;
      }
      for (const c of cands) {
        if (c.type !== "teammate-crisis-idle") continue;
        printed++;
        console.log(
          `--- ${f.split("/").slice(-1)[0]} | ${legacy.startInfo?.bracket} | owner ${owner.name} (${owner.spec}) | round ${Math.round((legacy.endTime - legacy.startTime) / 1000)}s`,
        );
        console.log(
          `  - id=${c.id} type=${c.type} t=${c.t} facts={${serializeFactsBlock(c.facts ?? {})}}`,
        );
      }
    }
  }
}
console.error(`[dump] ${printed} cards in ${rounds} rounds`);
