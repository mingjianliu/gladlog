import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * DeepSeek driver for the family-bias-sycophancy experiments (sub-project D,
 * see docs/superpowers/specs/2026-08-06-family-bias-sycophancy-design.md).
 * Pure eval-side: mirrors packages/desktop/src/main/deepseekClient.ts's
 * request shape (endpoint, model, max_tokens, auth header) but is
 * non-streaming — batch scripts want a single Promise<string>, not the
 * product's SSE AsyncIterable.
 *
 * Key handling: the key lives at ~/.config/gladlog-dev/deepseek.key
 * (read-only, never printed). Only `readDeepseekKey`'s error messages may
 * reference the *path*; the key's content must never appear in a thrown
 * error, a log line, a test, or a commit.
 */

/** One OpenAI-compatible chat message. Shared across Task 1-3 of this
 * sub-project (responder, judge, sycophancy judge all build arrays of this
 * type) -- deliberately narrower than desktop's coachChat.ts `ChatMessage`
 * (which carries a UI-only `at` timestamp for the chat transcript view);
 * this one is exactly the DeepSeek/OpenAI request wire shape. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const KEY_PATH = join(homedir(), ".config", "gladlog-dev", "deepseek.key");

/**
 * Reads the DeepSeek API key from ~/.config/gladlog-dev/deepseek.key,
 * trimmed. Throws an error naming the path (never the content) when the
 * file is missing or empty -- callers should let this propagate rather than
 * catch-and-log it, since a caught error's `.message` is exactly the kind of
 * thing that ends up in a report.
 */
function readDeepseekKey(): string {
  let raw: string;
  try {
    raw = readFileSync(KEY_PATH, "utf-8");
  } catch (e) {
    throw new Error(`DeepSeek key 未找到:${KEY_PATH}(${(e as Error).message})`);
  }
  const key = raw.trim();
  if (!key) throw new Error(`DeepSeek key 文件为空:${KEY_PATH}`);
  return key;
}

/**
 * Coach persona + language instruction, copied verbatim from the Simplified
 * Chinese branch of `buildCoachSystemPrompt` in
 * packages/desktop/src/main/ai.ts (the function the production analysis
 * path -- packages/desktop/src/main/analysis.ts's `callOnce` -- passes as
 * `system` alongside the DeepSeek backend). This is a literal copy, not an
 * import: see the report for why (no existing precedent for a *static*
 * cross-package src import in this repo -- the one prior case,
 * packages/eval/scripts/modelFormatAudit.ts, uses a *dynamic* import
 * specifically because scripts/ isn't part of tsc's `include` and isn't
 * unit-tested; deepseekDriver.ts is in src/ and is imported by a unit test).
 *
 * "en" branch (not "zh"): verified directly against the S-arm corpus this
 * experiment compares against --
 * ~/code/gladlog-eval-private/ab/2026-08-06-planted-accuracy/control/responses/*.txt
 * (the halo-control sonnet responses Task 2's familyBias.ts reuses as the
 * S arm) are English. The D arm must match that language, or the language
 * alone would out each response's family to the blind judge before any
 * bias measurement starts -- a confound, not a cosmetic detail. (An
 * earlier version of this file picked "zh" by analogy to
 * packages/eval/scripts/modelFormatAudit.ts's `buildCoachSystemPrompt("zh")`
 * without checking the actual corpus; that was wrong and is corrected here.)
 *
 * Exported (not just module-private) so deepseekDriver.test.ts can pin it
 * against a dynamic import of the real `buildCoachSystemPrompt("en")` --
 * the same borrow-don't-duplicate escape hatch
 * packages/eval/scripts/modelFormatAudit.ts uses -- so a future wording
 * change on the product side fails this test instead of silently drifting.
 */
export const RESPONDER_SYSTEM_PROMPT =
  "You are a World of Warcraft arena coach reviewing a player's match. Be direct, specific, and grounded strictly in the provided events. Respond in English.";

/**
 * Builds the responder call's messages: the coaching prompt goes through
 * unmodified as the user turn (this is deliberately the *identical* prompt
 * text the S-arm sonnet responder saw -- for the S/D comparison to mean
 * anything, only the model differs, nothing about the prompt).
 */
export function buildResponderMessages(promptText: string): ChatMessage[] {
  return [
    { role: "system", content: RESPONDER_SYSTEM_PROMPT },
    { role: "user", content: promptText },
  ];
}

