/**
 * sentenceJudge.ts — shared pieces of the GH #70 blind sentence judge:
 * running a prompt through `claude -p` the way the product does, splitting
 * coaching prose into sentences, a deterministic shuffle, and the judge
 * instructions. Used by scripts/consequenceProbe.ts (first-round findings) and
 * scripts/deepDiveCausalProbe.ts (deep-dive round).
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mirror of packages/desktop/src/main/ai.ts buildCoachSystemPrompt (same hand
// copy as outputTokenBudgetProbe.ts — eval cannot import desktop main).
export function coachSystemPrompt(lang: "en" | "zh"): string {
  const language =
    lang === "zh"
      ? "Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English exactly as written in the data — never translate them into Chinese, even inline; you may explain them in Chinese, but the name token itself must stay English."
      : "Respond in English.";
  return `You are a World of Warcraft arena coach reviewing a player's match. Be direct, specific, and grounded strictly in the provided events. ${language}`;
}

/** The product's CLI isolation args (localAiBackends.ts). */
export const ISOLATION_ARGS = [
  "--tools=",
  "--strict-mcp-config",
  "--disable-slash-commands",
];

/** `claude -p --output-format json` from a neutral cwd (a repo cwd would make
 * the CLI read CLAUDE.md). null on any failure. */
export function callClaude(
  prompt: string,
  model: string,
): Promise<{ text: string; env: any } | null> {
  const cwd = mkdtempSync(join(tmpdir(), "gladlog-gh70-"));
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--no-session-persistence",
        ...ISOLATION_ARGS,
      ],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`claude exit ${code}: ${(err || out).slice(0, 300)}`);
        resolve(null);
        return;
      }
      try {
        const env = JSON.parse(out);
        if (env.is_error) {
          console.error(`claude is_error: ${String(env.result).slice(0, 300)}`);
          resolve(null);
          return;
        }
        resolve({ text: String(env.result ?? ""), env });
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(prompt);
  });
}

export interface JudgeItem {
  id: string;
  arm: "A" | "B";
  finding: number;
  part: "title" | "sentence";
  text: string;
}

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

/** Deterministic shuffle (mulberry32 on the seed). */
export function shuffled<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** What the evidence block is, for the first-round probe (kept verbatim so
 * earlier runs stay comparable). */
export const FINDINGS_EVIDENCE_DESC =
  "the match context the coach saw, including an OBSERVED CONSEQUENCES section of deterministic measurements, and the event menu";

export function judgeInstructions(evidenceDesc: string): string {
  return `You are auditing coaching sentences written about ONE World of Warcraft arena round, against that round's log evidence. The evidence is below (${evidenceDesc}). Then a list of sentences (Chinese or English), each with an id. Different sentences may come from different coaches; judge each on its own.

For EACH sentence return:
- "kind": exactly one of
  "observation" — states what happened, no link to what followed;
  "consequence" — links an event to something the log shows happening because of / right after it (the cast never landed, the victim could not cast until…, a teammate dropped while the healer was CC'd, an enemy defensive / trinket / external was forced / drawn out / baited / pulled);
  "causal-verdict" — pins a death, a loss, a win or the round's outcome on an event ("导致死亡", "cost you the round", "that's why you lost", "decided the game");
  "counterfactual" — what would or could have happened had something else been done ("本可以", "would have survived", "if you had…");
  "advice" — a recommendation with no factual claim beyond the event it cites;
  "other".
- "supported": "yes" / "partly" / "no" / "n/a" — is the sentence's factual content (times, who, which spell, HP, and for "consequence" the claimed link itself) backed by the evidence? A consequence link counts as supported only when the evidence shows it (e.g. a [KICK] or [CONSEQ] line plus the later cast; an enemy defensive inside the team's kill attempt with the HP at use, or a [CONSEQ] line stamped FORCED). Temporal order alone does NOT support "forced", "because", "so", "导致", "逼出". A "causal-verdict" or "counterfactual" is "no" unless the evidence states it outright. "n/a" only for pure advice.
- "evidence": the shortest verbatim quote of the line(s) you relied on, or "none".
- "note": at most 20 words, required when supported is not "yes".

Return ONLY a JSON array [{"id": string, "kind": string, "supported": string, "evidence": string, "note": string}] with one element per id, nothing else.`;
}
