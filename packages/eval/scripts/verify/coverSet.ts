/**
 * verify/coverSet.ts — the fewest archives that still run every check.
 *
 *   npx tsx packages/eval/scripts/verify/coverSet.ts <coverage.json>... \
 *     --out <manifest.txt> [--extra <manifest>] [--kinds]
 *
 * Greedy set cover over the rows of `verify/run.ts --coverage`, cheapest first:
 * every check that counted a case anywhere gets an archive it counts on, every
 * check that failed anywhere gets an archive it fails on (`--kinds`: every
 * kind of it, about three times the bytes). `--extra` adds archives that must
 * stay in (the audit's rounds). A check judged only after the merge has no
 * archive to pick (`coverage-gaps.json`): the run prints it, the 605 pass reads it. Both corpora at 2026-11-01: 116 of 1,332
 * archives, about 7 % of the raw bytes, 321 items.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ICoverageRow } from "./coverage";
import { argOf, isMainScan } from "./scan";

/** cheapest-first greedy cover of everything the archives touch; `keep` stays
 * in whatever it adds */
export function pickCover(
  items: Map<string, Set<string>>,
  cost: (archive: string) => number,
  keep: string[] = [],
): string[] {
  const left = new Set<string>();
  for (const s of items.values()) for (const x of s) left.add(x);
  const picked = [...keep];
  for (const a of keep) for (const x of items.get(a) ?? []) left.delete(x);
  while (left.size > 0) {
    let best = "";
    let bestScore = -1;
    for (const [a, s] of items) {
      let gain = 0;
      for (const x of s) if (left.has(x)) gain++;
      const score = gain / cost(a);
      if (gain > 0 && score > bestScore) {
        best = a;
        bestScore = score;
      }
    }
    picked.push(best);
    for (const x of items.get(best)!) left.delete(x);
  }
  return picked;
}

function main(): void {
  const OUT = argOf("--out");
  const KINDS = process.argv.includes("--kinds");
  const inputs = process.argv.slice(2).filter((a, i, all) => {
    return a.endsWith(".json") && all[i - 1] !== "--out";
  });
  if (!OUT || inputs.length === 0) {
    console.error("usage: verify/coverSet.ts <coverage.json>... --out <file>");
    process.exit(2);
  }
  const items = new Map<string, Set<string>>();
  const judgedLate = new Set<string>();
  for (const path of inputs) {
    const gaps = join(dirname(path), "coverage-gaps.json");
    if (existsSync(gaps))
      for (const g of JSON.parse(readFileSync(gaps, "utf8")) as string[])
        judgedLate.add(g);
    const rows = JSON.parse(readFileSync(path, "utf8")) as ICoverageRow[];
    for (const r of rows) {
      const s = items.get(r.archive) ?? new Set<string>();
      for (const h of r.hit) s.add(`hit ${h}`);
      for (const f of r.fail) if (KINDS || !f.includes("|")) s.add(`fail ${f}`);
      items.set(r.archive, s);
    }
  }
  // what a capture pays is raw bytes: a log compresses about 10:1 (`rounds.ts`)
  const cost = (a: string): number =>
    existsSync(a)
      ? Math.max(1, statSync(a).size * (a.endsWith(".gz") ? 10 : 1))
      : 1;
  const extra = argOf("--extra");
  const keep = extra
    ? readFileSync(extra, "utf8").split("\n").filter(Boolean)
    : [];
  const picked = pickCover(items, cost, keep);
  writeFileSync(OUT, `${picked.join("\n")}\n`);
  const covered = new Set([...items.values()].flatMap((s) => [...s]));
  const universe = covered.size;
  const mb = picked.reduce((n, a) => n + cost(a), 0) / 1e6;
  console.log(
    `${picked.length} archives (about ${mb.toFixed(0)} MB raw) of ${items.size} cover ${universe} items`,
  );
  const open = [...judgedLate].filter((x) => !covered.has(x)).sort();
  if (open.length > 0)
    console.log(
      `not in the cover set, judged after the merge: ${open.join(", ")}`,
    );
}

if (isMainScan(import.meta.url)) main();
