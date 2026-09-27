/**
 * extractTimelineSection.ts — cut one section out of `buildMatchTimeline`
 * (packages/analysis/src/context/matchTimeline.ts) into its own emitter module
 * under context/timelineSections/, mechanically (GH #116). Refactor tooling:
 * nothing here feeds production; the acceptance criterion is a byte-identical
 * 605-file acceptanceCapture (context + findings SHA256), see the issue.
 *
 * The range analysis is `analyzeRange` in `../src/explore/closureBindings.ts`
 * (tests: test/closureBindings.test.ts). This script:
 *  1. REFUSES the range when it writes an outer binding (incl. destructuring /
 *     loop targets), names a function-local type, declares something used
 *     after it, uses a module-scope declaration of matchTimeline.ts itself (a
 *     runtime import cycle once moved — move that first), or returns from
 *     buildMatchTimeline. Those need a hand-written path; closureBindingAudit.ts
 *     prints the detail. One exception, opted into per binding: a written
 *     binding listed in `threaded` is passed in, held in a local `let`,
 *     returned and re-assigned by the caller — exact as long as no nested
 *     function references it (outside the range one could read it mid-update;
 *     inside, one could capture the local copy and outlive the emitter),
 *     which is checked.
 *  2. ctx fields = the outer bindings the range uses (first-use order);
 *     imports = the file's imports the range uses, specifiers rebased one
 *     directory down.
 *  3. writes context/timelineSections/<outFile>.ts exporting
 *     `<exportName>(ctx: Pick<TimelineCtx, …>): void` with the body verbatim
 *     (dedented), replaces lines [cutStart, cutEnd] with `callText` where
 *     `$CTX` becomes a one-field-per-line object literal, adds the emitter
 *     import, and prunes the imports of matchTimeline.ts whose only uses were
 *     in the moved body (`pruneImports`; batch 1's first attempt left seven
 *     unused imports that `eslint .` rejected). matchTimeline.ts is never run through prettier (it is not
 *     prettier-clean; reformatting unrelated lines would conflict with
 *     concurrent edits), so the call text is emitted prettier-shaped.
 * Every ctx field must already exist on TimelineCtx (timelineSections/ctx.ts);
 * `npm run typecheck` checks the declared types. Then run prettier on the new
 * file and extractedBodyCheck.ts on the result.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/extractTimelineSection.ts <config.json>
 * config: { bodyStart, bodyEnd, dedent, cutStart, cutEnd, outFile, exportName,
 *           header (doc comment text, no delimiters), callText, ctxIndent }
 */
import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";

import {
  analyzeRange,
  findFunction,
  programFor,
  pruneImports,
} from "../src/explore/closureBindings";

interface Config {
  bodyStart: number;
  bodyEnd: number;
  dedent: number;
  cutStart: number;
  cutEnd: number;
  outFile: string;
  exportName: string;
  header: string;
  callText: string;
  ctxIndent: number;
  /** outer bindings the range WRITES that are threaded through the emitter:
   * passed in via ctx, held in a local `let`, returned at the end and
   * re-assigned by the caller (callText must do the assignment, e.g.
   * `({ procLinesEmitted } = emitX($CTX));`). Allowed only when no nested
   * function of buildMatchTimeline references the binding, in the range or
   * out (see OuterBinding.closureRefs). */
  threaded?: string[];
}

const cfg = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8")) as Config;
const repo = path.resolve(import.meta.dirname, "../../..");
const file = path.join(repo, "packages/analysis/src/context/matchTimeline.ts");
const outPath = path.join(
  repo,
  "packages/analysis/src/context/timelineSections",
  `${cfg.outFile}.ts`,
);
if (fs.existsSync(outPath)) throw new Error(`${outPath} exists`);

const { sf, checker } = programFor(file);
const r = analyzeRange(
  sf,
  checker,
  findFunction(sf, "buildMatchTimeline"),
  cfg.bodyStart,
  cfg.bodyEnd,
);

const threaded = new Set(cfg.threaded ?? []);
const problems: string[] = [];
for (const t of threaded) {
  const o = r.outer.find((x) => x.name === t);
  if (!o?.classes.has("WRITE"))
    problems.push(`threaded ${t} is not written by the range`);
  else if (o.closureRefs.length)
    problems.push(
      `threaded ${t} is referenced by a nested function (L${o.closureRefs.join(",")}) — it could observe the binding mid-update, or capture the emitter's local copy and outlive it`,
    );
}
for (const o of r.outer) {
  if (o.classes.has("WRITE") && !threaded.has(o.name))
    problems.push(`writes outer binding ${o.name} (L${o.lines.join(",")})`);
  if (o.classes.has("TYPE"))
    problems.push(
      `names function-local type ${o.name} (L${o.lines.join(",")})`,
    );
}
for (const d of r.declaredInsideUsedAfter)
  problems.push(`declares ${d.name} (L${d.declLine}), used after the range`);
for (const d of r.moduleLocal)
  problems.push(
    `uses module-scope ${d.name} (L${d.declLine}) of matchTimeline.ts`,
  );
for (const l of r.escapingReturns)
  problems.push(`returns from buildMatchTimeline at L${l}`);
