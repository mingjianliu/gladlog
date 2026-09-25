/**
 * Every eval / script entry point that builds a candidate menu passes the
 * round's raw streams — the menu as the app builds it.
 *
 * Reliability audit E1 (user ruling 2026-09-25 「嗯」): extractCandidateFindings'
 * third argument (raw.txt's SPELL_CAST_FAILED + mana) is optional, and a
 * missing stream degrades silently by design (old archives have no raw.txt).
 * So eval paths built by hand — buildCorpus (2026-07-11) predates the raw
 * streams (2026-08-15) — measured a menu the app never shows: on 605 files
 * 198 lines differ (162 kick-eaten, 36 cd-hoarded) and 42 ids swap by cap
 * order. Use `src/corpus/appCandidates.ts` → `candidatesAsTheAppRuns`, or
 * pass the third argument yourself.
 *
 * The check: every direct `extractCandidateFindings(` call with fewer than 3
 * top-level arguments. `LEGACY_TWO_ARG` lists the one-off probes that already
 * did so on 2026-09-25 — convert one and delete its line (a stale entry
 * fails too); never add a new one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "../../..");
const SCAN_DIRS = [
  "packages/eval/src",
  "packages/eval/scripts",
  "packages/desktop/scripts",
  "packages/corpus-tools/src",
  "packages/corpus-tools/scripts",
];

const LEGACY_TWO_ARG = new Set<string>([
  "packages/desktop/scripts/repro-badjson.ts",
  "packages/desktop/scripts/smokeAiPipelines.ts",
  "packages/desktop/scripts/smokeFindingsBackends.ts",
  "packages/desktop/scripts/verify-production.ts",
  "packages/eval/scripts/acceptanceDpsCount.ts",
  "packages/eval/scripts/archive/deepDiveABGen.ts",
  "packages/eval/scripts/archive/deepDiveDisciplineGen.ts",
  "packages/eval/scripts/archive/deepDiveGate.ts",
  "packages/eval/scripts/archive/deepDiveOffensiveScan.ts",
  "packages/eval/scripts/archive/deepDiveScan.ts",
  "packages/eval/scripts/archive/deepDiveSignalBreakdown.ts",
  "packages/eval/scripts/archive/deepDiveYield.ts",
  "packages/eval/scripts/burstMitigationOverlapProbe.ts",
  "packages/eval/scripts/candidateDiagnostics.ts",
  "packages/eval/scripts/confidenceAudit.ts",
  "packages/eval/scripts/consequenceProbe.ts",
  "packages/eval/scripts/deepDiveCausalProbe.ts",
  "packages/eval/scripts/deepDiveOffensiveValueGen.ts",
  "packages/eval/scripts/deepDivePositionProbe.ts",
  "packages/eval/scripts/deepDivePositionValueGen.ts",
  "packages/eval/scripts/discriminationScan.ts",
  "packages/eval/scripts/evidenceDist.ts",
  "packages/eval/scripts/findingsDeltaProbe.ts",
  "packages/eval/scripts/kickEatenCostScan.ts",
  "packages/eval/scripts/modelFormatAudit.ts",
  "packages/eval/scripts/newCandidateScan.ts",
  "packages/eval/scripts/pipelineFuzz.ts",
  "packages/eval/scripts/postKickSwitchAudit.ts",
  "packages/eval/scripts/signalSkillGradientScan.ts",
  "packages/eval/scripts/teammateCrisisAnswerProbe.ts",
  "packages/eval/scripts/teammateCrisisProbe.ts",
  "packages/eval/scripts/unsyncedBurstScopeProbe.ts",
]);

function listSources(rel: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(REPO_ROOT, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules") continue;
    const p = join(rel, e.name);
    if (e.isDirectory()) listSources(p, out);
    else if (/\.(ts|mts|tsx)$/.test(e.name) && !e.name.includes(".test."))
      out.push(p);
  }
}

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/g, "");
}

/** Top-level argument count of every direct call (a `typeof …` type
 * reference is not a call). */
function callArgCounts(src: string): number[] {
  const s = stripComments(src);
  const out: number[] = [];
  const re = /\bextractCandidateFindings\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (s.slice(Math.max(0, m.index - 8), m.index).includes("typeof")) continue;
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    while (j < s.length && depth > 0) {
      const c = s[j]!;
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      j++;
    }
    const args = s
      .slice(start, j - 1)
      .trim()
      .replace(/,\s*$/, "");
    let n = args ? 1 : 0;
    let d = 0;
    for (const c of args) {
      if ("([{".includes(c)) d++;
      else if (")]}".includes(c)) d--;
      else if (c === "," && d === 0) n++;
    }
    out.push(n);
  }
  return out;
}

describe("raw streams reach every candidate-menu entry point (E1)", () => {
  const files: string[] = [];
  for (const d of SCAN_DIRS) listSources(d, files);
  const offenders = files
    .filter((f) =>
      callArgCounts(readFileSync(join(REPO_ROOT, f), "utf8")).some(
        (n) => n < 3,
      ),
    )
    .map((f) => relative(".", f))
    .sort();

  it("no new direct call drops the raw streams", () => {
    expect(offenders.filter((f) => !LEGACY_TWO_ARG.has(f))).toEqual([]);
  });

  it("the legacy list has no stale entry (a converted script leaves it)", () => {
    expect([...LEGACY_TWO_ARG].filter((f) => !offenders.includes(f))).toEqual(
      [],
    );
  });

  it("the main eval paths are converted", () => {
    for (const f of [
      "packages/eval/src/corpus/buildCorpus.ts",
      "packages/eval/src/corpus/candidateMenu.ts",
      "packages/eval/src/explore/baselineFindings.ts",
      "packages/eval/scripts/acceptanceCapture.ts",
      "packages/eval/scripts/abPairSelect.ts",
      "packages/eval/scripts/decisionTraceCapture.ts",
    ])
      expect(offenders).not.toContain(f);
  });
});
