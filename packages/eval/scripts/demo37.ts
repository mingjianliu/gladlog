/**
 * #37 value-gate demo: build cells from real archive healer rounds through the
 * REAL pipeline (buildPerMatchRecords → aggregateCells, hero-group default),
 * then print (a) the hero-split cells and (b) the exemplar prompt's rotation
 * section for the biggest one — the user judges the text form.
 *
 * Rating floor deliberately skipped: this is a form demo, not the production
 * corpus (that regen runs through buildCorpus.ts against the 2300+ feed).
 *
 * Usage: npx tsx packages/eval/scripts/demo37.ts <archiveRoot> [files]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  buildExemplarLedPrompt,
  ensureAnalysisData,
  ensureHeroTalents,
} from "@gladlog/analysis";

import { aggregateCells } from "../../corpus-tools/src/cellAggregator";
import { buildPerMatchRecords } from "../../corpus-tools/src/perMatchRecord";

await ensureAnalysisData();
await ensureHeroTalents();

const root = process.argv[2];
const maxFiles = Number(process.argv[3] ?? 150);

function newSeasonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = path.join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".txt.gz")) out.push(p);
    }
  };
  walk(dir);
  return out
    .filter((p) => {
      const m = /\/2026\/08\/(\d{2})\//.exec(p);
      return m != null && Number(m[1]) >= 12;
    })
    .sort()
    .slice(0, maxFiles);
}

const records = [];
for (const file of newSeasonFiles(root)) {
  try {
    const text = gunzipSync(readFileSync(file)).toString("utf8");
    records.push(...buildPerMatchRecords(text, []));
  } catch {
    /* skip */
  }
}
console.log(`records=${records.length}`);

const corpus = aggregateCells(records, 30, {}, []);
const heroCells = corpus.cells
  .filter((c) => c.buildGroup !== "*" && c.archetype === "*")
  .sort((a, b) => b.sampleN - a.sampleN);

console.log(`\nhero-split cells (buildGroup ≠ "*"): ${heroCells.length}`);
for (const c of heroCells.slice(0, 10)) {
  console.log(
    `  ${c.spec.padEnd(24)} ${c.buildGroup.padEnd(16)} ${c.bracket.padEnd(20)} N=${c.sampleN}${c.insufficient ? " (insufficient)" : ""}`,
  );
}

const demo = heroCells.find((c) => !c.insufficient && c.rotationSummary);
if (!demo) {
  console.log("no sufficient hero cell with rotations in this sample");
  process.exit(0);
}
console.log(
  `\n══════ demo cell: ${demo.spec} / ${demo.buildGroup} / ${demo.bracket} (N=${demo.sampleN})`,
);
console.log(JSON.stringify(demo.rotationSummary, null, 1));

const prompt = buildExemplarLedPrompt(
  { facts: {} } as never,
  demo as never,
  demo.spec,
);
const section = prompt
  .split("How this cohort actually plays")[1]!
  .split("Write the coaching narrative")[0]!;
console.log(`\n══════ prompt section (digit-free):`);
console.log("How this cohort actually plays" + section.trimEnd());
