import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

export const SCORE_DIMENSIONS = [
  "sufficiency",
  "noise",
  "labelBias",
  "inferenceScaffolding",
  "accuracy",
  "outcomeAlignment",
  "focusCalibration",
] as const;

interface ScoreProvenanceResult {
  ok: number;
  fail: number;
  failures: { file: string; reason: string }[];
}

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export const FACT_AUDIT_VERDICTS = [
  "verified",
  "refuted",
  "unsupported",
] as const;

/**
 * Legal factAudit length — must stay equal to the PASS 1 audit-set bounds
 * documented in `docs/commands/eval-baseline.md`. The doc is the spec the judge
 * reads; this validator is the gate that checks the judge obeyed it. If the two
 * disagree, correct scores get rejected (or wrong ones accepted) — so
 * `factAuditBounds.test.ts` parses the doc and asserts these exact numbers.
 *
 * MAX was 12 until 2026-07-21. Raised to 20 after the cap was measured hiding
 * real defects: in the calibration suite the planted fabrication landed on the
 * 13th timestamp-bearing sentence, outside the first-12 window, so two judges
 * found it, wrote it into `notes`, and the rubric forbade it from counting.
 * accuracy scored 8/10 while the judge's true sensitivity was 10/10.
 */
export const FACT_AUDIT_MIN = 3;
export const FACT_AUDIT_MAX = 20;

export const FACT_AUDIT_SEVERITIES = ["minor", "fabricated"] as const;

/**
 * 子项目 A 设计一:accuracy 由 factAudit 确定性计算,判官无打分自由度。
 * 查表与 docs/commands/eval-baseline.md rubric 逐字一致:
 * 任一 fabricated → 1;否则按非 verified 条数:0→5, 1→4, 2→3, ≥3→2。
 * unsupported 与 refuted 同计为错(causal-hardening 规则 5 的既有语义)。
 */
export function computeAccuracyFromFactAudit(
  entries: { verdict: string; severity?: string }[],
): 1 | 2 | 3 | 4 | 5 {
  const errors = entries.filter((e) => e.verdict !== "verified");
  if (errors.some((e) => e.severity === "fabricated")) return 1;
  if (errors.length === 0) return 5;
  if (errors.length === 1) return 4;
  if (errors.length === 2) return 3;
  return 2;
}

/** Unified prompt-file resolution: prefer the '<ordinal>-*' prefix, fall back
 * to '<ordinal>.txt' (final review F5). */
export function promptFileFor(
  ordinal: string,
  promptsDir: string,
): string | null {
  // First try: look for a file starting with '<ordinal>-'
  const prefix = ordinal + "-";
  const promptFiles = existsSync(promptsDir) ? readdirSync(promptsDir) : [];
  const hit = promptFiles.find((f) => f.startsWith(prefix));
  if (hit) return join(promptsDir, hit);

  // Fallback: look for '<ordinal>.txt'
  const fallback = join(promptsDir, `${ordinal}.txt`);
  return existsSync(fallback) ? fallback : null;
}

