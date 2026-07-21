/**
 * judgeVariance.ts
 *
 * Measures **inter-judge variance** on the calibration suite, which is a
 * different question from `checkCalibration.ts` (which measures whether the
 * judge *detects planted defects*). A dimension can detect every defect and
 * still be useless for A/B work if two judges reading the same material
 * disagree by more than the effect size you are chasing.
 *
 * ## The trick that makes this measurable for free
 *
 * Three of the perturbation classes — see RESPONSE_PRESERVING below — only ever
 * ADD lines to the *prompt* and never touch the *response*. So for one source
 * ordinal, those three cases are **the same material read by three independent
 * judges**. Any spread in a response-side dimension across those three is
 * inter-judge variance by construction, with no ground truth needed.
 *
 * ## Two metrics, and why the obvious one is the weaker one
 *
 * - `errorCount` (**primary**) — how many factAudit entries the judge marked
 *   refuted/unsupported. This is what the judge actually *found*; it is the
 *   substantive disagreement.
 * - `accuracy` range (**secondary, pre-registered**) — the spread of the
 *   accuracy score itself.
 *
 * The accuracy range is registered as the headline criterion for the v1→v2→v3
 * rubric comparison, but it is **not** trustworthy on its own: changing the
 * accuracy anchor table remaps how a given number of found errors becomes a
 * score, so the range can shrink while the judges disagree exactly as much as
 * before (2026-07-20: four of five re-scored cases moved 3 → 4 purely from the
 * lookup-table anchor landing in `3d92ba3`). Read `errorCount` first; read the
 * accuracy range only in light of it.
 *
 * ## Determinism
 *
 * Subagents rewrite their score files after a self-check, so a run started
 * mid-write reads half-finished data. Every report carries an `inputHash` over
 * the exact bytes consumed: run twice, and only trust the numbers when the two
 * hashes match.
 */

import crypto from "crypto";
import fs from "fs-extra";
import path from "path";

/**
 * Perturbations that leave the response untouched and only add prompt lines.
 *
 * Membership is load-bearing: the whole "same material, three judges" premise
 * depends on it. Before adding a class here, confirm in
 * `buildCalibrationSuite.ts` that it (a) never edits `response.txt` and (b) only
 * adds to `prompt.txt` — a class that DELETES prompt lines (`removed-deaths`)
 * genuinely changes what the response can be checked against, so a spread there
 * is not judge noise.
 */
export const RESPONSE_PRESERVING = [
  "none",
  "severity-labels",
  "duplicated-noise",
] as const;

/** factAudit verdicts that mean "the judge found something wrong here". */
export const ERROR_VERDICTS = new Set(["refuted", "unsupported"]);

interface CalibrationCase {
  caseId: string;
  sourceOrdinal: number;
  perturbation: string;
}

interface ScoreFile {
  factAudit?: { verdict?: string }[];
  prompt?: Record<string, number | string>;
  response?: Record<string, number | string>;
}

export interface SourceRow {
  sourceOrdinal: number;
  caseIds: string[];
  accuracy: (number | null)[];
  accuracyRange: number | null;
  errorCounts: number[];
  errorCountRange: number;
}

export interface VarianceReport {
  scoresDir: string;
  inputHash: string;
  sources: SourceRow[];
  /** Sources with a full triplet of parseable scores — the only ones counted. */
  complete: number;
  incomplete: number;
  accuracyRangeMean: number | null;
  accuracyRangeMax: number | null;
  accuracyRangeGe2: number;
  errorCountRangeMean: number;
  errorCountRangeMax: number;
  errorCountRangeGe2: number;
  /** Sources where all three judges found the SAME number of errors. */
  unanimous: number;
}

