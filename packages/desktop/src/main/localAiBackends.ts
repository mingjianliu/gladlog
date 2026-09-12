import { spawn } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agyCliModelName, type CliAiBackend } from "../shared/aiModels";
import type { AnthropicLike } from "./ai";
import {
  type CliVersionProbe,
  detectLocalCliCached,
  isWindowsBatchFile,
  type LocalCliTool,
  probeCliVersionCached,
} from "./cliDetect";

// `claude -p` carries agentic overhead and is slow on big prompts (minutes);
// agy/Gemini is much faster. Generous ceiling so a real completion can land.
const TIMEOUT_MS = 300_000;
// Auto-incrementing sequence for codex `-o` temp file names: one main process
// can have two streams in flight at once (onRunAll firing analysis + compare
// together is a real scenario), and plain Date.now()+pid collides within the
// same millisecond — a counter guarantees uniqueness within the process, so
// Date.now() can be dropped.
let codexTmpSeq = 0;
// Sequence for agy over-limit prompt spill files; same uniqueness reasoning.
let agyTmpSeq = 0;

// agy/codex spill files (full match prompt / model reply) each get their own
// dedicated subdirectory rather than the whole OS temp dir — 2026-07-31 audit
// Important: agy's `--add-dir tmpdir()` used to grant the agy sandbox read
// access to the entire OS temp dir (every other program's and every other
// user's temp files were inside the grant), while agy only needs to read this
// one prompt file. The P0 fix (see the large comment below) made spilling the
// **constant path** for win32 .cmd/.bat (no more length-based branching), so
// this over-broad grant would now be hit on every single Windows agy call —
// narrowing it went from "extreme case" to "matters every time".
// exported so tests can assert --add-dir narrows to this exact path (not
// tmpdir()) and can plant/inspect files in it directly.
export const AGY_PROMPT_SPILL_DIR = join(tmpdir(), "gladlog-agy-prompts");
// codex's `-o` output file is written by the codex process itself (not by a
// writeFileSync in this file), so it gets no "we set the mode when writing"
// protection. A dedicated subdirectory plus restrictive permissions on the
// directory itself (0o700 on POSIX denies other users from traversing into it,
// regardless of the mode on each file inside) is the only lever available on
// this path.
export const CODEX_OUT_SPILL_DIR = join(tmpdir(), "gladlog-codex-out");

// Each spill subdirectory is swept once per process (triggered on the first
// spill inside the module, not at import time — tests import this module
// heavily and never spill, and should not pay that cost / side effect).
const sweptSpillDirs = new Set<string>();
// Staleness criterion: agy runs with --print-timeout 110s and codex with an
// overall TIMEOUT_MS of 300s, so the lifetime of a spill file in a normal call
// is on the order of "the duration of the function call"; 1 hour is tens of
// times that margin — a file older than that can only be a leftover from a
// previous process that was killed / crashed and exited before reaching the
// finally cleanup (a full match prompt, containing match data).
const STALE_SPILL_MS = 60 * 60 * 1000;

/**
 * Ensure the spill subdirectory exists (created 0o700 where possible, so only
 * the current user can enter it) and sweep files inside it older than
 * STALE_SPILL_MS — match prompts left behind by a previous process that
 * crashed / was killed and never got its finally cleanup. Done once per
 * directory per process (see sweptSpillDirs); callers invoke it before every
 * spill, and the cost is negligible. Entirely best-effort: no step failing
 * here should block a normal AI call — worst case the next process sweeps
 * again.
 *
 * exported so tests can drive it directly against a throwaway directory
 * (planting a backdated stale file + a fresh one) without depending on
 * agyClientFactory/codexClientFactory's internal spill timing.
 */
export function ensureSpillDirSwept(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // Directory already exists, or the platform ignores that mode — neither
    // affects the writeFileSync that follows, so continue.
  }
  if (sweptSpillDirs.has(dir)) return;
  sweptSpillDirs.add(dir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > STALE_SPILL_MS) unlinkSync(p);
    } catch {
      // Concurrent cleanup / permission problem: best-effort, skip this file.
    }
  }
}

/**
 * A CLI runner: spawn `file` with `args` (NO shell — args are an array, so
 * match data in the prompt can never be interpreted by a shell), write `stdin`,
 * resolve stdout. Non-zero exit / spawn error / timeout reject.
 *
 * `opts.signal` (optional 4th param): callers (coach chat follow-ups) can pass
 * an AbortSignal to cancel an in-flight call — defaultRun SIGKILLs the child
 * process and rejects with `new Error("aborted")`. Existing call sites / test
 * stubs that omit the 4th param keep working (optional param, signature is
 * backward compatible).
 *
 * `opts.onStdoutLine` (假流式修复,2026-08-21):按行实时回调 stdout —— 每凑齐
 * 一个 `\n` 结尾的完整行就解码回调一次(去掉行尾 \r,收尾时冲刷最后一个未
 * 换行的残行)。切分在 Buffer 层做(找 0x0A 字节),完整行才解码,所以多
 * 字节 UTF-8 跨 chunk 边界不会像逐 chunk toString 那样吐 U+FFFD(与下面
 * outChunks 一次性解码是同一个教训,粒度改成行)。回调抛错不影响主流程。
 * 最终 resolve 的完整 stdout 不受此回调影响,两者并存。
 */
export type Runner = (
  file: string,
  args: string[],
  stdin: string,
  opts?: { signal?: AbortSignal; onStdoutLine?: (line: string) => void },
) => Promise<string>;

