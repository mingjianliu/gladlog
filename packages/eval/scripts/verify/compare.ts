/**
 * verify/compare.ts — two verification runs, check by check, and the rise
 * ledger: a check whose failure count rose may not go out unexplained.
 *
 *   npx tsx packages/eval/scripts/verify/compare.ts <baseOut> <afterOut>
 *     [--ledger <file>] [--all]
 *
 * Reads the report text of `verify/run.ts`. A ledger line is
 * `<file>:<check> real|lag <why>` — `real`: the product got worse, known and
 * accepted; `lag`: the product is right and the check still reads the old
 * shape. A rise with no line (or a line for a check that did not rise) fails
 * the run, with or without `--ledger`. 44 checks rose over rounds 3 to 8 and 17
 * of them were never explained, so the rise is now a thing to sign, not a
 * number to skim. A report missing on either side, or a check that a report no
 * longer states, is a broken comparison and fails too: an absent number is not
 * a zero.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { argOf, isMainScan } from "./scan";

interface ICount {
  checked: number;
  failed: number;
}

/** `name: checked 12 / violations 3 (…)`, `name: expected 12, wrong 3`, and
 * the gates' `  name: 3` */
export function countsOf(path: string): Map<string, ICount> {
  const out = new Map<string, ICount>();
  const gates = path.endsWith("gates.txt");
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (gates) {
      const g = /^ {2}(\w+): (\d+)$/.exec(line);
      if (g) out.set(g[1]!, { checked: 0, failed: Number(g[2]) });
      continue;
    }
    const m =
      /^(\w+): checked (\d+) \/ violations (\d+)/.exec(line) ??
      /^(\w+): expected (\d+), (?:missing|wrong) (\d+)/.exec(line);
    if (m) out.set(m[1]!, { checked: Number(m[2]), failed: Number(m[3]) });
  }
  return out;
}

const NOT_REPORTS = new Set(["timing.txt", "familyDiff.txt"]);

export interface ICompareResult {
  rows: string[];
  total: number;
  same: number;
  fell: number;
  rose: string[];
  unsigned: string[];
  stale: string[];
  broken: string[];
}

export function compareRuns(
  base: string,
  after: string,
  ledger: ReadonlyMap<string, string> = new Map(),
): ICompareResult {
  const out: ICompareResult = {
    rows: [],
    total: 0,
    same: 0,
    fell: 0,
    rose: [],
    unsigned: [],
    stale: [],
    broken: [],
  };
  const reportsOf = (dir: string) =>
    readdirSync(dir).filter((f) => f.endsWith(".txt") && !NOT_REPORTS.has(f));
  const reports = [...new Set([...reportsOf(base), ...reportsOf(after)])];
  if (reports.length === 0) out.broken.push("no reports on either side");
  for (const f of reports.sort()) {
    const stem = f.replace(/\.txt$/, "");
    if (!existsSync(join(base, f)) || !existsSync(join(after, f))) {
      out.broken.push(`${f}: report on one side only`);
      continue;
    }
    const a = countsOf(join(base, f));
    const b = countsOf(join(after, f));
    // the gates print only the classes that failed, under a header that says
    // how many owners they read; a scan prints every check
    if (f === "gates.txt") {
      const owners = (dir: string) =>
        /^gates \d+, owner files (\d+)$/m.exec(
          readFileSync(join(dir, f), "utf8"),
        )?.[1];
      const [x, y] = [owners(base), owners(after)];
      if (x === undefined || y === undefined)
        out.broken.push(`${f}: no header`);
      else if (x !== y) out.broken.push(`${f}: owners ${x} -> ${y}`);
    } else {
      if (a.size === 0) out.broken.push(`${f}: no checks in the base report`);
      if (b.size === 0) out.broken.push(`${f}: no checks in the report`);
      for (const check of a.keys())
        if (!b.has(check)) out.broken.push(`${stem}:${check}: dropped`);
    }
    for (const check of new Set([...a.keys(), ...b.keys()])) {
      out.total++;
      const x = a.get(check) ?? { checked: 0, failed: 0 };
      const y = b.get(check) ?? { checked: 0, failed: 0 };
      const id = `${stem}:${check}`;
      if (y.failed === x.failed && y.checked === x.checked) {
        out.same++;
        continue;
      }
      const row = `${id}: ${x.failed}/${x.checked} → ${y.failed}/${y.checked}`;
      if (y.failed > x.failed) {
        const sig = ledger.get(id);
        out.rose.push(id);
        out.rows.push(`RISE  ${row}${sig ? `  [${sig}]` : ""}`);
        if (!sig) out.unsigned.push(id);
      } else {
        if (y.failed < x.failed) out.fell++;
        if (process.argv.includes("--all") || y.failed < x.failed)
          out.rows.push(`      ${row}`);
      }
    }
  }
  out.stale = [...ledger.keys()].filter((k) => !out.rose.includes(k));
  return out;
}

function main(): void {
  const [base, after] = process.argv.slice(2);
  if (!base || !after) {
    console.error("usage: verify/compare.ts <baseOut> <afterOut> [--ledger f]");
    process.exit(2);
  }
  const ledgerPath = argOf("--ledger");
  const ledger = new Map<string, string>();
  if (ledgerPath)
    for (const l of readFileSync(ledgerPath, "utf8").split("\n")) {
      const m = /^(\S+) (real|lag) (.+)$/.exec(l);
      if (m) ledger.set(m[1]!, `${m[2]} ${m[3]}`);
      else if (l.trim()) {
        console.error(`bad ledger line: ${l}`);
        process.exit(2);
      }
    }
  const r = compareRuns(base, after, ledger);
  for (const row of r.rows) console.log(row);
  for (const k of r.stale)
    console.log(`ledger line for a check that did not rise: ${k}`);
  for (const b of r.broken) console.log(`BROKEN  ${b}`);
  console.log(
    `${r.total} checks: ${r.same} unchanged, ${r.fell} fell, ${r.rose.length} rose (${r.unsigned.length} unsigned)`,
  );
  if (r.unsigned.length + r.stale.length + r.broken.length > 0) process.exit(1);
}

if (isMainScan(import.meta.url)) main();
