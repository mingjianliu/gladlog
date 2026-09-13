/**
 * decisionDiff.ts — decision-level differential replay (GH #96 D6).
 *
 * Runs decisionTraceCapture.ts twice on the same manifest slice, once per fact
 * configuration, each in its own child process (one immutable configuration
 * per process), then joins the two traces by opportunity id and reports every
 * class (unchanged / corrected-fact / removed / new / indeterminate /
 * evaluation-error / unmatched) per candidate type and per type × spec ×
 * bracket, normalised by eligible opportunities. A flip is "talent-sensitive"
 * until adjudicated — the report never calls it a fix.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/decisionDiff.ts --manifest <path> [--every 30] \
 *     --a '{}' --b '{"temporaryModifierUncertainty":true}' --out <dir> [--order ab|ba]
 * Output: <dir>/{a.jsonl,b.jsonl,rows.jsonl,summary.json,summary.md}
 */
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import {
  diffTraces,
  summarizeDiff,
  type TraceLine,
} from "../src/explore/decisionDiff";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = arg("--every", "30");
const cfgA = arg("--a", "{}");
const cfgB = arg("--b", "{}");
const outDir = arg("--out", "");
const order = arg("--order", "ab");
if (!manifest || !outDir) {
  console.error(
    "usage: decisionDiff.ts --manifest <path> [--every N] --a <json> --b <json> --out <dir> [--order ab|ba]",
  );
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const capture = (side: "a" | "b", cfg: string) => {
  const r = spawnSync(
    "npx",
    [
      "tsx",
      new URL("./decisionTraceCapture.ts", import.meta.url).pathname,
      "--manifest",
      manifest,
      "--every",
      every,
      "--out",
      join(outDir, `${side}.jsonl`),
    ],
    {
      env: { ...process.env, GLADLOG_FACT_CONFIG: cfg },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (r.status !== 0) throw new Error(`capture ${side} exited ${r.status}`);
};
for (const side of order === "ba"
  ? (["b", "a"] as const)
  : (["a", "b"] as const))
  capture(side, side === "a" ? cfgA : cfgB);

const read = (side: string): TraceLine[] =>
  readFileSync(join(outDir, `${side}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith('{"_config"'))
    .map((l) => JSON.parse(l) as TraceLine);

const rows = diffTraces(read("a"), read("b"));
writeFileSync(
  join(outDir, "rows.jsonl"),
  rows
    .filter((r) => r.class !== "unchanged")
    .map((r) => JSON.stringify(r))
    .join("\n"),
);
const summary = summarizeDiff(rows);
writeFileSync(
  join(outDir, "summary.json"),
  JSON.stringify({ configA: cfgA, configB: cfgB, ...summary }, null, 1),
);
const md = [
  `# decisionDiff`,
  ``,
  `A = \`${cfgA}\`, B = \`${cfgB}\`, manifest every ${every}.`,
  ``,
  `| type | eligible | unchanged | corrected-fact | removed | new | indeterminate | evaluation-error | unmatched |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...Object.entries(summary.byType).map(
    ([t, c]) =>
      `| ${t} | ${c.eligible} | ${c.counts.unchanged} | ${c.counts["corrected-fact"]} | ${c.counts.removed} | ${c.counts.new} | ${c.counts.indeterminate} | ${c.counts["evaluation-error"]} | ${c.counts.unmatched} |`,
  ),
  ``,
  `Flips are talent-sensitive decisions until adjudicated.`,
];
writeFileSync(join(outDir, "summary.md"), md.join("\n"));
console.log(md.join("\n"));
