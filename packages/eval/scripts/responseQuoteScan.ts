/**
 * Response quoting metric over a run (GH #103 class C — tracked, not a gate).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/responseQuoteScan.ts --run <runId>   (or BASE_DIR=<run dir>)
 *
 * Reads responses/NNN.txt (first line `MATCHID: <id>`) against
 * prompts/NNN-<id>.txt, prints totals and writes quote-report.json into the
 * run directory. Always exits 0 unless a response cannot be paired with its
 * prompt.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { resolveEvalHome, runDir } from "../src/evalHome";
import { checkResponseQuotes } from "../src/provenance/responseQuoteCheck";

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  const runId = runIdx >= 0 ? args[runIdx + 1] : undefined;
  if (!runId && !process.env.BASE_DIR) {
    console.error("Usage: responseQuoteScan --run <runId>  (or set BASE_DIR)");
    process.exit(1);
  }
  const dir = process.env.BASE_DIR ?? runDir(resolveEvalHome(), runId!);
  const respDir = join(dir, "responses");
  const promptDir = join(dir, "prompts");
  if (!existsSync(respDir)) {
    console.error(`no responses/ under ${dir}`);
    process.exit(1);
  }
  const prompts = readdirSync(promptDir);
  const perResponse: Record<
    string,
    ReturnType<typeof checkResponseQuotes>
  > = {};
  let unpaired = 0;
  for (const f of readdirSync(respDir)
    .filter((n) => n.endsWith(".txt"))
    .sort()) {
    const text = readFileSync(join(respDir, f), "utf8");
    const id = text.match(/^MATCHID:\s*(\w+)/)?.[1];
    const prompt = prompts.find(
      (p) => p.startsWith(f.slice(0, 3) + "-") && id && p.includes(id),
    );
    if (!prompt) {
      unpaired++;
      console.log(`  ${f}: no prompt pairs with MATCHID ${id ?? "(none)"}`);
      continue;
    }
    perResponse[f] = checkResponseQuotes(
      text.split("\n").slice(1).join("\n"),
      readFileSync(join(promptDir, prompt), "utf8"),
    );
  }
  const rows = Object.values(perResponse);
  const sum = (k: (r: (typeof rows)[number]) => number) =>
    rows.reduce((s, r) => s + k(r), 0);
  const verbatim = sum((r) => r.verbatimRanges);
  const recut = sum((r) => r.recutRanges.length);
  const free = sum((r) => r.freeFormRanges);
  const hp = sum((r) => r.hpQuotes);
  const hpBad = sum((r) => r.unsupportedHp.length);
  const ranges = verbatim + recut + free;
  const pct = (a: number, b: number) =>
    b === 0 ? "0.0" : ((100 * a) / b).toFixed(1);
  console.log(
    `[responseQuoteScan] ${rows.length} responses — ranges ${ranges}: verbatim ${verbatim}, re-cut printed window ${recut} (${pct(recut, ranges)}%), free-form ${free}; HP quotes ${hp}: unsupported ${hpBad} (${pct(hpBad, hp)}%)`,
  );
  writeFileSync(
    join(dir, "quote-report.json"),
    JSON.stringify(
      { ranges, verbatim, recut, free, hp, hpBad, perResponse },
      null,
      1,
    ),
  );
  process.exit(unpaired > 0 ? 1 : 0);
}

main();
