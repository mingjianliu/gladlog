/**
 * verify/gates.ts — every exported line-based `check*` gate of
 * promptQualityCheck over a capture: per owner, context + findings menu joined
 * (the menu-reading gates need both). The gates read text only, so this scan
 * runs first and on its own (no archive parsed): a hard regression shows
 * within a minute. `check*` gates that need the match are left to the audit.
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

function run(ctx: IContext): void {
  const text = `${ctx.text}\n${ctx.menu}`;
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
