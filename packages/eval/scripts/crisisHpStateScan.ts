/**
 * Standing measurement for the crisis-HP ↔ [STATE] render-grid invariant
 * (2026-08-30, Shared-Predicate Rule).
 *
 * A `cd-hoarded` / `crisis-no-response` candidate-menu line cites a unit's HP
 * at a rendered second; the timeline may emit a `[STATE]` tick for the same
 * unit at that same rendered second. The two must be identical — they are two
 * renderings of one fact. Before the fix the analysis side sampled the crisis
 * crossing at the raw advancedAction timestamp while `[STATE]` samples
 * `getUnitHpAtTimestamp(unit, startMs + s*1000, HP_SAMPLE_RADIUS_MS)` on whole
 * seconds, so blind judges refuted the menu lines as prompt-internal
 * contradictions.
 *
 * Counts, per candidate type: total menu lines, lines whose unit HAS a
 * same-second [STATE] tick (the only lines the invariant can be evaluated on),
 * and mismatches. Run it on the same prompt directory before and after any
 * change to either side — same criterion, both times.
 *
 * The parsing is NOT re-implemented here: it comes from
 * `crisisHpStateProbes` in promptQualityCheck.ts, the same predicate the
 * `checkCrisisHpStateConsistency` hard-failure gate fails on.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/crisisHpStateScan.ts --prompts <dir> [--examples N]
 */
import { readdirSync,readFileSync } from "node:fs";
import path from "node:path";

import {
  crisisHpProbeMismatch,
  type CrisisHpStateProbe,
  crisisHpStateProbes,
} from "../src/quality/promptQualityCheck";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const promptsDir = arg("prompts");
if (!promptsDir) {
  console.error(
    "usage: npx tsx packages/eval/scripts/crisisHpStateScan.ts --prompts <dir> [--examples N]",
  );
  process.exit(2);
}
const maxExamples = Number(arg("examples") ?? 5);

interface Tally {
  total: number;
  covered: number;
  mismatch: number;
}
const tally = new Map<string, Tally>();
const examples: string[] = [];

const bump = (type: string): Tally => {
  let t = tally.get(type);
  if (!t) {
    t = { total: 0, covered: 0, mismatch: 0 };
    tally.set(type, t);
  }
  return t;
};

const files = readdirSync(promptsDir)
  .filter((f) => f.endsWith(".txt"))
  .sort();

for (const file of files) {
  const lines = readFileSync(path.join(promptsDir, file), "utf8").split("\n");
  for (const p of crisisHpStateProbes(lines) as CrisisHpStateProbe[]) {
    const t = bump(p.type);
    t.total++;
    if (p.stateHp === null) continue;
    t.covered++;
    // the gate's own comparison: equality for a point reading, "the tick is
    // not below it" for a trough fact (FT-T03)
    if (!crisisHpProbeMismatch(p)) continue;
    t.mismatch++;
    if (examples.length < maxExamples) {
      const mm = `${Math.floor(p.tSecond / 60)}:${String(p.tSecond % 60).padStart(2, "0")}`;
      examples.push(
        `${file}:${p.lineIndex + 1} ${p.type} ${p.unitName} @ ${mm} — fact ${p.factHp}% vs [STATE] ${p.stateHp}`,
      );
    }
  }
}

console.log(`prompts: ${files.length} file(s) under ${promptsDir}`);
console.log("type                  total  covered  mismatch");
for (const type of [...tally.keys()].sort()) {
  const t = tally.get(type)!;
  console.log(
    `${type.padEnd(20)} ${String(t.total).padStart(6)} ${String(t.covered).padStart(8)} ${String(t.mismatch).padStart(9)}`,
  );
}
if (examples.length) {
  console.log("\nexamples:");
  for (const e of examples) console.log(`  ${e}`);
}
