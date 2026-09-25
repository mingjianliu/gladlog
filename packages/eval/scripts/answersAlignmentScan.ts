/**
 * answersAlignmentScan.ts CLI — dumb shell over
 * `../src/explore/answersAlignment.ts` (GH #18). Walks
 * `<evalHome>/review-sessions/` for every `<name>.answers.json` that has a
 * matching `<name>.session.json`, joins human labels with cards, and prints
 * the aggregate alignment report (per source, per candidate type). Writes no
 * aggregation logic of its own.
 *
 *   tsx answersAlignmentScan.ts [--dir <review-sessions dir>] [--out <file>] [--json <file>]
 *
 * `--dir` overrides the default `<GLADLOG_EVAL_HOME>/review-sessions`;
 * `--out` additionally writes the report lines to a file; `--json` dumps the
 * raw `AlignmentSummary` for downstream tooling.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  type AlignedRow,
  joinAnswers,
  renderAlignmentReport,
  summarizeAlignment,
} from "../src/explore/answersAlignment.js";
import type {
  ReviewAnswers,
  ReviewSession,
} from "../src/explore/reviewTypes.js";
import { resolveEvalHome } from "../src/evalHome.js";
import { ensureAnalysisData } from "@gladlog/analysis";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    out: { type: "string" },
    json: { type: "string" },
  },
});

const dir = values.dir ?? join(resolveEvalHome(), "review-sessions");

const rows: AlignedRow[] = [];
const skipped: string[] = [];
for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith(".answers.json")) continue;
  const name = file.slice(0, -".answers.json".length);
  let session: ReviewSession;
  let answers: ReviewAnswers;
  try {
    session = JSON.parse(
      readFileSync(join(dir, `${name}.session.json`), "utf8"),
    ) as ReviewSession;
    answers = JSON.parse(
      readFileSync(join(dir, file), "utf8"),
    ) as ReviewAnswers;
  } catch {
    skipped.push(name);
    continue;
  }
  const { rows: joined, unanswered } = joinAnswers(session, answers);
  rows.push(...joined);
  if (unanswered.length > 0) {
    console.log(`note: ${name} has ${unanswered.length} unanswered card(s)`);
  }
}
if (skipped.length > 0) {
  console.log(
    `note: skipped ${skipped.length} answers file(s) without a readable session: ${skipped.join(", ")}`,
  );
}

const summary = summarizeAlignment(rows);
const report = renderAlignmentReport(summary);
console.log(report.join("\n"));

if (values.out) writeFileSync(values.out, report.join("\n") + "\n");
if (values.json) writeFileSync(values.json, JSON.stringify(summary, null, 2));