export function checkScoreProvenance(runDir: string): ScoreProvenanceResult {
  const scoresDir = join(runDir, "scores");

  // If scores dir doesn't exist, nothing to check
  if (!existsSync(scoresDir)) {
    return { ok: 0, fail: 0, failures: [] };
  }

  const promptsDir = join(runDir, "prompts");
  const responsesDir = join(runDir, "responses");

  const scoreFiles = readdirSync(scoresDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let ok = 0;
  let fail = 0;
  const failures: { file: string; reason: string }[] = [];

  for (const f of scoreFiles) {
    const scorePath = join(scoresDir, f);
    let score: Record<string, unknown>;

    try {
      score = JSON.parse(readFileSync(scorePath, "utf8"));
    } catch {
      failures.push({ file: f, reason: "Invalid JSON" });
      fail++;
      continue;
    }

    // Extract ordinal from filename (e.g., "001.json" -> "001")
    const ordinal = f.replace(/\.json$/, "");

    let hasFailed = false;
    let failReason = "";

    // (a) Validate provenance block exists with non-empty fields
    const p = score.provenance as Record<string, unknown> | undefined;

    if (!p) {
      failReason = "Missing provenance block";
      hasFailed = true;
    } else {
      // Check all required fields are strings and non-empty
      for (const field of [
        "judgeModel",
        "judgedAt",
        "promptSha256",
        "responseSha256",
      ]) {
        if (typeof p[field] !== "string" || !p[field]) {
          failReason = `Missing or empty ${field}`;
          hasFailed = true;
          break;
        }
      }

      if (!hasFailed) {
        // (b) Validate SHA256 hashes match
        const promptSha256 = p.promptSha256 as string;
        const responseSha256 = p.responseSha256 as string;

        const promptPath = promptFileFor(ordinal, promptsDir);
        if (!promptPath) {
          failReason = `Missing prompt file for ordinal ${ordinal}`;
          hasFailed = true;
        } else if (sha256File(promptPath) !== promptSha256) {
          failReason = "Prompt sha256 mismatch";
          hasFailed = true;
        }

        if (!hasFailed) {
          const responsePath = join(responsesDir, `${ordinal}.txt`);
          if (!existsSync(responsePath)) {
            failReason = `Missing response file ${ordinal}.txt`;
            hasFailed = true;
          } else if (sha256File(responsePath) !== responseSha256) {
            failReason = "Response sha256 mismatch";
            hasFailed = true;
          }
        }
      }
    }

    // (c) Validate all 7 dimensions present as INTEGER 1-5
    if (!hasFailed) {
      const prompt = score.prompt as Record<string, unknown> | undefined;
      const response = score.response as Record<string, unknown> | undefined;

      for (const dim of SCORE_DIMENSIONS) {
        let found = false;
        let value: unknown = undefined;

        if (prompt && dim in prompt) {
          found = true;
          value = prompt[dim];
        } else if (response && dim in response) {
          found = true;
          value = response[dim];
        }

        if (!found) {
          failReason = `Missing dimension: ${dim}`;
          hasFailed = true;
          break;
        }

        if (
          !Number.isInteger(value) ||
          typeof value !== "number" ||
          value < 1 ||
          value > 5
        ) {
          failReason = `Invalid value for dimension ${dim}: must be integer 1-5`;
          hasFailed = true;
          break;
        }
      }
    }

    // (d) Validate factAudit: [FACT_AUDIT_MIN, FACT_AUDIT_MAX] entries, with
    // non-empty claim/evidence and verdict from the enum.
    //
    // A range rather than a fixed count: since 2026-07-20 PASS 1's audit set is
    // determined by a rule (see eval-baseline.md) — take every assertion
    // sentence in the response that carries an M:SS timestamp, capped at the
    // maximum; if that falls short of the minimum, top it up. So the legal
    // length is exactly that rule's lower and upper bound. **The complete rule
    // set must be recorded, never truncated**: the whole point of making the
    // audit set deterministic is that a reviewer can verify "these claims were
    // actually checked"; recording only 3 throws that reviewability away.
    if (!hasFailed) {
      const factAudit = score.factAudit as unknown[] | undefined;

      if (
        !Array.isArray(factAudit) ||
        factAudit.length < FACT_AUDIT_MIN ||
        factAudit.length > FACT_AUDIT_MAX
      ) {
        failReason = `factAudit must be an array with ${FACT_AUDIT_MIN} to ${FACT_AUDIT_MAX} entries`;
        hasFailed = true;
      } else {
        for (const entry of factAudit) {
          const e = entry as Record<string, unknown> | undefined;
          if (
            !e ||
            typeof e.claim !== "string" ||
            !e.claim ||
            typeof e.evidence !== "string" ||
            !e.evidence
          ) {
            failReason =
              "All factAudit entries must have non-empty claim and evidence";
            hasFailed = true;
            break;
          }
          if (
            typeof e.verdict !== "string" ||
            !(FACT_AUDIT_VERDICTS as readonly string[]).includes(e.verdict)
          ) {
            failReason = `factAudit verdict must be one of ${FACT_AUDIT_VERDICTS.join("/")}`;
            hasFailed = true;
            break;
          }
          if (
            e.verdict !== "verified" &&
            (typeof e.severity !== "string" ||
              !(FACT_AUDIT_SEVERITIES as readonly string[]).includes(
                e.severity,
              ))
          ) {
            failReason =
              "factAudit non-verified entries must carry severity minor/fabricated";
            hasFailed = true;
            break;
          }
        }
      }
    }

    // (e) Validate root metadata fields (the workflow contract:
    // ordinal/matchId/spec/result)
    if (!hasFailed) {
      for (const field of ["ordinal", "matchId", "spec", "result"]) {
        const v = score[field];
        const okField =
          field === "ordinal"
            ? Number.isInteger(v)
            : typeof v === "string" && v.length > 0;
        if (!okField) {
          failReason = `Missing or invalid root field: ${field}`;
          hasFailed = true;
          break;
        }
      }
    }

    // (f) accuracy must equal the factAudit-derived value (design A-1: the
    // judge has zero scoring freedom on this dimension; see
    // docs/superpowers/specs/2026-08-05-judge-noise-floor-design.md)
    if (!hasFailed) {
      const response = score.response as Record<string, unknown> | undefined;
      const factAudit = score.factAudit as {
        verdict: string;
        severity?: string;
      }[];
      const derived = computeAccuracyFromFactAudit(factAudit);
      if (response?.accuracy !== derived) {
        failReason = `accuracy ${String(response?.accuracy)} does not match factAudit-derived ${derived}`;
        hasFailed = true;
      }
    }

    if (hasFailed) {
      failures.push({ file: f, reason: failReason });
      fail++;
    } else {
      ok++;
    }
  }

  return { ok, fail, failures };
}
