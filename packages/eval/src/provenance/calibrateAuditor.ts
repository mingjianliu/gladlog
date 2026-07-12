import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

import { promptFileFor } from "./checkScoreProvenance";

interface CalibrationOptions {
  model?: string;
  root?: string; // repo root for report path
}

interface CalibrationResult {
  ordinal: string;
  cases?: Array<{
    ordinal: string;
    claim: number;
    planted: boolean;
    note: string | null;
    expected: string;
    got: string;
    correct: boolean;
  }>;
  raw?: string;
  error?: boolean;
}

interface CorruptedClaim {
  text: string;
  note: string;
}

function corrupt(claim: string, type: string): CorruptedClaim {
  if (type === "timeShift") {
    // shift the first printed timestamp by +1 minute — a time that may not exist in the prompt
    const m = claim.match(/(\d+):(\d\d)/);
    if (m) {
      return {
        text: claim.replace(m[0], `${Number(m[1]) + 1}:${m[2]}`),
        note: `timestamp ${m[0]} -> ${Number(m[1]) + 1}:${m[2]}`,
      };
    }
  }
  // distort the first magnitude figure (e.g. 109k -> 909k, 79% -> 9%)
  let m = claim.match(/(\d+)(k\b)/);
  if (m) {
    return {
      text: claim.replace(m[0], `9${m[1]}${m[2]}`),
      note: `${m[0]} -> 9${m[1]}${m[2]}`,
    };
  }
  m = claim.match(/(\d+)(%)/);
  if (m) {
    return {
      text: claim.replace(m[0], `9${m[1]}${m[2]}`),
      note: `${m[0]} -> 9${m[1]}${m[2]}`,
    };
  }
  // fallback: timestamp shift attempt again
  const t = claim.match(/(\d+):(\d\d)/);
  if (t) {
    return {
      text: claim.replace(t[0], `${Number(t[1]) + 1}:${t[2]}`),
      note: `timestamp ${t[0]} shifted`,
    };
  }
  // 纯文本主张(无数字 token)→ 语义反转回退,不再抛错让整跑崩(终审 F3)
  return {
    text: `No evidence exists that ${claim}`,
    note: "text-only claim: semantic negation fallback",
  };
}