// On win32, if the resolved CLI binary is a .cmd/.bat (the usual shim shape
// for npm global installs), recent Node versions throw EINVAL for
// `spawn(file, args)` on a .cmd/.bat directly (the CVE-2024-27980 fix, which
// forces an explicit `shell: true`) — that is why defaultRun manually wraps
// with `spawn("cmd.exe", ["/c", file, ...args])`. But cmd.exe **re-parses**
// the command line Node assembled from the argv array using MSVCRT quoting
// conventions: `&`/`|` split it into two commands, `^` escapes, `%NAME%`
// expands environment variables, and an unbalanced `"` shifts every following
// argument boundary. That is a completely different syntax from the quoting
// convention Node assumes when building the CreateProcess command line — the
// argv array's "one element = one argument" boundary simply does not hold in
// cmd.exe's eyes.
//
// The agy backend used to push the full prompt (match text, whose HP
// percentages contain `%` — a near-certain hit) through this argv via
// `--print <prompt>`, spilling to disk only above 7000 characters — in effect
// a local command-injection / reliability hazard (2026-07-31 audit Critical).
// The fix is two layers, belt and braces:
//   1) agyClientFactory: on win32, whenever the resolved path is a .cmd/.bat,
//      always route through a spill file (winPromptLimit is constantly 0 for
//      .cmd/.bat, no more 7000-character branching) — argv then carries only
//      a temp file path gladlog wrote itself plus a fixed English instruction,
//      and no match/model-controlled text ever reaches argv.
//   2) The .cmd/.bat branch of defaultRun additionally runs
//      assertNoWindowsCmdMetacharacters as a backstop: if some future change
//      puts uncontrolled content back into argv, it throws instead of running
//      with the injection risk.
// We did not switch to `spawn(file, args, { shell: true })` in place of the
// manual cmd.exe wrapper: Node's internal escaping rules for `shell: true` on
// Windows cannot be validated against real cmd.exe behavior from this mac, and
// swapping in an unauditable implicit escaping scheme is no safer than
// "explicit wrapper + explicit guard" — hence the manual wrapper plus explicit
// validation stays.
//
// claudeCliClientFactory/codexClientFactory can hit this same .cmd branch on
// win32 (npm global installs of claude/codex also commonly land as .cmd
// shims), but their argv holds only fixed flag strings, the model name passed
// by the caller (`params.model`, from a whitelisted UI dropdown, not
// model-generated text), and codex's `-o` temp file path (built by gladlog via
// `join(tmpdir(), ...)`) — the prompt itself goes over stdin, never argv.
// Neither is affected by this note; the guard still covers them and is
// expected to always pass.
const WIN_CMD_METACHAR_RE = /[&|^%<>]/;

/** See the large comment above: argv backstop check for defaultRun's manual
 * cmd.exe wrapping. */
