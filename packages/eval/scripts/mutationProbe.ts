/**
 * mutationProbe.ts — does any test notice when this code is wrong?
 *
 * Applies one small mutation at a time to a source file (a comparison
 * operator's strictness, an equality's sense, `&&` ↔ `||`, `Math.min` ↔
 * `Math.max`), runs the tests and records the mutants no test kills. A
 * survivor is a line whose behaviour the suite does not pin: either a test is
 * missing, or the test that exists has no teeth.
 *
 * Why (weekly review 2026-10-24): 86 % of three weeks' 299 fixed functions
 * already had a direct test; several of those tests asserted the bug itself
 * or could not fail (adff9fa, 9d3de0d). Coverage cannot see that — the
 * analysis package sits at 91.6 % lines — a mutant can.
 *
 * Two passes. Pass 1 runs only the test files that import the module
 * (fast); a mutant that survives it is re-run against the package's whole
 * suite (pass 2), so a survivor is one NO test kills.
 *
 * The file is restored after every mutant and on exit / Ctrl-C. Do not run it
 * in a tree another session is editing (`.claude/skills/parallel-sessions`).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/mutationProbe.ts <src file> [--max N] [--json out.json]
 *   e.g. packages/analysis/src/utils/castPress.ts
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const file = resolve(process.argv[2] ?? "");
const argOf = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const MAX = Number(argOf("--max") ?? Infinity);
const JSON_OUT = argOf("--json");
if (!process.argv[2]) {
  console.error(
    "usage: mutationProbe.ts <src file> [--max N] [--json out.json]",
  );
  process.exit(2);
}

// the package root: the nearest directory above the file with a package.json
let pkgRoot = dirname(file);
while (!readdirSync(pkgRoot).includes("package.json"))
  pkgRoot = dirname(pkgRoot);

const original = readFileSync(file, "utf8");
let restored = true;
const restore = () => {
  if (!restored) writeFileSync(file, original);
  restored = true;
};
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    restore();
    process.exit(130);
  });

/** One mutation: the line, the column, the text replaced and its stand-in. */
interface IMutant {
  line: number;
  col: number;
  from: string;
  to: string;
}

const OPERATORS: ReadonlyArray<[RegExp, string]> = [
  [/ <= /g, " < "],
  [/ < /g, " <= "],
  [/ >= /g, " > "],
  [/ > /g, " >= "],
  [/ === /g, " !== "],
  [/ !== /g, " === "],
  [/ && /g, " || "],
  [/ \|\| /g, " && "],
  [/Math\.min\(/g, "Math.max("],
  [/Math\.max\(/g, "Math.min("],
];

function mutantsOf(src: string): IMutant[] {
  const out: IMutant[] = [];
  src.split("\n").forEach((text, i) => {
    const t = text.trim();
    // comments, imports and type-only lines carry no behaviour
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (
      t.startsWith("import ") ||
      t.startsWith("type ") ||
      t.startsWith("export type ")
    )
      return;
    const code = text.replace(/\/\/.*$/, "");
    for (const [re, to] of OPERATORS)
      for (const m of code.matchAll(re)) {
        // a generic or an arrow is no comparison
        if (
          /[<>]/.test(m[0]) &&
          /=>|<[A-Z]/.test(code.slice(m.index! - 1, m.index! + 3))
        )
          continue;
        out.push({ line: i + 1, col: m.index!, from: m[0], to });
      }
  });
  return out;
}

function apply(src: string, m: IMutant): string {
  const lines = src.split("\n");
  const l = lines[m.line - 1]!;
  lines[m.line - 1] = l.slice(0, m.col) + m.to + l.slice(m.col + m.from.length);
  return lines.join("\n");
}

function testFilesImporting(): string[] {
  const mod = basename(file).replace(/\.tsx?$/, "");
  const found: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(n)) {
        const s = readFileSync(p, "utf8");
        if (new RegExp(`/${mod}["']`).test(s)) found.push(relative(pkgRoot, p));
      }
    }
  };
  walk(pkgRoot);
  return found;
}

/** true when the tests pass (the mutant survives) */
function testsPass(filters: string[]): boolean {
  try {
    execFileSync(
      "npx",
      ["vitest", "run", "--root", pkgRoot, "--bail", "1", ...filters],
      {
        stdio: "ignore",
        env: { ...process.env, CI: "1" },
      },
    );
    return true;
  } catch {
    return false;
  }
}

const direct = testFilesImporting();
if (direct.length === 0)
  console.warn("no test file imports this module directly");
if (!testsPass(direct)) {
  console.error("the direct tests fail on the unmutated file — fix that first");
  process.exit(1);
}
const all = mutantsOf(original).slice(0, MAX);
console.log(
  `${relative(process.cwd(), file)}: ${all.length} mutants; direct tests: ${direct.join(", ") || "(none)"}`,
);
const survivedDirect: IMutant[] = [];
for (const [i, m] of all.entries()) {
  restored = false;
  writeFileSync(file, apply(original, m));
  const survives = direct.length === 0 || testsPass(direct);
  restore();
  if (survives) survivedDirect.push(m);
  process.stdout.write(survives ? "s" : ".");
  if ((i + 1) % 50 === 0) process.stdout.write(` ${i + 1}\n`);
}
console.log(
  `\npass 1: ${all.length - survivedDirect.length} killed, ${survivedDirect.length} survive the direct tests`,
);
const survivors: IMutant[] = [];
for (const m of survivedDirect) {
  restored = false;
  writeFileSync(file, apply(original, m));
  const survives = testsPass([]);
  restore();
  if (survives) survivors.push(m);
  process.stdout.write(survives ? "S" : ".");
}
const src = original.split("\n");
const score =
  all.length === 0
    ? "n/a"
    : `${(((all.length - survivors.length) / all.length) * 100).toFixed(1)} %`;
console.log(
  `\npass 2 (whole suite): ${survivors.length} of ${all.length} mutants survive every test (mutation score ${score})`,
);
for (const m of survivors)
  console.log(
    `  ${basename(file)}:${m.line}  \`${m.from.trim()}\` → \`${m.to.trim()}\`   ${src[m.line - 1]!.trim().slice(0, 110)}`,
  );
if (JSON_OUT)
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      { file: relative(process.cwd(), file), mutants: all.length, survivors },
      null,
      2,
    ),
  );
