import type { AnthropicLike } from "./ai";

/** Official DeepSeek API backend (OpenAI-compatible chat/completions, SSE
 * streaming). Node 20 has fetch built in, so no new dependency. Note: this is
 * NOT local — the prompt leaves the machine for api.deepseek.com (the user
 * confirmed this is acceptable during brainstorming). */
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// Overall hard cap, kept equal to the CLI backend's TIMEOUT_MS in
// localAiBackends.ts (one product promise that "analysis must not hang
// forever"; two backends must not carry two different limits).
const TIMEOUT_MS = 300_000;
// Stall watchdog: cutting off a missing first byte (res.body never arrives) and
// cutting off a mid-stream freeze (a few chunks arrived, then nothing) use the
// same logic, and the timer restarts on every bit of progress. Why 60s: a
// healthy DeepSeek response (including R1's chain of thought) keeps emitting
// tokens/heartbeats and should never go silent for minutes; 60s absorbs a
// network hiccup or a brief provider-side stall while staying far below the
// 300s overall cap — on a real freeze the user doesn't wait the full 5 minutes
// to see the error, yet a normal short delay isn't killed by mistake.
const STALL_MS = 60_000;

interface SseDelta {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

/** Parses one SSE text line with the newline already stripped. `done: true`
 * means the line was `data: [DONE]`; otherwise the delta decoded from that
 * frame is returned (undefined when there is no content, or on a non-JSON
 * heartbeat line). Factored into one place so that both callers — normal
 * line-by-line parsing and the flush of the leftover buf at end of stream —
 * share a single criterion instead of each writing their own, which would
 * drift. */
function parseSseLine(rawLine: string): { done: boolean; delta?: string } {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return { done: false };
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return { done: true };
  try {
    const j = JSON.parse(payload) as SseDelta;
    // R1's reasoning_content (chain of thought) is deliberately ignored:
    // mixed into the JSON output it would poison parseModelJsonArray.
    // Only consume content.
    const delta = j.choices?.[0]?.delta?.content;
    return { done: false, delta: delta || undefined };
  } catch {
    /* Partial frames are already held by buf; anything reaching here can
       only be a heartbeat/comment line — ignore it. */
    return { done: false };
  }
}

// Generic sk-xxxx shaped token (the common key prefix of DeepSeek/OpenAI-
// compatible providers).
const GENERIC_KEY_RE = /sk-[A-Za-z0-9]+/g;

/** An upstream error body may echo back the request headers (including
 * Authorization) — passing it through verbatim would put key fragments into the
 * UI error banner. Strip the configured key itself plus any sk-xxxx shaped
 * token before rethrowing. */
export function scrubSecrets(text: string, key: string): string {
  let out = text;
  if (key) out = out.split(key).join("[REDACTED]");
  return out.replace(GENERIC_KEY_RE, "[REDACTED]");
}

/**
 * Races `work` against two watchdogs, the overall timeout and the stall
 * timeout: whichever settles first wins. An empty catch is attached to `work`
 * up front so that, if it settles after a watchdog already fired, it does not
 * become an unhandledRejection (common with the late rejection of a mocked or
 * real fetch after abort). `stage` only affects the error wording (connect
 * phase vs mid-stream); the behavior is identical.
 */
async function raceAgainstWatchdogs<T>(
  work: Promise<T>,
  overallDeadline: number,
  stallMs: number,
  stage: "connect" | "stream",
): Promise<T> {
  work.catch(() => {});
  const overallMs = Math.max(0, overallDeadline - Date.now());
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const overallPromise = new Promise<never>((_, reject) => {
    overallTimer = setTimeout(() => {
      reject(
        new Error(`DeepSeek 超时:请求整体超过 ${TIMEOUT_MS / 1000}s 未完成`),
      );
    }, overallMs);
  });
  const stallPromise = new Promise<never>((_, reject) => {
    stallTimer = setTimeout(() => {
      reject(
        new Error(
          stage === "connect"
            ? `DeepSeek 流停滞:连接阶段超过 ${stallMs / 1000}s 未收到响应`
            : `DeepSeek 流停滞:超过 ${stallMs / 1000}s 未收到新数据`,
        ),
      );
    }, stallMs);
  });
  try {
    return await Promise.race([work, overallPromise, stallPromise]);
  } finally {
    clearTimeout(overallTimer);
    clearTimeout(stallTimer);
  }
}

// Abort leftover connections on quit (quitLifecycle #21 item9): track the
// currently active AbortControllers at module level and abort them explicitly
// before the process exits, rather than relying on connections dying once the
// host process is gone — added for completeness, it was not a bug before (once
// the host really exits the connection is necessarily torn down).
const activeControllers = new Set<AbortController>();

/** Called from the quitLifecycle exit hook: abort every in-flight DeepSeek
 * request. */
export function abortAllDeepSeekStreams(): void {
  for (const c of activeControllers) {
    try {
      c.abort();
    } catch {
      // best-effort: the quit path must not stall on an error here.
    }
  }
}

export function deepseekClientFactory(
  key: string,
  fetchImpl: typeof fetch = fetch,
): AnthropicLike {
  return {
    async *stream(params) {
      const controller = new AbortController();
      activeControllers.add(controller);
      // A caller's own cancellation (the self-review deadline) aborts the
      // request too, not only this module's watchdogs (codex review 50-SR-01
      // #2). Listener on a per-call signal: nothing to remove afterwards.
      if (params.signal?.aborted) controller.abort();
      params.signal?.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
      // A fixed absolute deadline: it is NOT reset per chunk, so a connection
      // that keeps making brief progress while blowing past the total budget is
      // still cut off, instead of being kept alive indefinitely by repeatedly
      // renewing the stall window.
      const overallDeadline = Date.now() + TIMEOUT_MS;

      let res: Response;
      try {
        res = await raceAgainstWatchdogs(
          fetchImpl(DEEPSEEK_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: params.model,
              max_tokens: params.max_tokens,
              stream: true,
              messages: [
                ...(params.system
                  ? [{ role: "system", content: params.system }]
                  : []),
                ...params.messages,
              ],
            }),
            signal: controller.signal,
          }),
          overallDeadline,
          STALL_MS,
          "connect",
        );
      } catch (e) {
        controller.abort();
        activeControllers.delete(controller);
        throw e;
      }
      if (!res.ok || !res.body) {
        activeControllers.delete(controller);
        const detail = await res.text().catch(() => "");
        throw new Error(
          `DeepSeek API ${res.status}: ${scrubSecrets(detail, key).slice(0, 300)}`,
        );
      }
      const decoder = new TextDecoder();
      let buf = "";
      // Whether a real `[DONE]` was received. If this is still false when the
      // stream physically ends (iterator done), the server disconnected early —
      // that must not be waved through as a normal finish, or the half-written
      // coaching text produced so far would be delivered as a complete result
      // (observed: 3/220 matches, truncation landing at 1200–2100 characters,
      // nowhere near max_tokens).
      let sawDone = false;
      const iterator = (res.body as unknown as AsyncIterable<Uint8Array>)[
        Symbol.asyncIterator
      ]();
      try {
        while (true) {
          const { value, done } = await raceAgainstWatchdogs(
            iterator.next(),
            overallDeadline,
            STALL_MS,
            "stream",
          );
          if (done) {
            // First call decoder.decode() with no argument as a final flush:
            // in {stream:true} mode, if the previous value happened to end in
            // the middle of a multi-byte UTF-8 sequence, the bytes of that half
            // character stay in the decoder's internal state and appear in no
            // decode() return value. Once the stream has physically ended no
            // further value will complete them, so without an explicit argument-
            // less flush here those bytes are discarded along with the decoder —
            // silently, without even a U+FFFD replacement character (verified:
            // it is not "parse failure" but "never reached buf" at all). Only
            // after this flush is buf the complete decoding of every byte this
            // connection received, which is what makes the logic below — scan
            // whole lines, then handle a trailing frame with no newline — valid.
            buf += decoder.decode();
            // Flush the leftover buf: it may still hold a complete frame with
            // no trailing newline (the server cut the connection right after
            // the JSON frame, before the newline). Scan whole lines first (in
            // case buf still contains internal newlines), then try parsing the
            // remaining newline-less tail as a standalone frame — if it parses,
            // that is the frame's delta; if not, it really is a partial/empty
            // tail and is ignored.
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              const parsed = parseSseLine(line);
              if (parsed.done) {
                sawDone = true;
                break;
              }
              if (parsed.delta) yield { delta: parsed.delta };
            }
            if (!sawDone && buf.trim()) {
              const parsed = parseSseLine(buf);
              if (parsed.done) sawDone = true;
              else if (parsed.delta) yield { delta: parsed.delta };
            }
            if (!sawDone) {
              throw new Error(
                "DeepSeek 流异常提前结束(未收到 [DONE]):服务端提前断连,输出可能被截断,已按失败处理",
              );
            }
            return;
          }
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            const parsed = parseSseLine(line);
            if (parsed.done) {
              sawDone = true;
              return;
            }
            if (parsed.delta) yield { delta: parsed.delta };
          }
        }
      } catch (e) {
        controller.abort();
        throw e;
      } finally {
        // for-await-of automatically calls the iterator's return() to clean up
        // on an early return/throw; driving the iterator by hand (needed to race
        // it against the watchdogs) removes that automatic behavior, so it is
        // restored here — otherwise an early exit via [DONE] or a watchdog would
        // leave the connection open.
        if (typeof iterator.return === "function") {
          iterator.return().catch(() => {});
        }
        activeControllers.delete(controller);
      }
    },
  };
}
