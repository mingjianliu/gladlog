import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface AuditOptions {
  count?: number;
  model?: string;
}

interface AuditResult {
  ordinal: string;
  agreed: number | null;
  total: number | null;
  detail: string;
}

export function extractSpotAuditCases(
  runDir: string,
  opts?: AuditOptions,
): {
  results: AuditResult[];
  report: string;
  reportPath: string;
} {
  const count = opts?.count ?? 5;
  const model = opts?.model ?? "flash-high";
  const AGY_RUN = join(
    homedir(),
    ".claude",
    "skills",
    "agy",
    "scripts",
    "agy-run.mjs",
  );

  const scoresDir = join(runDir, "scores");
  if (!existsSync(scoresDir)) {
    throw new Error(`No scores at ${scoresDir}`);
  }

  const scoreFiles = readdirSync(scoresDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  // Deterministic, auditable sample: evenly spaced across the run.
  const step = Math.max(1, Math.floor(scoreFiles.length / count));
  const sample = scoreFiles.filter((_, i) => i % step === 0).slice(0, count);

  const promptsDir = join(runDir, "prompts");
  const promptFiles = readdirSync(promptsDir);
  const results: AuditResult[] = [];

  for (const f of sample) {
    const score = JSON.parse(
      readFileSync(join(scoresDir, f), "utf8"),
    ) as Record<string, unknown>;
    const ord = String(
      (score.ordinal as number) ?? f.replace(/\.json$/, ""),
    ).padStart(3, "0");
    const promptFile = promptFiles.find((p) => p.startsWith(`${ord}-`));
    const responseFile = `${ord}.txt`;

    if (!promptFile || !existsSync(join(runDir, "responses", responseFile))) {
      console.error(
        `[judge-spot-audit] ordinal ${ord}: missing prompt/response artifact, skipping`,
      );
      continue;
    }

    const claims = ((score.factAudit ?? []) as Array<Record<string, unknown>>)
      .map((c, i) => {
        // Score files carry either `verified: true|false` or `verdict: "VERIFIED"/"..."`.
        const raw = c.verified ?? c.verdict;
        const verified =
          String(raw).toLowerCase().startsWith("true") ||
          String(raw).toLowerCase().startsWith("verified");
        return `CLAIM ${i + 1} (judge says verified=${verified}): "${c.claim}" — judge's cited evidence: "${c.evidence}"`;
      })
      .join("\n\n");

    const task = `An LLM judge audited an AI coaching response against a match-data prompt. Independently re-check the judge's fact audit.

Read BOTH files in this workspace IN FULL before answering:
- prompt: ${join(runDir, "prompts", promptFile)}
- response: ${join(runDir, "responses", responseFile)}

The judge's fact audit:
${claims}

For each claim, output one line: CLAIM <n>: AGREE or DISAGREE — <one-sentence reason grounded in the actual files>. AGREE means the judge's verified=true/false call is correct. Then a final line: AGREEMENT: <agreed>/<total>.`;

    process.stderr.write(
      `[judge-spot-audit] auditing ordinal ${ord} with ${model}…\n`,
    );
    let output: string;
    try {
      output = execFileSync(
        "node",
        [AGY_RUN, "ask", "--model", model, "--timeout", "280", task],
        {
          encoding: "utf8",
          cwd: runDir,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      const e = err as { status?: number };
      console.error(
        `[judge-spot-audit] ordinal ${ord}: agy run failed (${e.status}) — recorded as UNAVAILABLE`,
      );
      results.push({
        ordinal: ord,
        agreed: null,
        total: null,
        detail: "agy transport failure",
      });
      continue;
    }

    const m = output.match(/AGREEMENT:\s*(\d+)\s*\/\s*(\d+)/);
    results.push({
      ordinal: ord,
      agreed: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
      detail: output.trim(),
    });
  }

  const scored = results.filter((r) => r.agreed !== null);
  const agreed = scored.reduce((s, r) => s + (r.agreed ?? 0), 0);
  const total = scored.reduce((s, r) => s + (r.total ?? 0), 0);

  const report = [
    `# Judge Spot-Audit Report`,
    ``,
    `- Date: ${new Date().toISOString()}`,
    `- Auditor model (via agy): ${model}`,
    `- Sampled: ${sample.join(", ")}`,
    `- **Agreement: ${agreed}/${total} fact-audit claims${total ? ` (${Math.round((100 * agreed) / total)}%)` : ""}**`,
    ``,
    ...results.map(
      (r) =>
        `## Ordinal ${r.ordinal} — ${r.agreed === null ? "UNAVAILABLE" : `${r.agreed}/${r.total}`}\n\n\`\`\`\n${r.detail}\n\`\`\`\n`,
    ),
  ].join("\n");

  const reportPath = join(runDir, "spot-audit-report.md");
  writeFileSync(reportPath, report);
  console.log(
    `[judge-spot-audit] agreement ${agreed}/${total}; full report: ${reportPath}`,
  );

  return { results, report, reportPath };
}
