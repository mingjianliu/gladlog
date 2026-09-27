/**
 * extractedBodyCheck.ts — confirm an emitter cut out of buildMatchTimeline by
 * extractTimelineSection.ts is the original code (GH #116). Compares the
 * original line range (from a git revision) with the emitter's body after its
 * `const { … } = ctx;` line as SYNTAX TREES: node kinds, operators, let/const,
 * and the exact text of every identifier and literal — so prettier re-wrapping
 * at the new indentation passes and a changed string / template / regex does
 * not. Dumb shell over `sameStatements` in `../src/explore/closureBindings.ts`
 * (tests: test/closureBindings.test.ts). The behavioural check is the 605-file
 * acceptanceCapture.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/extractedBodyCheck.ts <rev> <startLine> <endLine> <emitterFile.ts>
 * e.g. a701227b 1794 2302 packages/analysis/src/context/timelineSections/healerCastGapFiller.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

import { sameStatements } from "../src/explore/closureBindings";

const [rev, startArg, endArg, emitterFile] = process.argv.slice(2);
if (!rev || !startArg || !endArg || !emitterFile) {
  console.error(
    "usage: extractedBodyCheck.ts <rev> <startLine> <endLine> <emitterFile.ts>",
  );
  process.exit(2);
}
const original = execFileSync(
  "git",
  ["show", `${rev}:packages/analysis/src/context/matchTimeline.ts`],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\n")
  .slice(Number(startArg) - 1, Number(endArg))
  .join("\n");

const emitter = fs.readFileSync(emitterFile, "utf8");
// prettier may break a long destructuring as `} =\n    ctx;`
const m = /\n {2}const \{[^}]*\} =\s*ctx;\n/.exec(emitter);
if (!m) throw new Error("no `const { … } = ctx;` line");
let afterDestructure = emitter.slice(m.index + m[0].length);
// a threaded emitter (extractTimelineSection `threaded`) adds exactly two
// statements around the verbatim body: `let { … } = ctx;` right after the
// destructuring and `return { … };` right before the closing brace. They are
// the only statements that may differ, so strip exactly those — the body has
// no `return` of its own at that indentation (the extractor refuses one).
const threadedLet =
  /^\s*\/\/ threaded: [^\n]*\n\s*let \{[^}]*\} =\s*ctx;\n/.exec(
    afterDestructure,
  );
if (threadedLet)
  afterDestructure = afterDestructure.slice(threadedLet[0].length);
let extracted = afterDestructure.slice(0, afterDestructure.lastIndexOf("\n}"));
if (threadedLet) {
  const ret = /\n {2}return \{[^}]*\};\s*$/.exec(extracted);
  if (!ret) throw new Error("threaded emitter without its `return { … };`");
  extracted = extracted.slice(0, ret.index);
}

const r = sameStatements(original, extracted);
if (r.equal) {
  console.log(
    `IDENTICAL (syntax tree + literal text): L${startArg}-${endArg} @ ${rev} vs ${emitterFile}`,
  );
} else {
  console.log(`DIFFERENT\n  original L${r.diff!.a}\n  emitter  L${r.diff!.b}`);
  process.exit(1);
}
