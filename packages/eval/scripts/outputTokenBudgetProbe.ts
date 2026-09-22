// Output-token budget probe (GH #92, 2026-09-22).
//
// Why it exists: the Anthropic API backend's `max_tokens` values were sized for
// pre-thinking models (8192 / 4096 / 2048 / 1500). Since 2026-09-12 the default
// API model is claude-opus-5, which thinks adaptively by default and whose
// thinking tokens count against `max_tokens`; a truncated answer is `bad-json`
// → retry → deterministic fallback, i.e. the AI analysis silently disappears.
// There is no API key on the dev machine, so the number that matters — how
// many output tokens (thinking + answer) Opus 5 emits per call site on real
// product prompts — is measured through the local `claude` CLI instead, whose
// `--output-format json` envelope reports `usage.output_tokens` and
// `usage.output_tokens_details.thinking_tokens` (envelope verified 2026-09-22).
// The CLI runs with the same isolation args the product uses
// (CLAUDE_CLI_ISOLATION_ARGS in packages/desktop/src/main/localAiBackends.ts)
// from a neutral cwd, so no CLAUDE.md or tool preamble inflates the count.
//
// Effort: the product's API path sends no `output_config.effort`, so the API
// default (`high`) applies; pass `--effort high` to match it. Claude Code's own
// default is `xhigh`, which would only make the measured numbers a looser
// upper bound.
//
// Usage:
//   npx tsx scripts/outputTokenBudgetProbe.ts --label first-round \
//     --prompts <dir-of-.txt-prompts> --n 8 --effort high --out probe.jsonl
//   (--model defaults to claude-opus-5; --lang en|zh picks the coach system
//   prompt language; --step N samples every Nth file, default spreads evenly.)
// Prompts are the USER part; the coach system prompt is prepended exactly as
// the product's joinPrompt does for CLI backends (system + "\n" + user).
//
// Baseline numbers (2026-09-22, Opus 5, effort high): see GH #92 comment.
import { spawn } from "node:child_process";
import { appendFileSync,mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mirror of packages/desktop/src/main/ai.ts buildCoachSystemPrompt — the eval
// package cannot import desktop main code. Keep in sync by hand (2 lines).
function coachSystemPrompt(lang: "en" | "zh"): string {
  const language =
    lang === "zh"
      ? "Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English exactly as written in the data — never translate them into Chinese, even inline; you may explain them in Chinese, but the name token itself must stay English."
      : "Respond in English.";
  return `You are a World of Warcraft arena coach reviewing a player's match. Be direct, specific, and grounded strictly in the provided events. ${language}`;
}

const ISOLATION_ARGS = ["--tools=", "--strict-mcp-config", "--disable-slash-commands"];

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const label = arg("label");
const promptsDir = arg("prompts");
const n = Number(arg("n", "8"));
const model = arg("model", "claude-opus-5")!;
const effort = arg("effort", "high")!;
const lang = (arg("lang", "en") as "en" | "zh") ?? "en";
const out = arg("out");
const stepArg = arg("step");
if (!label || !promptsDir || !out) {
  console.error(
    "usage: outputTokenBudgetProbe --label L --prompts DIR --out FILE.jsonl [--n 8] [--model M] [--effort E] [--lang en|zh] [--step N]",
  );
  process.exit(2);
}

interface Row {
  label: string;
  file: string;
  model: string;
  effort: string;
  promptChars: number;
  outputTokens: number;
  thinkingTokens: number;
  resultChars: number;
  stopReason: string;
  durationApiMs: number;
  isError: boolean;
}

function runClaude(prompt: string): Promise<Row | null> {
  const cwd = mkdtempSync(join(tmpdir(), "gladlog-budget-probe-"));
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model, "--effort", effort, ...ISOLATION_ARGS],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`claude exited ${code}: ${stderr.slice(0, 400)}`);
        resolve(null);
        return;
      }
      try {
        const d = JSON.parse(stdout) as {
          is_error: boolean;
          stop_reason: string;
          result: string;
          duration_api_ms: number;
          usage: {
            output_tokens: number;
            output_tokens_details?: { thinking_tokens?: number };
          };
        };
        resolve({
          label: label!,
          file: "",
          model,
          effort,
          promptChars: prompt.length,
          outputTokens: d.usage.output_tokens,
          thinkingTokens: d.usage.output_tokens_details?.thinking_tokens ?? 0,
          resultChars: (d.result ?? "").length,
          stopReason: d.stop_reason,
          durationApiMs: d.duration_api_ms,
          isError: d.is_error,
        });
      } catch (e) {
        console.error(`envelope parse failed: ${e instanceof Error ? e.message : e}\n${stdout.slice(0, 300)}`);
        resolve(null);
      }
    });
    child.stdin.end(prompt);
  });
}

async function main() {
  const files = readdirSync(promptsDir!)
    .filter((f) => f.endsWith(".txt"))
    .sort();
  const step = stepArg ? Number(stepArg) : Math.max(1, Math.floor(files.length / n));
  const picked = files.filter((_, i) => i % step === 0).slice(0, n);
  console.error(`[${label}] ${picked.length}/${files.length} prompts, model=${model}, effort=${effort}`);
  const rows: Row[] = [];
  for (const f of picked) {
    const user = readFileSync(join(promptsDir!, f), "utf8");
    const prompt = `${coachSystemPrompt(lang)}\n${user}`;
    const t0 = Date.now();
    const row = await runClaude(prompt);
    if (!row) continue;
    row.file = f;
    rows.push(row);
    appendFileSync(out!, JSON.stringify(row) + "\n");
    console.error(
      `  ${f}: out=${row.outputTokens} (thinking ${row.thinkingTokens}) result=${row.resultChars}ch stop=${row.stopReason} ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  }
  if (rows.length === 0) process.exit(1);
  const sorted = rows.map((r) => r.outputTokens).sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const think = rows.reduce((s, r) => s + r.thinkingTokens, 0) / rows.reduce((s, r) => s + r.outputTokens, 0);
  console.log(
    `${label}\tn=${rows.length}\tmin=${sorted[0]}\tp50=${p(0.5)}\tmax=${sorted[sorted.length - 1]}\tthinking-share=${(think * 100).toFixed(0)}%\tnon-end_turn=${rows.filter((r) => r.stopReason !== "end_turn").length}`,
  );
}
void main();
