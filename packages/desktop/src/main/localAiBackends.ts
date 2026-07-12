import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AnthropicLike } from "./ai";

const execFileP = promisify(execFile);
// `claude -p` carries agentic overhead and is slow on big prompts (minutes);
// agy/Gemini is much faster. Generous ceiling so a real completion can land.
const TIMEOUT_MS = 300_000;
const AGY_DEFAULT = join(homedir(), ".claude/skills/agy/scripts/agy-run.mjs");

/**
 * A CLI runner: spawn `file` with `args` (NO shell — args are an array, so
 * match data in the prompt can never be interpreted by a shell), write `stdin`,
 * resolve stdout. Non-zero exit / spawn error / timeout reject.
 */
export type Runner = (
  file: string,
  args: string[],
  stdin: string,
) => Promise<string>;

const defaultRun: Runner = (file, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${file} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${file} exited ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.end(stdin);
  });

// Resolve a command's absolute path via the user's login shell — a packaged
// macOS GUI app doesn't inherit the shell PATH. Cached per command.
const resolvedCmds = new Map<string, Promise<string>>();
function resolveViaLoginShell(cmd: string): Promise<string> {
  let p = resolvedCmds.get(cmd);
  if (!p) {
    const shell = process.env.SHELL || "/bin/zsh";
    p = execFileP(shell, ["-lc", `command -v ${cmd}`])
      .then((r) => r.stdout.trim() || cmd)
      .catch(() => cmd);
    resolvedCmds.set(cmd, p);
  }
  return p;
}

const joinPrompt = (params: { messages: { content: string }[] }): string =>
  params.messages.map((m) => m.content).join("\n");

/** `claude -p --output-format text`, prompt on stdin, stdout = clean completion. */
export function claudeCliClientFactory(opts?: {
  cmd?: string;
  run?: Runner;
}): AnthropicLike {
  const run = opts?.run ?? defaultRun;
  return {
    async *stream(params) {
      const cmd = opts?.cmd || (await resolveViaLoginShell("claude"));
      const out = await run(
        cmd,
        ["-p", "--output-format", "text"],
        joinPrompt(params),
      );
      yield { delta: out };
    },
  };
}

/** Strip agy's leading `[agy-run] …` header line. */
export function stripAgyHeader(s: string): string {
  const nl = s.indexOf("\n");
  return nl !== -1 && s.startsWith("[agy-run]") ? s.slice(nl + 1) : s;
}

/** `node agy-run.mjs ask <prompt>` (Gemini); header line stripped. */
export function agyClientFactory(opts?: {
  node?: string;
  script?: string;
  run?: Runner;
}): AnthropicLike {
  const run = opts?.run ?? defaultRun;
  return {
    async *stream(params) {
      const node = opts?.node || (await resolveViaLoginShell("node"));
      const script = opts?.script || AGY_DEFAULT;
      const out = await run(
        node,
        [script, "ask", "--timeout", "110", joinPrompt(params)],
        "",
      );
      yield { delta: stripAgyHeader(out) };
    },
  };
}
