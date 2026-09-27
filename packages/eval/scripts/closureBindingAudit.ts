/**
 * closureBindingAudit.ts — before cutting a line range out of a big function
 * into its own module, list every binding the range uses that is declared
 * OUTSIDE the range but inside the enclosing function, and how the range uses
 * it (GH #116, splitting buildMatchTimeline byte-identically). Dumb shell over
 * `../src/explore/closureBindings.ts` (tests: test/closureBindings.test.ts).
 * MEASUREMENT ONLY: nothing here feeds production.
 *
 * Classes per binding (a binding can have several):
 *   WRITE          — `=`, `op=`, `++`/`--`, a destructuring-assignment or
 *                    `for … of / in` target: must be RETURNED from an emitter
 *                    and re-assigned by the caller, never passed in
 *   MEMBER-MUTATE  — `x.p = …`, `x[k]++`, `delete x.p`, `x.list.push(…)`:
 *                    pass the same object by reference
 *   CALL           — a closure called from the range (it may consume shared
 *                    state: pass the closure, never re-create it)
 *   READ / TYPE    — read, or named in a type position
 * Also printed: declarations in the range used after it, module-scope
 * declarations of the same file used by it (a runtime import cycle once
 * moved), and `return`s from the enclosing function itself.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/closureBindingAudit.ts <file.ts> <functionName> <startLine> <endLine>
 * e.g. packages/analysis/src/context/matchTimeline.ts buildMatchTimeline 1878 1892
 */
import * as path from "node:path";

import {
  analyzeRange,
  findFunction,
  programFor,
  type UseClass,
} from "../src/explore/closureBindings";

const [fileArg, fnName, startArg, endArg] = process.argv.slice(2);
if (!fileArg || !fnName || !startArg || !endArg) {
  console.error(
    "usage: closureBindingAudit.ts <file.ts> <functionName> <startLine> <endLine>",
  );
  process.exit(2);
}
const file = path.resolve(fileArg);
const { sf, checker } = programFor(file);
const r = analyzeRange(
  sf,
  checker,
  findFunction(sf, fnName),
  Number(startArg),
  Number(endArg),
);

const order: UseClass[] = ["WRITE", "MEMBER-MUTATE", "CALL", "READ", "TYPE"];
const rank = (c: Set<UseClass>) =>
  Math.min(...[...c].map((x) => order.indexOf(x)));
const rows = [...r.outer].sort(
  (a, b) => rank(a.classes) - rank(b.classes) || a.declLine - b.declLine,
);
console.log(
  `${path.basename(file)} ${fnName} lines ${startArg}-${endArg}: ${rows.length} outer bindings`,
);
for (const u of rows) {
  const cls = order.filter((c) => u.classes.has(c)).join("+");
  const ls = [...u.lines].sort((a, b) => a - b);
  console.log(
    `  ${cls.padEnd(24)} ${u.name.padEnd(34)} decl L${u.declLine}  used L${ls.slice(0, 6).join(",")}${ls.length > 6 ? ` (+${ls.length - 6})` : ""}${u.closureRefs.length ? `  closure refs L${u.closureRefs.join(",")}` : ""}`,
  );
}
const list = (xs: Array<{ name: string; declLine: number }>) =>
  xs.length === 0
    ? " none"
    : "\n" + xs.map((d) => `  ${d.name} decl L${d.declLine}`).join("\n");
console.log(
  `declared in range, used after it:${list(r.declaredInsideUsedAfter)}`,
);
console.log(
  `module-scope declarations of this file used by the range:${list(r.moduleLocal)}`,
);
console.log(
  `returns from ${fnName} itself inside the range: ${r.escapingReturns.length === 0 ? "none" : r.escapingReturns.map((l) => `L${l}`).join(", ")}`,
);
