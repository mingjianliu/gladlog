/**
 * interpolateResponses.ts — post-process findings-prompt responses the way the
 * product does, so blind judges score what a player would read.
 *
 * For each `<arm>/responses/NNN.txt` (a `MATCHID:` header + the model's JSON
 * findings array with {{placeholders}}), reconstruct the candidate menu from
 * the paired prompt (`  - id=… type=… t=… units=… facts={k=v, …}` lines),
 * run the product's `auditFindings` gate, interpolate placeholders from the
 * cited events' facts, and write `<arm>/responses-interpolated/NNN.txt`
 * (same header, then one block per surviving finding). Also writes
 * `<arm>/audit-summary.json` — kept/dropped per ordinal with drop reasons —
 * a deterministic metric for candidate-menu A/Bs.
 *
 *   npx tsx packages/eval/scripts/interpolateResponses.ts --arm <dir>
 */
import { auditFindings, parseModelJsonArray } from "@gladlog/analysis";
import type {
  CandidateEvent,
  RawFinding,
} from "@gladlog/analysis/src/analysis/types";
import { interpolate } from "@gladlog/analysis/src/compare/claimChecker";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

import { parseFactsBlock } from "../src/quality/promptQualityCheck";

const argv = process.argv.slice(2);
const arm = argv[argv.indexOf("--arm") + 1];
if (!arm) {
  console.error("usage: --arm <arm dir>");
  process.exit(1);
}

const MENU_LINE =
  /^\s*- id=(\S+) type=(\S+) t=(\S+) units=(.*?) facts=\{(.*)\}\s*$/;

function menuOf(prompt: string): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  for (const line of prompt.split("\n")) {
    const m = line.match(MENU_LINE);
    if (!m) continue;
    // The gate's parser, not a second copy: the ", " split is the same
    // predicate `checkFactsBlockIntegrity` enforces on the producers.
    const facts = parseFactsBlock(m[5]!);
    const tRaw = m[3]!;
    const t = tRaw === "whole-round" ? 0 : Number(tRaw.replace(/s$/, "")) || 0;
    out.push({
      id: m[1]!,
      type: m[2]!,
      t,
      unitNames: m[4]!.split("/").filter(Boolean),
      facts,
    });
  }
  return out;
}

/** {{key}} resolves from the first cited event; {{keyN}} from the Nth. */
function factsFor(f: RawFinding, byId: Map<string, CandidateEvent>) {
  const merged: Record<string, string> = {};
  f.eventIds.forEach((id, i) => {
    const ev = byId.get(id);
    if (!ev) return;
    for (const [k, v] of Object.entries(ev.facts)) {
      if (i === 0 && !(k in merged)) merged[k] = v;
      merged[`${k}${i + 1}`] = v;
    }
  });
  return merged;
}

const index = JSON.parse(readFileSync(join(arm, "index.json"), "utf8")) as {
  ordinal: number;
  file: string;
  matchId: string;
}[];
const outDir = join(arm, "responses-interpolated");
mkdirSync(outDir, { recursive: true });
const summary: Record<string, unknown> = {};
let done = 0;
for (const entry of index) {
  const nnn = String(entry.ordinal).padStart(3, "0");
  const respPath = join(arm, "responses", `${nnn}.txt`);
  if (!existsSync(respPath)) continue;
  const raw = readFileSync(respPath, "utf8");
  const header = raw.split("\n")[0] ?? "";
  const body = raw.slice(header.length);
  const parsed = parseModelJsonArray(body);
  const menu = menuOf(readFileSync(join(arm, entry.file), "utf8"));
  const byId = new Map(menu.map((c) => [c.id, c]));
  if (!parsed) {
    summary[nnn] = { badJson: true, kept: 0, dropped: 0 };
    writeFileSync(
      join(outDir, `${nnn}.txt`),
      `${header}\n\n(model output was not a JSON findings array)\n`,
    );
    continue;
  }
  const audit = auditFindings(parsed as RawFinding[], menu);
  const blocks = audit.findings.map((f, i) => {
    const facts = factsFor(f, byId);
    const title = interpolate(f.title, facts);
    const expl = interpolate(f.explanation, facts);
    const when = f.eventIds
      .map((id) => byId.get(id)?.facts.t)
      .filter(Boolean)
      .map((t) => `${t}s`)
      .join(", ");
    return `${i + 1}. [${f.severity}] ${title}${when ? ` (${when})` : ""}\n   ${expl}`;
  });
  writeFileSync(
    join(outDir, `${nnn}.txt`),
    `${header}\n\n${blocks.join("\n\n") || "(no findings survived the audit)"}\n`,
  );
  summary[nnn] = {
    kept: audit.findings.length,
    dropped: audit.dropped.length,
    dropReasons: audit.dropped.map((d) => d.reason),
    unresolvedPlaceholders:
      blocks.join("\n").match(/\{\{[^}]+\}\}/g)?.length ?? 0,
    typesCited: [
      ...new Set(
        audit.findings.flatMap((f) =>
          f.eventIds.map((id) => byId.get(id)?.type ?? "?"),
        ),
      ),
    ],
  };
  done++;
}
writeFileSync(
  join(arm, "audit-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(`interpolated ${done} responses → ${outDir}`);