if (problems.length) {
  console.error("REFUSED:\n  " + problems.join("\n  "));
  process.exit(1);
}

const rebase = (spec: string) =>
  spec.startsWith("./timelineSections/")
    ? `./${spec.slice("./timelineSections/".length)}`
    : spec.startsWith("./")
      ? `../${spec.slice(2)}`
      : spec.startsWith("../")
        ? `../${spec}`
        : spec;

const importLines: string[] = [];
for (const [spec, e] of [...r.imports].sort(([a], [b]) => a.localeCompare(b))) {
  const target = rebase(spec);
  if (e.namespaceName)
    importLines.push(`import * as ${e.namespaceName} from "${target}";`);
  const all = [...e.names];
  const allType = all.length > 0 && all.every(([, t]) => t);
  const named = all
    .map(([n, t]) => (t && !allType ? `type ${n}` : n))
    .sort((a, b) =>
      a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")),
    );
  if (e.defaultName && named.length)
    importLines.push(
      `import ${e.defaultName}, { ${named.join(", ")} } from "${target}";`,
    );
  else if (e.defaultName)
    importLines.push(`import ${e.defaultName} from "${target}";`);
  else if (named.length)
    importLines.push(
      `import ${allType ? "type " : ""}{ ${named.join(", ")} } from "${target}";`,
    );
}

const lines = sf.getFullText().split("\n");
const fieldNames = r.outer.map((o) => o.name);
const threadedNames = fieldNames.filter((f) => threaded.has(f));
const constNames = fieldNames.filter((f) => !threaded.has(f));
const pad = " ".repeat(cfg.dedent);
const bodyLines = lines.slice(cfg.bodyStart - 1, cfg.bodyEnd).map((l, i) => {
  if (l.trim() === "") return "";
  if (!l.startsWith(pad))
    throw new Error(
      `line ${cfg.bodyStart + i} is not indented by ${cfg.dedent}`,
    );
  return "  " + l.slice(cfg.dedent);
});

const out = [
  "/**",
  ...cfg.header.split("\n").map((l) => (l ? ` * ${l}` : " *")),
  " */",
  ...importLines,
  'import type { TimelineCtx } from "./ctx";',
  "",
  `export function ${cfg.exportName}(`,
  `  ctx: Pick<TimelineCtx, ${fieldNames.map((f) => `"${f}"`).join(" | ")}>,`,
  threadedNames.length
    ? `): Pick<TimelineCtx, ${threadedNames.map((f) => `"${f}"`).join(" | ")}> {`
    : "): void {",
  `  const { ${constNames.join(", ")} } = ctx;`,
  ...(threadedNames.length
    ? [
        "  // threaded: read from ctx, returned to the caller (GH #116)",
        `  let { ${threadedNames.join(", ")} } = ctx;`,
      ]
    : []),
  "",
  ...bodyLines,
  ...(threadedNames.length
    ? ["", `  return { ${threadedNames.join(", ")} };`]
    : []),
  "}",
  "",
].join("\n");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);

const ind = " ".repeat(cfg.ctxIndent);
const call = cfg.callText.replace(
  "$CTX",
  `{\n${fieldNames.map((f) => `${ind}  ${f},`).join("\n")}\n${ind}}`,
);
const newLines = [
  ...lines.slice(0, cfg.cutStart - 1),
  ...call.split("\n"),
  ...lines.slice(cfg.cutEnd),
];
// emitter import, in simple-import-sort order: after the last relative import
// whose specifier sorts before it (else after the last import). The cut is
// inside the function, so that line number is unaffected.
const newSpec = `./timelineSections/${cfg.outFile}`;
const importDecls = sf.statements.filter(ts.isImportDeclaration);
const before = importDecls.filter((d) => {
  const s = (d.moduleSpecifier as ts.StringLiteral).text;
  return s.startsWith("./") && s.localeCompare(newSpec) < 0;
});
const anchorImport = before.at(-1) ?? importDecls.at(-1)!;
const anchorLine =
  sf.getLineAndCharacterOfPosition(anchorImport.getEnd()).line + 1;
newLines.splice(
  anchorLine,
  0,
  `import { ${cfg.exportName} } from "${newSpec}";`,
);
// imports whose only uses were in the moved body are now unused in
// matchTimeline.ts (a lint error): prune exactly those
const movedImportNames = new Set<string>();
for (const e of r.imports.values()) {
  for (const k of e.names.keys()) movedImportNames.add(k.split(" as ").at(-1)!);
  if (e.defaultName) movedImportNames.add(e.defaultName);
  if (e.namespaceName) movedImportNames.add(e.namespaceName);
}
const pruned = pruneImports(file, newLines.join("\n"), movedImportNames);
fs.writeFileSync(file, pruned.text);

console.log(
  `extracted L${cfg.bodyStart}-${cfg.bodyEnd} -> timelineSections/${cfg.outFile}.ts: ${fieldNames.length} ctx fields (${fieldNames.join(", ")}); ${importLines.length} import lines; pruned from matchTimeline.ts: ${pruned.removed.join(", ") || "none"}`,
);
