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

/** 统一的 prompt 文件解析:'<ordinal>-*' 前缀优先,回落 '<ordinal>.txt'。
 * judgeSpotAudit/calibrateAuditor 共用,保持与校验器一致(终审 F5)。 */
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

    // (d) Validate factAudit: 3–12 条,claim/evidence 非空,verdict 为枚举值。
    //
    // 区间而非定值:2026-07-20 起 PASS 1 的审计集由规则确定(见 eval-baseline.md)
    // —— 取回复里全部含 M:SS 时间戳的断言句,上限 12;不足 3 条时补到 3。所以
    // 合法长度恰好是 [3, 12]。**必须记录完整的规则集,不许截断**:审计集确定化的
    // 意义就在于复核者能验证"这批主张确实被查过";只记 3 条等于把可复核性丢掉。
    if (!hasFailed) {
      const factAudit = score.factAudit as unknown[] | undefined;

      if (
        !Array.isArray(factAudit) ||
        factAudit.length < 3 ||
        factAudit.length > 12
      ) {
        failReason = "factAudit must be an array with 3 to 12 entries";
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
        }
      }
    }

    // (e) Validate root metadata fields (工作流契约:ordinal/matchId/spec/result)
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

    if (hasFailed) {
      failures.push({ file: f, reason: failReason });
      fail++;
    } else {
      ok++;
    }
  }

  return { ok, fail, failures };
}
