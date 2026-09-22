/**
 * promptSizeProbe.ts — how big is the production first-round prompt today,
 * and which sections carry the bytes? (GH #38 "timeline-prompt token
 * compression": the item's referent — the sparse variant, mean 2,851 tokens
 * vs 5,016 for the timeline variant in the 2026-07-11 A/B — was deleted on
 * 2026-08-21 (7c91140a), so the "+76%" has no baseline any more. This probe
 * gives the user current numbers to rule on whether compression is a project.)
 *
 * Same chain as headlessAnalyze.ts / the renderer — no second implementation:
 *   match.json → pickSource → toLegacySafe → resolveOwner → buildMatchContext
 *
 * Output: per-match chars / lines, then a per-section table (a section is a
 * `[HEADER]` line or a `## heading`; text before the first header is
 * "(preamble)"), sorted by total chars, with share of the whole sample.
 *
 *   npx tsx packages/desktop/scripts/promptSizeProbe.ts [N=30]
 *   env: GLADLOG_MATCH_DIR (default = app library)
 *
 * Baseline (2026-09-22, PROMPT_VERSION 94, newest 30 library matches): see
 * the GH #38 comment of the same date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { buildMatchContext } from "@gladlog/analysis";

import { resolveOwner } from "../src/renderer/src/report/derive/analysisInput";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";

const MATCH_DIR =
  process.env["GLADLOG_MATCH_DIR"] ??
  join(homedir(), "Library/Application Support/gladlog/matches");

interface IndexRow {
  id: string;
  kind: string;
  bracket?: string;
  startTime: number;
}

function newestIds(n: number): IndexRow[] {
  const byId = new Map<string, IndexRow>();
  for (const line of readFileSync(join(MATCH_DIR, "_index.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)) {
    const row = JSON.parse(line) as IndexRow;
    byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, n);
}

function pickSource(doc: any, roundSeq: number | undefined): unknown {
  if (doc.kind === "shuffle") {
    const rounds = doc.data?.rounds ?? [];
    return roundSeq !== undefined ? rounds[roundSeq] : rounds[0];
  }
  return doc.data;
}

// Section headers as buildMatchContext renders them (2026-09-22 dump): an
// ALL-CAPS line ("MATCH FACTS", "KILL WINDOWS (enemy …)", "SPEC BASELINES —
// …"), a "[PERSPECTIVE: …]" / "[MATCH PATTERN: …]" bracket line, or a
// "## …" markdown heading. The key is the caps prefix before " —", ":" or "(".
// Matched against the UNTRIMMED line: legend lines under MATCH TIMELINE are
// indented ("  [RES] lists TRACKED …") and must not open a section.
const HEADER =
  /^(?:\[([A-Z][A-Z ]+):|(#{1,3} [^(—:]+)|([A-Z][A-Z0-9/&' ]{4,}[A-Z])(?=\s*(?:[—:(]|$)))/;

function sectionsOf(prompt: string): Map<string, number> {
  const out = new Map<string, number>();
  let cur = "(preamble)";
  for (const line of prompt.split("\n")) {
    const m = HEADER.exec(line);
    if (m) cur = (m[1] ?? m[2] ?? m[3])!.trim();
    // Timestamped timeline rows are bucketed by their tag ("[STATE]", "[RES]"…)
    // — that is where any compression would land, so the table splits them.
    const row = /^\d+:\d\d\s+\[([A-Z][A-Z ]*)\]/.exec(line);
    const key = row ? `${cur} / [${row[1]}]` : cur;
    out.set(key, (out.get(key) ?? 0) + line.length + 1);
  }
  return out;
}

function main() {
  const n = Number(process.argv[2] ?? 30);
  const rows = newestIds(n);
  const totals = new Map<string, number>();
  const perMatch: {
    id: string;
    bracket: string;
    chars: number;
    lines: number;
  }[] = [];
  for (const row of rows) {
    let prompt = "";
    try {
      const doc = JSON.parse(
        readFileSync(join(MATCH_DIR, row.id, "match.json"), "utf8"),
      );
      const source = pickSource(doc, undefined);
      if (!source) continue;
      const legacy = toLegacySafe(source) as any;
      const owner = resolveOwner(legacy);
      if (!owner) continue;
      const players = Object.values(legacy.units).filter(
        (u: any) => u.info,
      ) as any[];
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      prompt = buildMatchContext(legacy, friends, enemies, { owner });
    } catch (e) {
      console.error(`skip ${row.id}: ${(e as Error).message}`);
      continue;
    }
    if (process.env["GLADLOG_PROMPT_DUMP"] && perMatch.length === 0) {
      writeFileSync(process.env["GLADLOG_PROMPT_DUMP"], prompt);
    }
    perMatch.push({
      id: row.id,
      bracket: row.bracket ?? row.kind,
      chars: prompt.length,
      lines: prompt.split("\n").length,
    });
    for (const [k, v] of sectionsOf(prompt)) {
      totals.set(k, (totals.get(k) ?? 0) + v);
    }
  }
  const chars = perMatch.map((m) => m.chars).sort((a, b) => a - b);
  const sum = chars.reduce((a, b) => a + b, 0);
  const med = chars[Math.floor(chars.length / 2)] ?? 0;
  console.log(
    `matches=${perMatch.length} chars mean=${Math.round(sum / chars.length)} median=${med} min=${chars[0]} max=${chars[chars.length - 1]}  lines mean=${Math.round(perMatch.reduce((a, m) => a + m.lines, 0) / perMatch.length)}`,
  );
  const byBracket = new Map<string, number[]>();
  for (const m of perMatch) {
    byBracket.set(m.bracket, [...(byBracket.get(m.bracket) ?? []), m.chars]);
  }
  for (const [b, cs] of byBracket) {
    console.log(
      `  ${b}: n=${cs.length} mean=${Math.round(cs.reduce((a, c) => a + c, 0) / cs.length)}`,
    );
  }
  console.log(
    "\nsection                                   chars/match   share",
  );
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(
      `${k.padEnd(42)} ${String(Math.round(v / perMatch.length)).padStart(8)}   ${((100 * v) / grand).toFixed(1).padStart(5)}%`,
    );
  }
}

main();
