/**
 * verify/gates.ts — every exported line-based `check*` gate of
 * promptQualityCheck over a capture: per owner, the prompt the audit path
 * hands the same gates (`promptOf`: the findings prompt with the match
 * context where the builder puts it, or the bare context for an owner with
 * no menu). The gates read text only, so this scan runs first and on its own
 * (no archive parsed): a hard regression shows within a minute. `check*`
 * gates that need the match are left to the audit.
 */
import { writeFileSync } from "node:fs";

import * as quality from "../../src/quality/promptQualityCheck";
import type { IContext, IScan, IScanOpts } from "./scan";

type Gate = (input: string | string[]) => string[];

/** need the parsed match, not the prompt text */
const NOT_LINE_BASED = new Set([
  "checkMatch",
  "checkFriendlyDeaths",
  "checkSpells",
  "checkTrinkets",
]);
const TAKES_WHOLE_TEXT = "checkSnapshotFactsConsistency";
const GATES = Object.entries(quality).filter(
  ([name, fn]) =>
    name.startsWith("check") &&
    typeof fn === "function" &&
    !NOT_LINE_BASED.has(name),
) as unknown as Array<[string, Gate]>;

let total = new Map<string, number>();
let files = 0;
let JSON_OUT: string | undefined;

/** the two lines a capture writes above each file: the archive, the owner */
const CAPTURE_HEADER_LINES = 2;
const MATCH_CONTEXT_HEAD = "Match context (";

/**
 * The prompt of one owner, from a capture's two files. The capture builds the
 * findings prompt with an empty match context (`acceptanceCapture`) and the
 * context apart; the product's prompt carries the context on the line under
 * `Match context (…):`. T221: until then the two FILES were joined, context
 * first — line 1 was the archive path, the coach sentence sat in the middle,
 * and `checkFindingsCountFollowsMenu` (L07, which holds line 1) failed on
 * every owner with a menu: 3,519 of 3,519 on the 605, a constant that could
 * not see a regression.
 */
export function promptOf(text: string, menu: string): string {
  const body = (t: string) =>
    t.split("\n").slice(CAPTURE_HEADER_LINES).join("\n");
  const context = body(text);
  if (!menu) return context;
  const lines = body(menu).split("\n");
  const at = lines.findIndex((l) => l.startsWith(MATCH_CONTEXT_HEAD));
  // not the capture's shape: say so instead of reading a prompt nobody built
  if (at < 0 || lines[at + 1] !== "")
    throw new Error(
      "verify/gates: the findings file has no empty `Match context (…):` slot",
    );
  lines[at + 1] = context;
  return lines.join("\n");
}

function run(ctx: IContext): void {
  const text = promptOf(ctx.text, ctx.menu);
  const lines = text.split("\n");
  files++;
  for (const [name, gate] of GATES) {
    // a gate that throws stops the run: it examined nothing past that point,
    // and as a count it reads like an ordinary failure
    const out = gate(name === TAKES_WHOLE_TEXT ? text : lines);
    if (out.length > 0) total.set(name, (total.get(name) ?? 0) + out.length);
  }
}

function report(): void {
  console.log(`gates ${GATES.length}, owner files ${files}`);
  for (const [name, n] of [...total].sort()) console.log(`  ${name}: ${n}`);
  if (JSON_OUT)
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ files, failures: Object.fromEntries(total) }, null, 1),
    );
}

const state = () => ({ total, files });
export const scan: IScan<ReturnType<typeof state>> = {
  name: "gates",
  textOnly: true,
  configure(o: IScanOpts) {
    JSON_OUT = o.json;
  },
  run,
  report,
  state,
  load(s) {
    ({ total, files } = s);
  },
};
