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

function sha256String(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function promptFileFor(ordinal: string, promptsDir: string): string | null {
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

    // (d) Validate factAudit
    if (!hasFailed) {
      const factAudit = score.factAudit as unknown[] | undefined;

      if (!Array.isArray(factAudit) || factAudit.length < 3) {
        failReason = "factAudit must be an array with at least 3 entries";
        hasFailed = true;
      } else {
        for (const entry of factAudit) {
          const e = entry as Record<string, unknown> | undefined;
          if (
            !e ||
            typeof e.claim !== "string" ||
            !e.claim ||
            typeof e.verdict !== "string" ||
            !e.verdict
          ) {
            failReason =
              "All factAudit entries must have non-empty claim and verdict";
            hasFailed = true;
            break;
          }
        }
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