export function calibrateAuditor(
  archiveDir: string,
  opts?: CalibrationOptions,
): {
  results: CalibrationResult[];
  report: string;
  reportPath: string;
} {
  const model = opts?.model ?? "flash-high";
  const root = opts?.root ?? dirname(dirname(archiveDir));
  const AGY_RUN = join(
    homedir(),
    ".claude",
    "skills",
    "agy",
    "scripts",
    "agy-run.mjs",
  );

  const ORDINALS = ["001", "003", "005", "007"];
  // Which claim index gets corrupted per ordinal, and how (rotates through types).
  const PLANTS: Record<string, { idx: number; type: string }> = {
    "001": { idx: 1, type: "timeShift" },
    "003": { idx: 0, type: "numberDistort" },
    "005": { idx: 2, type: "timeShift" },
    "007": { idx: 1, type: "numberDistort" },
  };

  const promptsDir = join(archiveDir, "prompts");
  const results: CalibrationResult[] = [];

  for (const ord of ORDINALS) {
    const scorePath = join(archiveDir, "scores", `${ord}.json`);
    if (!existsSync(scorePath)) {
      console.error(`[calibrate-auditor] ${ord}: missing score file, skipping`);
      continue;
    }

    const score = JSON.parse(readFileSync(scorePath, "utf8")) as Record<
      string,
      unknown
    >;
    // 与 checkScoreProvenance.promptFileFor 同规则(终审 F5)
    const promptPath = promptFileFor(ord, promptsDir);
    const responsePath = join(archiveDir, "responses", `${ord}.txt`);

    if (!promptPath || !existsSync(responsePath)) {
      console.error(`[calibrate-auditor] ${ord}: missing artifacts, skipping`);
      continue;
    }

    const plant = PLANTS[ord];
    const factAudit = (score.factAudit ?? []) as Array<Record<string, unknown>>;
    const claims = factAudit.map((c, i) => {
      if (i === plant.idx) {
        const mutated = corrupt(c.claim as string, plant.type);
        return {
          text: mutated.text,
          evidence: c.evidence as string,
          planted: true,
          note: mutated.note,
        };
      }
      return {
        text: c.claim as string,
        evidence: c.evidence as string,
        planted: false,
        note: null,
      };
    });

    const claimBlock = claims
      .map(
        (c, i) =>
          `CLAIM ${i + 1} (judge says verified=true): "${c.text}" — judge's cited evidence: "${c.evidence}"`,
      )
      .join("\n\n");

    const task = `An LLM judge audited an AI coaching response against a match-data prompt. Independently re-check the judge's fact audit.

Read BOTH files in this workspace IN FULL before answering:
- prompt: ${promptPath}
- response: ${join(archiveDir, "responses", `${ord}.txt`)}

The judge's fact audit:
${claimBlock}

For each claim, output one line: CLAIM <n>: AGREE or DISAGREE — <one-sentence reason grounded in the actual files>. AGREE means the judge's verified=true/false call is correct. Then a final line: AGREEMENT: <agreed>/<total>.`;

    process.stderr.write(
      `[calibrate-auditor] ordinal ${ord}: planted ${plant.type} on claim ${plant.idx + 1} (${claims[plant.idx].note})\n`,
    );

    let output: string;
    try {
      output = execFileSync(
        "node",
        [AGY_RUN, "ask", "--model", model, "--timeout", "280", task],
        {
          encoding: "utf8",
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      const e = err as { status?: number };
      console.error(`[calibrate-auditor] ${ord}: agy run failed (${e.status})`);
      results.push({ ordinal: ord, error: true });
      continue;
    }

    const verdicts: Record<number, string> = {};
    for (const m of output.matchAll(/CLAIM\s*(\d)\s*:\s*(AGREE|DISAGREE)/g)) {
      verdicts[Number(m[1]) - 1] = m[2];
    }

    const cases = claims.map((c, i) => ({
      ordinal: ord,
      claim: i + 1,
      planted: c.planted,
      note: c.note,
      expected: c.planted ? "DISAGREE" : "AGREE",
      got: verdicts[i] ?? "NO-PARSE",
      correct: (verdicts[i] ?? "") === (c.planted ? "DISAGREE" : "AGREE"),
    }));

    results.push({ ordinal: ord, cases, raw: output.trim() });
  }

  const all = results.flatMap((r) => r.cases ?? []);
  const planted = all.filter((c) => c.planted);
  const clean = all.filter((c) => !c.planted);
  const detected = planted.filter((c) => c.correct).length;
  const cleanOk = clean.filter((c) => c.correct).length;

  const lines = [
    `# Cross-Family Auditor Calibration Report`,
    ``,
    `- Date: ${new Date().toISOString()}`,
    `- Auditor under test: ${model} via agy (same contract as judge-spot-audit.mjs)`,
    `- Corpus: real scores/prompts/responses from ${dirname(archiveDir)}, ordinals ${ORDINALS.join("/")}`,
    ``,
    `## Measured results`,
    ``,
    `- **Planted-defect detection: ${detected}/${planted.length}** (corrupted claims correctly flagged DISAGREE)`,
    `- **Clean-claim agreement: ${cleanOk}/${clean.length}** (untouched verified claims correctly AGREEd)`,
    ``,
    `| ordinal | claim | planted | mutation | expected | got | correct |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...all.map(
      (c) =>
        `| ${c.ordinal} | ${c.claim} | ${c.planted ? "YES" : "—"} | ${c.note ?? "—"} | ${c.expected} | ${c.got} | ${c.correct ? "✅" : "❌"} |`,
    ),
    ``,
    `## Raw auditor outputs`,
    ``,
    ...results
      .filter((r) => r.raw)
      .map((r) => `### Ordinal ${r.ordinal}\n\n\`\`\`\n${r.raw}\n\`\`\`\n`),
  ];

  const reportPath = join(
    root,
    "docs",
    "analysis",
    `${new Date().toISOString().slice(0, 10)}-auditor-calibration.md`,
  );
  writeFileSync(reportPath, lines.join("\n"));
  const report = lines.join("\n");
  console.warn(
    `[calibrate-auditor] detection ${detected}/${planted.length}, clean-agreement ${cleanOk}/${clean.length}; report: ${reportPath}`,
  );

  return { results, report, reportPath };
}