function toScore(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function measureJudgeVariance(
  baseDir: string,
  scoresDir: string,
): Promise<VarianceReport> {
  const suiteDir = path.join(baseDir, "judge-calibration");
  const manifest = (await fs.readJson(
    path.join(suiteDir, "calibration-manifest.json"),
  )) as { cases: CalibrationCase[] };

  const preserving = new Set<string>(RESPONSE_PRESERVING);
  const bySource = new Map<number, CalibrationCase[]>();
  for (const c of manifest.cases) {
    if (!preserving.has(c.perturbation)) continue;
    const list = bySource.get(c.sourceOrdinal) ?? [];
    list.push(c);
    bySource.set(c.sourceOrdinal, list);
  }

  const hash = crypto.createHash("sha256");
  const sources: SourceRow[] = [];
  let incomplete = 0;

  for (const [sourceOrdinal, cases] of [...bySource.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    // Sort by perturbation, not by caseId, so the columns line up across
    // sources and across scores directories.
    const ordered = [...cases].sort(
      (a, b) =>
        RESPONSE_PRESERVING.indexOf(
          a.perturbation as (typeof RESPONSE_PRESERVING)[number],
        ) -
        RESPONSE_PRESERVING.indexOf(
          b.perturbation as (typeof RESPONSE_PRESERVING)[number],
        ),
    );

    const accuracy: (number | null)[] = [];
    const errorCounts: number[] = [];
    let missing = false;

    for (const c of ordered) {
      const scorePath = path.join(suiteDir, scoresDir, `${c.caseId}.json`);
      if (!(await fs.pathExists(scorePath))) {
        missing = true;
        accuracy.push(null);
        continue;
      }
      const bytes = await fs.readFile(scorePath);
      hash.update(c.caseId).update(bytes);
      let score: ScoreFile;
      try {
        score = JSON.parse(bytes.toString("utf8")) as ScoreFile;
      } catch {
        missing = true;
        accuracy.push(null);
        continue;
      }
      accuracy.push(
        toScore(score.response?.accuracy ?? score.prompt?.accuracy),
      );
      errorCounts.push(
        (score.factAudit ?? []).filter((f) =>
          ERROR_VERDICTS.has(f.verdict ?? ""),
        ).length,
      );
    }

    const accuracyValues = accuracy.filter((a): a is number => a !== null);
    const complete =
      !missing &&
      ordered.length === RESPONSE_PRESERVING.length &&
      accuracyValues.length === ordered.length;
    if (!complete) incomplete++;

    sources.push({
      sourceOrdinal,
      caseIds: ordered.map((c) => c.caseId),
      accuracy,
      accuracyRange: complete ? range(accuracyValues) : null,
      errorCounts,
      errorCountRange: complete ? range(errorCounts) : -1,
    });
  }

  const completeRows = sources.filter((s) => s.accuracyRange !== null);
  const accRanges = completeRows.map((s) => s.accuracyRange as number);
  const errRanges = completeRows.map((s) => s.errorCountRange);

  return {
    scoresDir,
    inputHash: hash.digest("hex").slice(0, 16),
    sources,
    complete: completeRows.length,
    incomplete,
    accuracyRangeMean: mean(accRanges),
    accuracyRangeMax: accRanges.length ? Math.max(...accRanges) : null,
    accuracyRangeGe2: accRanges.filter((r) => r >= 2).length,
    errorCountRangeMean: mean(errRanges) ?? 0,
    errorCountRangeMax: errRanges.length ? Math.max(...errRanges) : 0,
    errorCountRangeGe2: errRanges.filter((r) => r >= 2).length,
    unanimous: errRanges.filter((r) => r === 0).length,
  };
}

export function formatVarianceReport(reports: VarianceReport[]): string {
  const lines: string[] = [];
  lines.push("# Judge inter-variance — response-preserving triplets");
  lines.push("");
  lines.push(
    `Perturbations compared: ${RESPONSE_PRESERVING.join(", ")} — same response,`,
  );
  lines.push(
    "prompt only added to, so each triplet is one piece of material read by three",
  );
  lines.push(
    "independent judges. Spread = inter-judge variance, no ground truth needed.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| scores dir | sources | errCount range mean | max | >=2 | unanimous | accuracy range mean | max | >=2 | inputHash |",
  );
  lines.push(
    "| ---------- | ------- | ------------------- | --- | --- | --------- | ------------------- | --- | --- | --------- |",
  );
  for (const r of reports) {
    lines.push(
      `| ${r.scoresDir} | ${r.complete}${r.incomplete ? ` (+${r.incomplete} incomplete)` : ""} | ${r.errorCountRangeMean.toFixed(2)} | ${r.errorCountRangeMax} | ${r.errorCountRangeGe2} | ${r.unanimous}/${r.complete} | ${r.accuracyRangeMean?.toFixed(2) ?? "—"} | ${r.accuracyRangeMax ?? "—"} | ${r.accuracyRangeGe2} | \`${r.inputHash}\` |`,
    );
  }
  lines.push("");
  lines.push(
    "`errCount` is the primary metric: the count of factAudit entries the judge marked",
  );
  lines.push(
    "refuted/unsupported. The accuracy range is the pre-registered headline number but is",
  );
  lines.push(
    "confounded by anchor remapping — a changed anchor table moves scores without changing",
  );
  lines.push("what the judges actually found. Read errCount first.");
  lines.push("");

  for (const r of reports) {
    lines.push(`## ${r.scoresDir}`);
    lines.push("");
    lines.push(
      `| source | cases | errCounts (${RESPONSE_PRESERVING.join("/")}) | errRange | accuracy | accRange |`,
    );
    lines.push(
      "| ------ | ----- | ------------------------------------------ | -------- | -------- | -------- |",
    );
    for (const s of r.sources) {
      lines.push(
        `| ${String(s.sourceOrdinal).padStart(3, "0")} | ${s.caseIds.join(" ")} | ${s.errorCounts.join(" / ") || "—"} | ${s.errorCountRange < 0 ? "—" : s.errorCountRange} | ${s.accuracy.map((a) => a ?? "—").join(" / ")} | ${s.accuracyRange ?? "—"} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