/**
 * Builds the judge call's messages: everything the judge needs -- rubric,
 * the prompt under evaluation, the response under evaluation, and the
 * "output only score JSON" instruction -- embedded in a single user turn
 * (no system message; this is a one-shot instruct-and-answer, not a
 * conversation). Deliberately never states which model produced the
 * response (S-arm sonnet vs D-arm DeepSeek) or that this is an S/D
 * comparison at all -- the judge must stay blind to arm identity for the
 * family-bias measurement to be valid.
 */
export function buildJudgeMessages(
  rubricText: string,
  promptText: string,
  responseText: string,
): ChatMessage[] {
  const content = [
    "You are scoring a WoW arena coaching response against the rubric below.",
    "Read the rubric, the original coaching prompt, and the response, then",
    "output your evaluation.",
    "",
    "=== RUBRIC ===",
    rubricText,
    "",
    "=== PROMPT UNDER EVALUATION ===",
    promptText,
    "",
    "=== RESPONSE UNDER EVALUATION ===",
    responseText,
    "",
    "Output ONLY a single JSON object with the score fields defined by the",
    "rubric above. No prose, no markdown code fence, no commentary -- the",
    "entire reply must be valid JSON and nothing else.",
  ].join("\n");
  return [{ role: "user", content }];
}

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// Same value as analysis.ts's analyzeWindow call site (the production
// "analysis path" this driver mirrors) -- see the max_tokens comment there
// (4-8 findings plus explanations; smaller budgets hit truncation in
// production). Production sets no `temperature` field at all (relies on the
// API default) -- matching that means this driver also omits it, not that
// it hardcodes some specific value.
const DEFAULT_MAX_TOKENS = 8192;
const MAX_ATTEMPTS = 3;

// Overall per-attempt deadline. Same *value* as
// packages/desktop/src/main/deepseekClient.ts's TIMEOUT_MS, deliberately
// simplified: the product also runs a 60s stall watchdog on top of this
// (deepseekClient.ts:12-21,75-109) because a *streaming* connection can keep
// the TCP socket open while going silent mid-stream, and the overall timeout
// alone wouldn't catch that for up to 300s. This driver is non-streaming --
// one fetch either resolves or it doesn't, there is no "chunks arrived, then
// went quiet" state to detect -- so the overall timeout alone already covers
// the failure mode a stall watchdog exists for here. Adding a second timer
// for a state that can't occur would be complexity without a payoff; picking
// the simpler correct thing.
const OVERALL_TIMEOUT_MS = 300_000;

// Generic sk-xxxx shaped token -- same pattern as
// packages/desktop/src/main/deepseekClient.ts's GENERIC_KEY_RE. An error
// body from the API may echo request headers back, so both the configured
// key and any sk-xxxx-shaped token get redacted before an error message can
// reach a log/report.
const GENERIC_KEY_RE = /sk-[A-Za-z0-9]+/g;

function scrubSecrets(text: string, key: string): string {
  let out = text;
  if (key) out = out.split(key).join("[REDACTED]");
  return out.replace(GENERIC_KEY_RE, "[REDACTED]");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DeepseekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * An HTTP-status-carrying failure from the DeepSeek API, distinct from a
 * network-level throw (connection reset, timeout abort, DNS failure, ...).
 * `retryable` decides whether `callDeepseek`'s loop tries again: 429 (rate
 * limit) and 5xx (server-side) are transient and worth a retry; any other
 * 4xx (401 bad key, 400 bad request, ...) will fail identically on every
 * retry, so retrying just burns the batch's time budget for nothing.
 */
class DeepseekApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "DeepseekApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Races `fetchImpl` against an AbortController-driven timeout so a stalled
 * connection can't hold an attempt (and therefore the whole retry loop -- up
 * to `MAX_ATTEMPTS` of these) open indefinitely. The timer is always cleared
 * on the way out, success or failure, so it never outlives the call.
 */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls DeepSeek's OpenAI-compatible chat/completions endpoint
 * non-streaming (`deepseek-chat`, same max_tokens/auth-header shape as the
 * product's streaming client) and returns the full response text.
 *
 * Retries up to `maxAttempts` (default 3) with exponential backoff (1s, 2s)
 * on *retryable* failures only: a network-level throw (including this
 * function's own timeout abort), HTTP 429, or HTTP 5xx. A non-retryable HTTP
 * status (e.g. 401/400) throws immediately without waiting out the
 * remaining attempts -- those will never succeed, and a batch run of dozens
 * of calls can't afford to spend 3 attempts x backoff on every one of them
 * before giving up. Each attempt is bounded by `OVERALL_TIMEOUT_MS`
 * (default 300s, same value as the product's TIMEOUT_MS) so a stalled call
 * plus retries can't tie up an unbounded amount of a batch run's time.
 *
 * Not unit-tested (network call) -- see deepseekDriver.test.ts for what
 * *is* covered.
 */
export async function callDeepseek(
  messages: ChatMessage[],
  opts?: {
    key?: string;
    maxTokens?: number;
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    timeoutMs?: number;
    /**
     * 显式采样温度。**默认不传** —— 生产的 analysis 路径也不传(见 DEFAULT_MAX_TOKENS
     * 上方那段注释),所以省略时本驱动与生产逐字节同形。
     *
     * 什么时候该传:做**因果**测量的时候。2026-08-23 的逐行消融探针在默认温度下,
     * 同一份 prompt 两次基线之间的引用集合 Jaccard 只有 **0.407 ± 0.057** —— 删掉
     * 占 16.5%% 字符的整个 `[STATE]` 类,测出来是 0.440,**比噪声底还高**。采样噪声
     * 把信号整个淹掉了。传 0 是为了把「模型的随机性」从「这一行有没有用」里分离
     * 出来;代价是测的不再是生产那个温度下的行为,报告里必须写明这一点。
     */
    temperature?: number;
  },
): Promise<string> {
  const key = opts?.key ?? readDeepseekKey();
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const maxTokens = opts?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS;
  const timeoutMs = opts?.timeoutMs ?? OVERALL_TIMEOUT_MS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(
        fetchImpl,
        DEEPSEEK_URL,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            max_tokens: maxTokens,
            // 省略时不出现在请求体里,保持与生产同形
            ...(opts?.temperature === undefined
              ? {}
              : { temperature: opts.temperature }),
            messages,
          }),
        },
        timeoutMs,
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new DeepseekApiError(
          `DeepSeek API ${res.status}: ${scrubSecrets(detail, key).slice(0, 300)}`,
          res.status,
          isRetryableStatus(res.status),
        );
      }
      const json = (await res.json()) as DeepseekChatResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("DeepSeek 响应缺少 choices[0].message.content");
      }
      return content;
    } catch (e) {
      lastErr = e;
      // A permanent HTTP failure (e.g. 401/400) will fail the exact same
      // way on every retry -- surface it immediately instead of spending
      // the remaining attempts' backoff delay on a call that cannot
      // succeed. Anything else (network-level throw, timeout abort, 429,
      // 5xx) is presumed transient and gets the normal retry treatment.
      if (e instanceof DeepseekApiError && !e.retryable) throw e;
      if (attempt < maxAttempts) await sleep(2 ** (attempt - 1) * 1000);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`DeepSeek 调用失败:${String(lastErr)}`);
}

/** ```json … ``` / ``` … ``` (prose before/after is allowed). Identical
 * pattern to packages/analysis/src/analysis/parseModelJson.ts's FENCE. */
const FENCE = /```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parses the judge's raw output as a single score JSON **object**. Same
 * spirit as @gladlog/analysis's `parseModelJsonArray` (models routinely wrap
 * output in a markdown fence or add a sentence of prose/trailing noise even
 * when told "output only JSON") but cannot be a thin wrapper around it:
 * `parseModelJsonArray` has a deliberate negative contract that a top-level
 * *object* parses to null (documented in parseModelJson.ts -- "a top-level
 * object is a genuine contract violation, not formatting noise" for an
 * array-shaped result). Here the target shape is the opposite: an object is
 * exactly what's wanted, and a top-level *array* would be the contract
 * violation. So this reimplements the same tolerance (fence-strip, then
 * brace-slice) rather than importing, aimed at the mirror-image target.
 *
 * Unlike the array version, brace-slicing is tried even when the payload
 * already starts with `{` -- trailing noise after a well-formed object
 * (`{"score":1} thanks!`) needs the same rescue as leading prose before one.
 *
 * Returns the parsed object, or null when no candidate parses to a plain
 * object (invalid JSON, truncated JSON, or a top-level array/primitive).
 */
export function parseScoreObject(raw: string): unknown | null {
  const t = raw.trim();
  if (!t) return null;

  const fenced = FENCE.exec(t)?.[1]?.trim();
  const payload = fenced || t;

  const candidates = [t];
  if (fenced) candidates.push(fenced);

  const a = payload.indexOf("{");
  const b = payload.lastIndexOf("}");
  if (a !== -1 && b > a) candidates.push(payload.slice(a, b + 1));

  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