export function assertNoWindowsCmdMetacharacters(
  args: string[],
  file: string,
): void {
  for (const arg of args) {
    if (WIN_CMD_METACHAR_RE.test(arg)) {
      throw new Error(
        `内部错误:传给 ${file}(经 cmd.exe 执行的 .cmd/.bat)的参数含 cmd.exe ` +
          `元字符(& | ^ % < > 之一)——cmd.exe 重新解析 argv 时会把它当命令 ` +
          `语法而非字面文本,已拒绝执行。这类内容必须先落盘,argv 只传文件路径。`,
      );
    }
    if ((arg.match(/"/g) ?? []).length % 2 !== 0) {
      throw new Error(
        `内部错误:传给 ${file}(经 cmd.exe 执行的 .cmd/.bat)的参数含不平衡的 ` +
          `双引号——cmd.exe 重新解析时会让后续参数边界整体错位,已拒绝执行。`,
      );
    }
  }
}

// exported so tests can feed a mock child process directly (multi-byte UTF-8
// chunk-boundary regression test) without going through the Runner seam that
// every other test in this file uses to bypass defaultRun entirely.
//
// quitLifecycle #21 item9: on quit we must also reap in-flight CLI child
// processes, rather than relying on them being orphaned once the host process
// dies — for completeness, track the currently active children and have the
// quit hook call killAllCliChildren() to SIGKILL them all at once.
const activeChildren = new Set<ReturnType<typeof spawn>>();

/** Called from the quitLifecycle quit hook: SIGKILL every CLI child process
 * still in flight. */
export function killAllCliChildren(): void {
  for (const c of activeChildren) {
    try {
      c.kill("SIGKILL");
    } catch {
      // best-effort: the quit flow must not stall on an error here.
    }
  }
}

export const defaultRun: Runner = (file, args, stdin, opts) =>
  new Promise((resolve, reject) => {
    // Already aborted at call time: do not spawn, reject immediately — common
    // when the follow-up chat UI is switched/unmounted in quick succession,
    // and we should not leave a child in flight whose result nobody observes.
    if (opts?.signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const isWinBatch = isWindowsBatchFile(file);
    if (isWinBatch) assertNoWindowsCmdMetacharacters(args, file);
    const child = isWinBatch
      ? spawn("cmd.exe", ["/c", file, ...args], {
          stdio: ["pipe", "pipe", "pipe"],
        })
      : spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    activeChildren.add(child);
    // Accumulate Buffers and decode once at the end — a per-chunk
    // `+= d.toString()` decodes each half into U+FFFD garbage when a
    // multi-byte UTF-8 character (Chinese and friends) is split across a chunk
    // boundary (hit for real in a 300-match agy simulation; production
    // aiLanguage defaults to zh).
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    // onStdoutLine 的行装配缓冲:未凑齐换行的字节先攒着(见 Runner 注释)。
    let linePending: Buffer = Buffer.alloc(0);
    const onLine = opts?.onStdoutLine;
    const emitLine = (buf: Buffer) => {
      let line = buf.toString("utf8");
      if (line.endsWith("\r")) line = line.slice(0, -1);
      try {
        onLine!(line);
      } catch {
        // 行回调是旁路(预览/进度),它抛错不能影响 CLI 调用本身。
      }
    };
    const feedLines = (chunk: Buffer) => {
      linePending = linePending.length
        ? Buffer.concat([linePending, chunk])
        : chunk;
      let nl: number;
      while ((nl = linePending.indexOf(0x0a)) !== -1) {
        emitLine(linePending.subarray(0, nl));
        linePending = linePending.subarray(nl + 1);
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${file} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    const onAbort = () => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      activeChildren.delete(child);
      reject(new Error("aborted"));
    };
    if (opts?.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout.on("data", (d) => {
      const buf = Buffer.from(d);
      outChunks.push(buf);
      if (onLine) feedLines(buf);
    });
    child.stderr.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      opts?.signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      opts?.signal?.removeEventListener("abort", onAbort);
      // 冲刷最后一个没有换行结尾的残行(JSONL 的收尾行常无 \n)。
      if (onLine && linePending.length) {
        emitLine(linePending);
        linePending = Buffer.alloc(0);
      }
      if (code === 0) resolve(Buffer.concat(outChunks).toString("utf8"));
      else
        reject(
          new Error(
            `${file} exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 300)}`,
          ),
        );
    });
    child.stdin.end(stdin);
  });

/**
 * Auto-detect (PATH + common install directories, see cliDetect.ts); if
 * nothing is found, throw an explicit, user-facing error — we used to return
 * the bare command name, so a failure only surfaced as an ENOENT at spawn
 * time, which users could not interpret at all. The error now points straight
 * at the settings page.
 */
async function requireCli(tool: LocalCliTool): Promise<string> {
  const path = await detectLocalCliCached(tool);
  if (path) return path;
  // A missing node must not point users at the "command path" field: that
  // field holds the agy script/binary, and filling it with a node path makes
  // it be treated as a direct agy binary, so node gets launched with --print
  // and immediately errors on the argument (agy flash review #5).
  if (tool === "node") {
    throw new Error(
      "未检测到 node(.mjs 包装脚本模式需要 Node.js):请安装 Node.js,或清空命令路径改用自动检测的 agy 直调",
    );
  }
  throw new Error(
    `未检测到 ${tool} 命令:请先安装,或在 设置 → AI 分析 → 命令路径 填写完整路径`,
  );
}

/**
 * Resolve the CLI path and kick off a version probe along the way (only for
 * auto-detected paths; with a hand-entered command path there is no notion of
 * a "detected version", so we do not probe — see how withVersionHint handles a
 * null versionProbe). Audit #21 item6.
 */
async function resolveCliWithVersionProbe(
  tool: LocalCliTool,
  explicitCmd?: string,
): Promise<{ cmd: string; versionProbe: Promise<CliVersionProbe> | null }> {
  if (explicitCmd) return { cmd: explicitCmd, versionProbe: null };
  const cmd = await requireCli(tool);
  return { cmd, versionProbe: probeCliVersionCached(tool, cmd) };
}

/**
 * On a failed call, append the version-probe result (either "detected <tool>
 * version <v>" or "version probe failed") to the error message, giving the
 * user a "possible version incompatibility" lead instead of bare stderr. When
 * `versionProbe` is null (hand-entered command path, no auto-detection) the
 * error is rethrown unchanged. A lightweight hint only — no version gate or
 * compatibility matrix.
 *
 * exported so tests can drive the threading behavior directly (with a
 * hand-built versionProbe promise) without exercising the full
 * requireCli auto-detect chain, which would otherwise spawn real
 * subprocesses in unit tests.
 */
export async function withVersionHint<T>(
  fn: () => Promise<T>,
  tool: LocalCliTool,
  versionProbe: Promise<CliVersionProbe> | null,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A user-initiated cancel (the bare Error("aborted") rejected by
    // defaultRun's AbortSignal handling) is rethrown as-is, with no version
    // hint — continueCliChat takes the production-default auto-detect path
    // (input.cmd not hand-entered), so versionProbe is non-null; without this
    // short circuit, "aborted" would be rewritten into
    // "aborted(detected <tool> version <v>, possible version mismatch)" and
    // every downstream check that exact-matches err.message === "aborted" to
    // tell "user cancelled" apart from "the call really failed" would break
    // (which would defeat the whole point of making coach chat abortable, via
    // our own error-wrapping layer). Fixed in coach-chat task-5 review.
    if (msg === "aborted") throw e instanceof Error ? e : new Error(msg);
    if (!versionProbe) throw e instanceof Error ? e : new Error(msg);
    const probe = await versionProbe;
    const hint = probe.ok
      ? `检测到的 ${tool} 版本 ${probe.version}`
      : "版本探测失败";
    throw new Error(`${msg}(${hint},可能版本不兼容)`);
  }
}

// Local CLI backends have no separate system channel: the system text is
// prepended to the prompt.
const joinPrompt = (params: {
  system?: string;
  messages: { content: string }[];
}): string =>
  [params.system, ...params.messages.map((m) => m.content)]
    .filter((s): s is string => !!s)
    .join("\n");

/**
 * claude CLI 后端 —— 真流式(假流式修复,2026-08-21,本机 smoke 实证事件
 * 形状与时序):`claude -p --verbose --output-format stream-json
 * --include-partial-messages`,prompt 走 stdin,stdout 是 JSONL 事件流,
 * `content_block_delta`/`text_delta` 逐 token 到达 —— 经 Runner 的
 * onStdoutLine 逐行解析、实时 yield delta,analysis.ts 现成的
 * delta→renderer 预览管线(API 后端在用的那条)直接受益,渲染层零改动。
 * (stream-json 在 -p 下强制要求 --verbose,CLI 自身的约束。)
 *
 * 权威终文 = 收尾 `result` 事件的 `result` 字段:正常情况下等于 delta 拼接;
 * 若 delta 拼接是 result 的前缀(理论上多 message 场景)补发差尾,空拼接则
 * 整段补发 —— 消费方 `raw += delta` 的语义保持「拼起来就是完整回复」。
 *
 * 兜底两层(老版本/异构 CLI,与既有 Runner 测试桩兼容):
 *  1. 调用失败且**一行 stream-json 都没解析出来**(多半是老 CLI 不认新
 *     flag)→ 回退老参数 `--output-format text` 重试一次,整段 yield;
 *     用户主动 abort 不回退,原样抛。
 *  2. 调用成功但没解析出任何事件(测试桩直接 resolve 纯文本 / 异构输出)
 *     → 把 resolve 的 stdout 当整段回复 yield。
 *
 * `parent_tool_use_id` 非空的 delta 丢弃 —— 那是子代理/工具产出,不是给
 * 用户的回复文本(-p 问答本不该出现,防御性守卫)。
 */
export function claudeCliClientFactory(opts?: {
  cmd?: string;
  run?: Runner;
}): AnthropicLike {
  const run = opts?.run ?? defaultRun;
  return {
    async *stream(params) {
      const { cmd, versionProbe } = await resolveCliWithVersionProbe(
        "claude",
        opts?.cmd,
      );
      const sessionArgs = params.sessionIdHint
        ? ["--session-id", params.sessionIdHint]
        : [];
      const prompt = joinPrompt(params);
      // Final review F1(沿用): forward the signal — when the user hits Stop
      // during the coach chat seeding phase, defaultRun can really SIGKILL
      // this child instead of letting it finish in the background.
      const legacyCall = () =>
        run(
          cmd,
          [
            "-p",
            "--output-format",
            "text",
            "--model",
            params.model,
            ...sessionArgs,
          ],
          prompt,
          { signal: params.signal },
        );

      // 行解析状态 + 生成器与 onStdoutLine 之间的手写队列(回调是同步世界,
      // 生成器是异步世界,queue+notify 是最小的桥)。
      const queue: string[] = [];
      let notify: (() => void) | null = null;
      const wake = () => {
        const n = notify;
        notify = null;
        n?.();
      };
      let sawStreamJson = false;
      // 对象属性而非裸 let:赋值只发生在 onStdoutLine 闭包里,TS 的控制流
      // 分析对裸 let 会按初值把它钉成 null(下方判空直接收窄成 never)。
      const parsed = { finalResult: null as string | null };
      const onStdoutLine = (line: string) => {
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return; // 非 JSON 行(异构输出)整体走兜底 2
        }
        if (typeof obj !== "object" || obj === null) return;
        sawStreamJson = true;
        if (obj.type === "result" && typeof obj.result === "string") {
          parsed.finalResult = obj.result;
          return;
        }
        if (obj.type !== "stream_event" || obj.parent_tool_use_id != null)
          return;
        const event = obj.event as
          | { type?: string; delta?: { type?: string; text?: string } }
          | undefined;
        if (
          event?.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          typeof event.delta.text === "string"
        ) {
          queue.push(event.delta.text);
          wake();
        }
      };

      let done = false;
      let runErr: unknown = null;
      let stdout = "";
      const runPromise = withVersionHint(
        () =>
          run(
            cmd,
            [
              "-p",
              "--verbose",
              "--output-format",
              "stream-json",
              "--include-partial-messages",
              "--model",
              params.model,
              ...sessionArgs,
              ...CLAUDE_CLI_ISOLATION_ARGS,
            ],
            prompt,
            { signal: params.signal, onStdoutLine },
          ),
        "claude",
        versionProbe,
      );
      runPromise.then(
        (out) => {
          stdout = out;
          done = true;
          wake();
        },
        (e) => {
          runErr = e;
          done = true;
          wake();
        },
      );

      let acc = "";
      for (;;) {
        while (queue.length) {
          const d = queue.shift()!;
          acc += d;
          yield { delta: d };
        }
        if (done) break;
        await new Promise<void>((res) => {
          notify = res;
        });
      }
      // done 置位与最后几行的解析同属 close 处理的同步序列,理论上上面的
      // 循环已排空;再排一次是防御(队列语义上 done 后不该再进新项)。
      while (queue.length) {
        const d = queue.shift()!;
        acc += d;
        yield { delta: d };
      }

      if (runErr) {
        const msg = runErr instanceof Error ? runErr.message : String(runErr);
        if (sawStreamJson || msg === "aborted" || msg.startsWith("aborted("))
          throw runErr;
        // 兜底 1:老版本 CLI 不认 stream-json 相关 flag —— 回退整段文本模式
        const out = await withVersionHint(legacyCall, "claude", versionProbe);
        yield { delta: out };
        if (params.sessionIdHint) yield { sessionId: params.sessionIdHint };
        return;
      }
      const fin = parsed.finalResult;
      if (fin !== null && fin !== acc) {
        if (acc === "") yield { delta: fin };
        else if (fin.startsWith(acc)) yield { delta: fin.slice(acc.length) };
        // 其余错位(理论上不该发生):已流出的 delta 无法收回,保持 acc。
      } else if (!sawStreamJson && acc === "" && stdout) {
        yield { delta: stdout }; // 兜底 2
      }
      if (params.sessionIdHint) yield { sessionId: params.sessionIdHint };
    },
  };
}

/**
 * `codex exec - -m <model> --sandbox read-only --skip-git-repo-check
 * --ephemeral -o <tmpfile>`, prompt on stdin.
 *
 * Why a `-o` tmpfile instead of reading stdout: codex's stdout interleaves
 * agent/tool-call log lines with the final answer, so naively taking stdout
 * would hand the prompt-quality gates a blob full of noise instead of a
 * clean completion (the same shape of bug the `stripAgyHeader` fix above
 * addresses for agy, just worse — codex's log isn't a single strippable
 * header line). `-o <file>` writes exactly the final response with nothing
 * else, so that's the primary source; stdout is only a fallback for older/
 * different codex builds that don't honor `-o`, not the intended path.
 *
 * The fallback criterion is "did the file read succeed", not "is the file
 * content non-empty" — a model legitimately returning an empty string is
 * possible, and treating that as "invalid file" would instead hand upstream
 * the dirty stdout with agent logs mixed in, which is worse than an empty
 * reply. Only readFileSync itself throwing (file missing, e.g. an older codex
 * that does not know `-o`) falls back to stdout.
 *
 * With captureSession the args include --json and omit --ephemeral, so stdout
 * is JSONL rather than human text; we parse it for the session id but still
 * take the answer from the -o file. If the -o file cannot be read, delta is
 * the empty string (we do not fall back to the dirty stdout).
 */
export function codexClientFactory(opts?: {
  cmd?: string;
  run?: Runner;
}): AnthropicLike {
  const run = opts?.run ?? defaultRun;
  return {
    async *stream(params) {
      const { cmd, versionProbe } = await resolveCliWithVersionProbe(
        "codex",
        opts?.cmd,
      );
      ensureSpillDirSwept(CODEX_OUT_SPILL_DIR);
      const outFile = join(
        CODEX_OUT_SPILL_DIR,
        `gladlog-codex-${process.pid}-${++codexTmpSeq}.txt`,
      );
      const sessionArgs = params.captureSession ? ["--json"] : ["--ephemeral"];
      let stdout: string;
      try {
        stdout = await withVersionHint(
          () =>
            run(
              cmd,
              [
                "exec",
                "-",
                "-m",
                params.model,
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                ...sessionArgs,
                "--color",
                "never",
                "-o",
                outFile,
              ],
              joinPrompt(params),
              // Final review F1: as in claudeCliClientFactory, forward the
              // seeding-phase signal.
              { signal: params.signal },
            ),
          "codex",
          versionProbe,
        );
        let delta = params.captureSession ? "" : stdout;
        try {
          delta = readFileSync(outFile, "utf-8");
        } catch {
          // -o file missing (older codex that does not know the flag, etc.)
          // With captureSession: no fallback (stdout is JSONL, not human text)
          // Without captureSession: fall back to stdout
          if (!params.captureSession) {
            delta = stdout;
          }
        }
        yield { delta };
        if (params.captureSession) {
          const sid = parseCodexSessionId(stdout);
          if (sid) yield { sessionId: sid };
        }
      } finally {
        try {
          unlinkSync(outFile);
        } catch {
          // best-effort cleanup; the file may legitimately not exist.
        }
      }
    },
  };
}

/**
 * CodeBuddy Code CLI (`cbc`) JSON output envelope parser.
 *
 * Fact (measured on cbc 2.97.5, 2026-08-26): `--output-format json` returns
 * a **JSON array of events**, not a single object. A typical one-shot run has
 * 5 events: user message → file-history-snapshot → reasoning → assistant
 * message → result. The assistant message carries:
 *   - `sessionId` (string, the resumable session id)
 *   - `content`: array of blocks, each `{ type: "output_text", text: "..." }`
 *
 * This parser handles both the event-array format (primary) and a flat single
 * object (defensive, in case a future version changes the envelope). Returns
 * null when no response text can be located — the caller then falls back to
 * treating stdout as plain text. A missing session id is non-fatal.
 */
export function parseCodebuddyJsonEnvelope(stdout: string): {
  sessionId: string | null;
  response: string;
} | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());

    // -- Primary: JSON array of cbc events --
    if (Array.isArray(parsed)) {
      let response = "";
      let sessionId: string | null = null;
      for (const ev of parsed) {
        if (!ev || typeof ev !== "object") continue;
        const e = ev as Record<string, unknown>;
        // Assistant message: concatenate text from all content blocks
        // (block.type is "output_text" in cbc 2.x, but we match on any
        //  block carrying a string `text` to be version-tolerant).
        if (e.type === "message" && e.role === "assistant") {
          if (typeof e.sessionId === "string" && e.sessionId) {
            sessionId = e.sessionId;
          }
          if (Array.isArray(e.content)) {
            for (const block of e.content) {
              if (
                block &&
                typeof block === "object" &&
                typeof (block as Record<string, unknown>).text === "string"
              ) {
                response += (block as Record<string, unknown>).text as string;
              }
            }
          }
        }
        // `result` event may carry the final text as a fallback
        if (e.type === "result" && typeof e.result === "string" && !response) {
          response = e.result;
        }
        // sessionId might appear on non-assistant events too
        if (!sessionId && typeof e.sessionId === "string" && e.sessionId) {
          sessionId = e.sessionId;
        }
      }
      if (response) return { sessionId, response };
      return null;
    }

    // -- Fallback: flat single object (version-tolerant) --
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      let response = "";
      for (const key of ["response", "content", "text", "output"]) {
        if (typeof obj[key] === "string" && obj[key]) {
          response = obj[key] as string;
          break;
        }
      }
      if (
        !response &&
        typeof obj.message === "object" &&
        obj.message !== null
      ) {
        const msg = obj.message as Record<string, unknown>;
        if (typeof msg.content === "string") response = msg.content;
      }
      if (!response) return null;
      let sessionId: string | null = null;
      for (const key of [
        "sessionId",
        "session_id",
        "conversation_id",
        "thread_id",
        "id",
      ]) {
        if (typeof obj[key] === "string" && obj[key]) {
          sessionId = obj[key] as string;
          break;
        }
      }
      return { sessionId, response };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * CodeBuddy Code CLI 后端 —— 接口与 Claude CLI 高度同构
 * (`-p --output-format stream-json --include-partial-messages --model`),
 * 但有两个关键差异:
 *
 * 1. **必须禁用工具**:codebuddy 的 `-p` 模式默认可以调用文件读写/命令执行
 *    等 agentic 工具,gladlog 是纯 Q&A(prompt 已包含全部对局数据),加
 *    `--tools ""` 禁用全部内置工具,从根源消除非交互模式下的权限弹窗。
 *    `--max-turns 1` 是第二道保险,防止任何 agentic 循环。
 * 2. **会话恢复走 captureSession 模式**(与 agy/codex 同组,而非 claudeCli 的
 *    `--session-id` 预生成 UUID):seeding 时切到 `--output-format json`,
 *    从返回的事件数组里解析 assistant 消息的 text 和 sessionId;follow-up 时
 *    用 `--resume <id>`。
 * 3. **非 captureSession 路径(对比分析)用 text 模式**:cbc 的 stream-json
 *    事件格式与 Anthropic 不同(发 message/result/reasoning 事件,不是
 *    content_block_delta/text_delta),实时流式需要单独写解析器;对比面板不
 *    需要中途 delta(显示「对比中…」,完成后整段替换),text 模式更简单可靠。
 */
/**
 * claude CLI isolation args — **single source**, used by the analysis stream call
 * (claudeCliClientFactory) and the coach-chat resume (continueCliChat).
 *
 * `claude -p` otherwise loads the user's whole Claude Code environment into every
 * coach analysis: measured 2026-09-12 on a dev machine, 105 tools (72 of them from
 * 6 MCP servers — Gmail, Slack, Drive, Calendar…), 50 skills, 4 plugins, in
 * permission mode `auto`. That is ~24k tokens of fixed per-call overhead vs ~7.7k
 * with these args (haiku probe, trivial prompt), and it hands a combat log — whose
 * player names are arbitrary third-party text — a set of tools that can send mail.
 * gladlog is single-turn Q&A with the whole match in the prompt; it needs none.
 *
 * `--tools=` (not `--tools ""`): same effect (0 tools, verified), and no empty argv
 * element, which is the Windows cmd-shim hazard documented on CODEBUDDY_SAFETY_ARGS.
 * `--setting-sources` is deliberately NOT narrowed: it would also drop plugins and
 * hooks, but user settings are where some users configure apiKeyHelper / proxy env,
 * so it could break their auth.
 * Not added to the legacy text-mode fallback, which exists for CLIs too old to know
 * newer flags.
 */
export const CLAUDE_CLI_ISOLATION_ARGS = [
  "--tools=",
  "--strict-mcp-config",
  "--disable-slash-commands",
] as const;

/**
 * codebuddy 专属安全参数 —— **单源**,factory 与 `continueCliChat` 两个调用点
 * 共用(PR #35 review #2:安全相关事实不允许两处手写,漂移是静默的)。
 * `--tools ""` 禁用全部内置工具(gladlog 是纯 Q&A,prompt 含全部对局数据,
 * 从根源消除非交互模式下的权限弹窗);`--max-turns 1` 防 agentic 循环。
 *
 * ⚠ Windows 注意(review #3,未验证):npm 全局安装在 win 落地为 `cbc.cmd`,
 * 走 `run()` 的 cmd.exe /c 包装 + shim `%*` 转发 —— 空字符串 argv 能否原样
 * 穿过这条链路没有先例。若被吞,`--tools` 会把 `--max-turns` 吃成自己的值,
 * 等于工具全开的 agentic 模式。改动本常量形式(如 `--tools=`)前必须过一次
 * win 真机验证。
 */
export const CODEBUDDY_SAFETY_ARGS = [
  "--tools",
  "",
  "--max-turns",
  "1",
] as const;

export function codebuddyClientFactory(opts?: {
  cmd?: string;
  run?: Runner;
}): AnthropicLike {
  const run = opts?.run ?? defaultRun;
  // (可执行文件名为 cbc,见 BACKEND_CLI_TOOL.codebuddy;LocalCliTool 类型用 "cbc")
  const SAFETY_ARGS = CODEBUDDY_SAFETY_ARGS;
  return {
    async *stream(params) {
      const { cmd, versionProbe } = await resolveCliWithVersionProbe(
        "cbc",
        opts?.cmd,
      );
      const prompt = joinPrompt(params);

      // -- Coach chat seeding: json output, parse session id --
      if (params.captureSession) {
        const out = await withVersionHint(
          () =>
            run(
              cmd,
              [
                "-p",
                "--output-format",
                "json",
                "--model",
                params.model,
                ...SAFETY_ARGS,
              ],
              prompt,
              { signal: params.signal },
            ),
          "cbc",
          versionProbe,
        );
        const env = parseCodebuddyJsonEnvelope(out);
        if (env) {
          yield { delta: env.response };
          if (env.sessionId) yield { sessionId: env.sessionId };
          return;
        }
        // Envelope parse failed: fall back to plain text, no session event
        yield { delta: out };
        return;
      }

      // -- Non-captureSession (comparison analysis): text mode --
      // cbc's stream-json event format differs from Anthropic's (it emits
      // message/result/reasoning events, not content_block_delta/text_delta),
      // so real-time streaming would need a separate parser. The comparison
      // panel does not need mid-run deltas (it shows "对比中…" and replaces
      // the whole text on done), so text mode is simpler and reliable.
      const out = await withVersionHint(
        () =>
          run(
            cmd,
            [
              "-p",
              "--output-format",
              "text",
              "--model",
              params.model,
              ...SAFETY_ARGS,
            ],
            prompt,
            { signal: params.signal },
          ),
        "cbc",
        versionProbe,
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

/** Session id from codex's `--json` JSONL event stream: JSON.parse line by
 * line and take the first `session_id` or `thread_id` value shaped like a
 * UUID; returns null if nothing parses out of the whole stream. */
export function parseCodexSessionId(stdoutJsonl: string): string | null {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const line of stdoutJsonl.split("\n")) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const key of ["session_id", "thread_id"]) {
        const v = obj[key];
        if (typeof v === "string" && UUID_RE.test(v)) return v;
      }
    } catch {
      /* skip non-json lines */
    }
  }
  return null;
}

/** agy `--output-format json` envelope: {conversation_id, status, response, …}.
 * Returns null if the whole thing fails to parse (older agy / truncated
 * output) — the caller then falls back to plain text; the main analysis flow
 * must never fail because session capture failed (coach chat spec). */
export function parseAgyJsonEnvelope(stdout: string): {
  conversationId: string | null;
  status: string | null;
  response: string;
} | null {
  try {
    const obj = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (typeof obj.response !== "string") return null;
    return {
      conversationId:
        typeof obj.conversation_id === "string" ? obj.conversation_id : null,
      status: typeof obj.status === "string" ? obj.status : null,
      response: obj.response,
    };
  } catch {
    return null;
  }
}

// agy can only take the prompt via argv (no stdin/file channel). When spawning
// an .exe directly (no cmd.exe re-parsing, see the large
// assertNoWindowsCmdMetacharacters comment above) we follow the Windows
// CreateProcess command-line limit of 32767 characters, leaving headroom for
// flags and the full model name → 30K.
//
// For .cmd/.bat the limit is constantly 0 (see winPromptLimit below): it used
// to branch at 7000 characters (WIN_BATCH_PROMPT_LIMIT, the empirically
// measured cmd.exe command-line ceiling from agy flash review #4), so a prompt
// under 7000 characters went straight into argv — precisely the local
// command-injection hazard flagged Critical in the 2026-07-31 audit. It now
// always spills to disk, with no length-based branching.
const WIN_ARGV_PROMPT_LIMIT = 30_000;

/** Max prompt this file can safely carry through argv on win32; non-win →
 * null (no limit). */
function winPromptLimit(
  platform: NodeJS.Platform,
  file: string,
): number | null {
  if (platform !== "win32") return null;
  // .cmd/.bat has its argv re-parsed by cmd.exe, so the limit is constantly
  // 0 → any non-empty prompt spills to disk and argv carries no
  // match/model-controlled text at all.
  return isWindowsBatchFile(file, platform) ? 0 : WIN_ARGV_PROMPT_LIMIT;
}

/** The legacy .mjs wrapper mode still errors outright when over the limit
 * (dev-only path, not worth building another spill relay for). */
function assertWinPromptFits(
  platform: NodeJS.Platform,
  file: string,
  prompt: string,
): void {
  const limit = winPromptLimit(platform, file);
  if (limit !== null && prompt.length > limit) {
    throw new Error(
      `agy 后端经命令行传入 prompt,本次 ${prompt.length} 字符超出 Windows 命令行上限(约 32K):请改用 Claude CLI 或 Anthropic API 后端`,
    );
  }
}

/**
 * The agy backend. By default it spawns the `agy` binary directly
 * (auto-detected path):
 * `agy --print <prompt> --model <full name> --print-timeout 110s --new-project --sandbox`
 * — no wrapper script involved, so any machine with agy installed works out of
 * the box.
 *
 * `--new-project`: without it, agy silently reuses the previous project and
 * resets cwd to that tree's root. `--sandbox`: read-only Q&A, it should have
 * no write permission at all.
 *
 * Compatibility: a hand-entered command path ending in `.mjs` (or a
 * test-injected script) → the old `node agy-run.mjs ask` wrapper mode, whose
 * output has the `[agy-run]` header line stripped.
 */
export function agyClientFactory(opts?: {
  cmd?: string;
  node?: string;
  script?: string;
  run?: Runner;
  /** Test injection; production uses process.platform. */
  platform?: NodeJS.Platform;
}): AnthropicLike {
  const run = opts?.run ?? defaultRun;
  const legacyScript =
    opts?.script || (opts?.cmd?.endsWith(".mjs") ? opts.cmd : undefined);
  return {
    async *stream(params) {
      const prompt = joinPrompt(params);
      const platform = opts?.platform ?? process.platform;
      if (legacyScript) {
        // The wrapper mode also passes the prompt via argv, so the guard must
        // not cover the direct-spawn branch only (agy flash review #3).
        const node = opts?.node || (await requireCli("node"));
        assertWinPromptFits(platform, node, prompt);
        const out = await run(
          node,
          [
            legacyScript,
            "ask",
            "--model",
            params.model,
            "--timeout",
            "110",
            prompt,
          ],
          "",
          // Final review F1: the legacy .mjs wrapper mode must forward the
          // seeding-phase signal too.
          { signal: params.signal },
        );
        yield { delta: stripAgyHeader(out) };
        return;
      }
      const { cmd, versionProbe } = await resolveCliWithVersionProbe(
        "agy",
        opts?.cmd,
      );
      // On win32, over the command-line limit or on .cmd/.bat (constantly 0,
      // see winPromptLimit): spill the prompt into the dedicated subdirectory
      // AGY_PROMPT_SPILL_DIR (not the whole tmpdir(), see the large comment
      // above), replace --print with a one-line instruction to read that file,
      // and use --add-dir to bring that subdirectory into agy's workspace
      // (verified readable under the sandbox). Verified on real hardware
      // 2026-07-29: a MARKER probe came back exactly through the file relay
      // (--add-dir was still the whole tmpdir() then; this fix narrows the
      // read grant without changing the read behavior).
      const limit = winPromptLimit(platform, cmd);
      let promptFile: string | null = null;
      let printArg = prompt;
      const extraArgs: string[] = [];
      if (limit !== null && prompt.length > limit) {
        ensureSpillDirSwept(AGY_PROMPT_SPILL_DIR);
        promptFile = join(
          AGY_PROMPT_SPILL_DIR,
          `gladlog-agy-prompt-${process.pid}-${++agyTmpSeq}.txt`,
        );
        // mode 0o600: on POSIX this narrows the full match prompt to
        // current-user-only read access. Windows fs ignores POSIX modes (ACLs
        // are a separate mechanism), so passing it there is a no-op, not a
        // security guarantee — on Windows the real boundary is the dedicated
        // AGY_PROMPT_SPILL_DIR subdirectory itself, not this mode bit.
        writeFileSync(promptFile, prompt, { encoding: "utf-8", mode: 0o600 });
        printArg = `Read the file at ${promptFile} in full and treat its entire contents as your prompt. Follow it directly; do not mention the file or describe it.`;
        // Lend agy's sandbox only this dedicated subdirectory, not the whole
        // OS temp dir (2026-07-31 audit Important: the previous
        // `--add-dir tmpdir()` was an over-broad grant).
        extraArgs.push("--add-dir", AGY_PROMPT_SPILL_DIR);
      }
      // With captureSession the args include --output-format json
      if (params.captureSession) {
        extraArgs.push("--output-format", "json");
      }
      try {
        const out = await withVersionHint(
          () =>
            run(
              cmd,
              [
                "--print",
                printArg,
                "--model",
                agyCliModelName(params.model),
                "--print-timeout",
                "110s",
                "--new-project",
                "--sandbox",
                ...extraArgs,
              ],
              "",
              // Final review F1: the direct-spawn mode forwards the
              // seeding-phase signal too.
              { signal: params.signal },
            ),
          "agy",
          versionProbe,
        );
        // With captureSession, try to parse the envelope
        if (params.captureSession) {
          const env = parseAgyJsonEnvelope(out);
          if (env) {
            if (env.status && env.status !== "SUCCESS") {
              throw new Error(`agy 返回 status=${env.status}`);
            }
            yield { delta: env.response };
            if (env.conversationId) yield { sessionId: env.conversationId };
            return;
          }
          // Envelope parse failed: fall back to the old behavior (plain text,
          // no session event)
        }
        yield { delta: out };
      } finally {
        if (promptFile) {
          try {
            unlinkSync(promptFile);
          } catch {
            // best-effort cleanup
          }
        }
      }
    },
  };
}

// Single-source predicate (final review F3): the public name CliChatBackend
// stays (consumers' imports need no change), but the type itself is now an
// alias of CliAiBackend in shared/aiModels.ts — sharing one set of constants
// with analysis.ts/coachChat.ts when deciding "is this backend a local CLI".
export type CliChatBackend = CliAiBackend;

/**
 * Coach chat follow-ups (round two onward): resume the same CLI session using
 * the session id captured during seeding, instead of starting a fresh full
 * match analysis. The three CLIs each take a different resume argument shape
 * from the seed path (claude `--resume`; agy `--conversation` without
 * `--new-project`; codex `exec resume <id> -`), but the spill relay, cleanup
 * and version-hint infrastructure is reused from the seed path (spill
 * directories, winPromptLimit, withVersionHint) rather than reinvented.
 *
 * `opts.signal` (forwarded to defaultRun via the Runner's 4th param): callers
 * can abort an in-flight follow-up request (user navigates away / cancels the
 * question).
 */
export async function continueCliChat(input: {
  backend: CliChatBackend;
  cmd?: string;
  sessionId: string;
  question: string;
  model: string;
  signal?: AbortSignal;
  run?: Runner;
}): Promise<string> {
  const run = input.run ?? defaultRun;
  const opts = { signal: input.signal };
  if (input.backend === "claudeCli") {
    const { cmd, versionProbe } = await resolveCliWithVersionProbe(
      "claude",
      input.cmd,
    );
    return withVersionHint(
      () =>
        run(
          cmd,
          [
            "-p",
            "--output-format",
            "text",
            "--model",
            input.model,
            "--resume",
            input.sessionId,
            ...CLAUDE_CLI_ISOLATION_ARGS,
          ],
          input.question,
          opts,
        ),
      "claude",
      versionProbe,
    );
  }
  if (input.backend === "agy") {
    const { cmd, versionProbe } = await resolveCliWithVersionProbe(
      "agy",
      input.cmd,
    );
    // The question can exceed the win argv limit too: reuse the spill path
    // (the same guard as seeding)
    const platform = process.platform;
    const limit = winPromptLimit(platform, cmd);
    let promptFile: string | null = null;
    let printArg = input.question;
    const extraArgs: string[] = [];
    if (limit !== null && input.question.length > limit) {
      ensureSpillDirSwept(AGY_PROMPT_SPILL_DIR);
      promptFile = join(
        AGY_PROMPT_SPILL_DIR,
        `gladlog-agy-chat-${process.pid}-${++agyTmpSeq}.txt`,
      );
      writeFileSync(promptFile, input.question, {
        encoding: "utf-8",
        mode: 0o600,
      });
      printArg = `Read the file at ${promptFile} in full and treat its entire contents as your prompt. Follow it directly; do not mention the file or describe it.`;
      extraArgs.push("--add-dir", AGY_PROMPT_SPILL_DIR);
    }
    try {
      const out = await withVersionHint(
        () =>
          run(
            cmd,
            [
              "--print",
              printArg,
              "--model",
              agyCliModelName(input.model),
              "--print-timeout",
              "110s",
              "--conversation",
              input.sessionId,
              "--sandbox",
              ...extraArgs,
            ],
            "",
            opts,
          ),
        "agy",
        versionProbe,
      );
      return stripAgyHeader(out);
    } finally {
      if (promptFile) {
        try {
          unlinkSync(promptFile);
        } catch {
          /* best-effort */
        }
      }
    }
  }
  if (input.backend === "codebuddy") {
    const { cmd, versionProbe } = await resolveCliWithVersionProbe(
      "cbc",
      input.cmd,
    );
    return withVersionHint(
      () =>
        run(
          cmd,
          [
            "-p",
            "--output-format",
            "text",
            "--model",
            input.model,
            "--resume",
            input.sessionId,
            ...CODEBUDDY_SAFETY_ARGS,
          ],
          input.question,
          opts,
        ),
      "cbc",
      versionProbe,
    );
  }
  // codex
  const { cmd, versionProbe } = await resolveCliWithVersionProbe(
    "codex",
    input.cmd,
  );
  ensureSpillDirSwept(CODEX_OUT_SPILL_DIR);
  const outFile = join(
    CODEX_OUT_SPILL_DIR,
    `gladlog-codex-chat-${process.pid}-${++codexTmpSeq}.txt`,
  );
  try {
    const stdout = await withVersionHint(
      () =>
        run(
          cmd,
          [
            "exec",
            "resume",
            input.sessionId,
            "-",
            "-m",
            input.model,
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--color",
            "never",
            "-o",
            outFile,
          ],
          input.question,
          opts,
        ),
      "codex",
      versionProbe,
    );
    try {
      return readFileSync(outFile, "utf-8");
    } catch {
      return stdout; // older codex does not know -o: fall back to stdout
    }
  } finally {
    try {
      unlinkSync(outFile);
    } catch {
      /* best-effort */
    }
  }
}
