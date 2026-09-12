import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGY_PROMPT_SPILL_DIR,
  agyClientFactory,
  assertNoWindowsCmdMetacharacters,
  CLAUDE_CLI_ISOLATION_ARGS,
  claudeCliClientFactory,
  codexClientFactory,
  CODEBUDDY_SAFETY_ARGS,
  codebuddyClientFactory,
  continueCliChat,
  defaultRun,
  ensureSpillDirSwept,
  killAllCliChildren,
  parseCodebuddyJsonEnvelope,
  stripAgyHeader,
  withVersionHint,
  type Runner,
} from "./localAiBackends";
import type { CliVersionProbe } from "./cliDetect";
import { resolveAiClient, type AnthropicLike } from "./ai";

// cliDetect.ts (imported transitively by localAiBackends.ts) also pulls
// `execFile` from this module, so this must partially mock it — only
// `spawn` is replaced, everything else (including `execFile`) stays real.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter: EE } = await import("node:events");
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EE() as import("node:events").EventEmitter & {
        stdout: import("node:events").EventEmitter;
        stderr: import("node:events").EventEmitter;
        stdin: { end: (s: string) => void };
        kill: () => void;
      };
      child.stdout = new EE();
      child.stderr = new EE();
      child.stdin = { end: () => {} };
      child.kill = () => {};
      return child;
    }),
  };
});

// Spy on writeFileSync (real write still happens via `actual`) so the
// "spill file written with mode 0o600" test can assert the call args
// without a separate fake-fs seam.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

async function collect(client: AnthropicLike): Promise<string> {
  let out = "";
  for await (const ev of client.stream({
    model: "m",
    max_tokens: 10,
    messages: [{ role: "user", content: "hi" }],
  })) {
    if (ev.delta) out += ev.delta;
  }
  return out;
}

describe("defaultRun 累积 child process 输出(300 盘 agy 模拟发现的乱码 bug)", () => {
  function lastSpawnedChild() {
    return vi.mocked(spawn).mock.results.at(-1)!.value as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
  }

  it("stdout 多字节 UTF-8 字符跨 chunk 边界不产生 U+FFFD 乱码(产线 aiLanguage 默认 zh)", async () => {
    const promise = defaultRun("some-cli", [], "");
    const child = lastSpawnedChild();
    // "减" = E5 87 8F; deliberately split mid-character into two chunks to
    // simulate a cross-boundary read.
    const bytes = Buffer.from("减", "utf8");
    child.stdout.emit("data", bytes.subarray(0, 2));
    child.stdout.emit("data", bytes.subarray(2));
    child.emit("close", 0);
    expect(await promise).toBe("减");
  });

  it("stderr 同样的跨 chunk 多字节字符不乱码(非零退出时拼进错误信息)", async () => {
    const promise = defaultRun("some-cli", [], "");
    const child = lastSpawnedChild();
    const bytes = Buffer.from("失败：减速失败", "utf8");
    const mid = Math.floor(bytes.length / 2);
    child.stderr.emit("data", bytes.subarray(0, mid));
    child.stderr.emit("data", bytes.subarray(mid));
    child.emit("close", 1);
    await expect(promise).rejects.toThrow("失败：减速失败");
  });

  it("onStdoutLine 按行回调:跨 chunk 多字节不乱码、\\r\\n 去尾、收尾冲刷无换行残行(假流式修复)", async () => {
    const lines: string[] = [];
    const promise = defaultRun("some-cli", [], "", {
      onStdoutLine: (l) => lines.push(l),
    });
    const child = lastSpawnedChild();
    const buf = Buffer.from('{"a":"减"}\r\n{"b"', "utf8");
    child.stdout.emit("data", buf.subarray(0, 7)); // 减(3 字节)劈在中间
    child.stdout.emit("data", buf.subarray(7));
    child.stdout.emit("data", Buffer.from(':"速"}', "utf8")); // 无换行收尾
    child.emit("close", 0);
    await promise;
    expect(lines).toEqual(['{"a":"减"}', '{"b":"速"}']);
  });

  it("onStdoutLine 回调抛错不影响 CLI 调用本身(旁路语义)", async () => {
    const promise = defaultRun("some-cli", [], "", {
      onStdoutLine: () => {
        throw new Error("callback boom");
      },
    });
    const child = lastSpawnedChild();
    child.stdout.emit("data", Buffer.from("line1\nline2", "utf8"));
    child.emit("close", 0);
    expect(await promise).toBe("line1\nline2");
  });
});

describe("assertNoWindowsCmdMetacharacters(defaultRun 的 cmd.exe argv 兜底守卫,2026-07-31 审计 Critical)", () => {
  it("放行不含 shell 元字符/引号平衡的普通 flag/路径", () => {
    expect(() =>
      assertNoWindowsCmdMetacharacters(
        ["--print", "hello world", "--model", "m", "--sandbox"],
        "C:\\npm\\agy.cmd",
      ),
    ).not.toThrow();
  });

  it.each([
    ["&", "a & echo pwned"],
    ["|", "a | del c:\\"],
    ["^", "a^^b"],
    ["%", "42% HP left"],
    ["<", "a < b"],
    [">", "a > b"],
  ])("含 %s 的 argv 元素直接抛错,而不是带着注入风险硬跑", (_label, arg) => {
    expect(() =>
      assertNoWindowsCmdMetacharacters(["--print", arg], "C:\\npm\\agy.cmd"),
    ).toThrow(/cmd\.exe/);
  });

  it('未闭合双引号(奇数个 ")抛错——cmd.exe 重解析会让后续参数边界错位', () => {
    expect(() =>
      assertNoWindowsCmdMetacharacters(['a "unbalanced'], "C:\\npm\\agy.cmd"),
    ).toThrow(/双引号/);
  });

  it("闭合的双引号(偶数个)不受影响", () => {
    expect(() =>
      assertNoWindowsCmdMetacharacters(['a "balanced"'], "C:\\npm\\agy.cmd"),
    ).not.toThrow();
  });
});

describe("defaultRun 在 win32 .cmd/.bat 上的 cmd.exe 包装 + 元字符守卫(2026-07-31 审计 Critical)", () => {
  const originalPlatform = process.platform;
  beforeEach(() => {
    vi.mocked(spawn).mockClear();
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("win32 + .cmd + 含 & 的 argv:守卫先抛错,spawn 完全不被调用(红→绿的红:修复前这条会直接 spawn)", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    await expect(
      defaultRun("C:\\npm\\agy.cmd", ["--print", "x & echo pwned"], ""),
    ).rejects.toThrow(/cmd\.exe/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("win32 + .cmd + 含 %PATH% 的 argv:同样在 spawn 之前抛错", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    await expect(
      defaultRun("C:\\npm\\agy.cmd", ["--print", "leak %PATH% now"], ""),
    ).rejects.toThrow(/cmd\.exe/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("win32 + .cmd + 未闭合引号的 argv:同样在 spawn 之前抛错", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    await expect(
      defaultRun("C:\\npm\\agy.cmd", ["--print", 'say "hi'], ""),
    ).rejects.toThrow(/双引号/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("win32 + .cmd + 干净 argv:守卫放行,照常经 cmd.exe /c 包装 spawn", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const promise = defaultRun(
      "C:\\npm\\agy.cmd",
      ["--print", "clean prompt no metachars"],
      "",
    );
    expect(spawn).toHaveBeenCalledWith(
      "cmd.exe",
      ["/c", "C:\\npm\\agy.cmd", "--print", "clean prompt no metachars"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    const child = vi.mocked(spawn).mock.results.at(-1)!
      .value as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.emit("close", 0);
    await expect(promise).resolves.toBe("");
  });

  it("非 win32(mac/linux)不受守卫影响,即便 file 恰好叫 .cmd 也直接 spawn(file, args)", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const promise = defaultRun(
      "/usr/local/bin/agy.cmd",
      ["--print", "x & echo pwned"],
      "",
    );
    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/agy.cmd",
      ["--print", "x & echo pwned"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    const child = vi.mocked(spawn).mock.results.at(-1)!
      .value as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.emit("close", 0);
    await expect(promise).resolves.toBe("");
  });
});

describe("defaultRun abort 行为直测(终审 F2:直接练 defaultRun 的 signal 处理——此前只经 continueCliChat 的上层测试间接盖到,defaultRun 自身的 abort 分支从未被直接单测过)", () => {
  it('signal 在调用时已 aborted:不 spawn,promptly reject Error("aborted")', async () => {
    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length;
    const controller = new AbortController();
    controller.abort();
    await expect(
      defaultRun("some-cli", ["--noop"], "", { signal: controller.signal }),
    ).rejects.toThrow("aborted");
    // No new spawn call was made — no child is in flight, so no result can
    // surface a beat later and be observed.
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore);
  });

  it("mid-flight abort:真实子进程(sleep 5)在约 50ms 后被 abort → 迅速 reject aborted,远早于 5s 睡眠跑完(linux/mac 通用,不用 shell/.sh,file 直接是 sleep 命令名)", async () => {
    // The top of this file mocks node:child_process's spawn wholesale (every
    // other test simulates the child by emitting events by hand) — this case
    // has to prove defaultRun really can kill a running child process, so just
    // this once we swap the real spawn back in (for this single call only;
    // mockImplementationOnce restores the file's fake spawn afterwards).
    const { spawn: realSpawn } =
      await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );
    vi.mocked(spawn).mockImplementationOnce(realSpawn);
    const controller = new AbortController();
    const start = Date.now();
    const promise = defaultRun("sleep", ["5"], "", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow("aborted");
    const elapsed = Date.now() - start;
    // Generous slack (2s ceiling, while the sleep is 5000ms and the abort came
    // after only 50ms): avoids false failures from slow CI machines while still
    // proving the rejection did not come from patiently waiting out the 5s
    // sleep — the sleep process was really SIGKILLed and produced no result.
    expect(elapsed).toBeLessThan(2000);
  }, 10_000);
});

describe("local AI backends", () => {
  it("claudeCli yields stdout as a delta and writes the prompt to stdin", async () => {
    let gotStdin = "";
    let gotArgs: string[] = [];
    const run: Runner = async (_file, args, stdin) => {
      gotStdin = stdin;
      gotArgs = args;
      return "FINDINGS_JSON";
    };
    expect(await collect(claudeCliClientFactory({ cmd: "claude", run }))).toBe(
      "FINDINGS_JSON",
    );
    expect(gotStdin).toBe("hi");
    expect(gotArgs).toContain("-p");
  });

  // claudeCli 真流式(假流式修复,2026-08-21)的 JSONL 行构造器
  const sjDelta = (text: string) =>
    JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
      parent_tool_use_id: null,
    });
  const sjResult = (result: string) =>
    JSON.stringify({ type: "result", is_error: false, result });

  it("claudeCli 真流式:delta 在 run 未结束时实时到达,args 带 stream-json 三件套", async () => {
    let lineCb: ((l: string) => void) | undefined;
    let resolveRun!: (s: string) => void;
    let gotArgs: string[] = [];
    const run: Runner = (_f, args, _stdin, o) => {
      gotArgs = args;
      lineCb = o?.onStdoutLine;
      return new Promise((res) => {
        resolveRun = res;
      });
    };
    const it2 = claudeCliClientFactory({ cmd: "claude", run })
      .stream({
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      })
      [Symbol.asyncIterator]();
    const first = it2.next();
    await vi.waitFor(() => {
      if (!lineCb) throw new Error("run 还没被调用");
    });
    lineCb!(sjDelta("竞技"));
    expect((await first).value).toEqual({ delta: "竞技" }); // run 仍 pending
    lineCb!(sjDelta("场"));
    expect((await it2.next()).value).toEqual({ delta: "场" });
    lineCb!(sjResult("竞技场"));
    resolveRun("");
    expect((await it2.next()).done).toBe(true);
    for (const flag of [
      "--verbose",
      "stream-json",
      "--include-partial-messages",
      ...CLAUDE_CLI_ISOLATION_ARGS,
    ]) {
      expect(gotArgs).toContain(flag);
    }
  });

  it("claudeCli 真流式:result 是权威终文,delta 拼接是其前缀时补发差尾", async () => {
    const run: Runner = async (_f, _a, _s, o) => {
      o?.onStdoutLine?.(sjDelta("AB"));
      o?.onStdoutLine?.(sjResult("ABC"));
      return "";
    };
    expect(await collect(claudeCliClientFactory({ cmd: "claude", run }))).toBe(
      "ABC",
    );
  });

  it("claudeCli 真流式:parent_tool_use_id 非空的 delta(子代理/工具产出)丢弃", async () => {
    const run: Runner = async (_f, _a, _s, o) => {
      o?.onStdoutLine?.(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "TOOL NOISE" },
          },
          parent_tool_use_id: "toolu_x",
        }),
      );
      o?.onStdoutLine?.(sjDelta("REAL"));
      return "";
    };
    expect(await collect(claudeCliClientFactory({ cmd: "claude", run }))).toBe(
      "REAL",
    );
  });

  it("claudeCli 兜底 1:失败且零 stream-json 行(老 CLI 不认 flag)→ 回退 --output-format text 重试", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      if (calls.length === 1)
        throw new Error("error: unknown option '--include-partial-messages'");
      return "LEGACY OUT";
    };
    expect(await collect(claudeCliClientFactory({ cmd: "claude", run }))).toBe(
      "LEGACY OUT",
    );
    expect(calls[0]).toContain("stream-json");
    expect(calls[1]).toContain("text");
    expect(calls[1]).not.toContain("stream-json");
    // the legacy fallback exists for CLIs too old for newer flags — it must not
    // carry the isolation args either
    for (const flag of CLAUDE_CLI_ISOLATION_ARGS)
      expect(calls[1]).not.toContain(flag);
  });

  it("claudeCli:用户 abort 不触发回退重试,原样抛 aborted", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      throw new Error("aborted");
    };
    await expect(
      collect(claudeCliClientFactory({ cmd: "claude", run })),
    ).rejects.toThrow(/^aborted$/);
    expect(calls).toHaveLength(1);
  });

  it("claudeCli:已解析出 stream-json 行的失败(真运行时错误)不回退,原样抛", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args, _s, o) => {
      calls.push(args);
      o?.onStdoutLine?.(JSON.stringify({ type: "system", subtype: "init" }));
      throw new Error("claude exited 1: mid-run boom");
    };
    await expect(
      collect(claudeCliClientFactory({ cmd: "claude", run })),
    ).rejects.toThrow(/mid-run boom/);
    expect(calls).toHaveLength(1);
  });

  it("agy strips the [agy-run] header line", async () => {
    const run: Runner = async () =>
      "[agy-run] role=ask model=x\nREAL BODY\nmore";
    const a = agyClientFactory({ node: "node", script: "/x/agy.mjs", run });
    expect(await collect(a)).toBe("REAL BODY\nmore");
  });

  it("passes the prompt as an args element (no shell), not stdin, for agy", async () => {
    let gotArgs: string[] = [];
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      return "ok";
    };
    await collect(agyClientFactory({ node: "node", script: "/x", run }));
    expect(gotArgs).toEqual([
      "/x",
      "ask",
      "--model",
      "m",
      "--timeout",
      "110",
      "hi",
    ]);
  });

  it("两个本地后端都把 params.model 透传成 --model(否则模型下拉对它们是摆设)", async () => {
    const seen: Record<string, string[]> = {};
    const capture =
      (key: string): Runner =>
      async (_f, args) => {
        seen[key] = args;
        return "ok";
      };
    await collect(
      claudeCliClientFactory({ cmd: "claude", run: capture("claudeCli") }),
    );
    await collect(
      agyClientFactory({ node: "node", script: "/x", run: capture("agy") }),
    );
    for (const key of ["claudeCli", "agy"]) {
      const args = seen[key];
      expect(args[args.indexOf("--model") + 1]).toBe("m");
    }
  });

  it("non-zero exit surfaces as an error (not silent)", async () => {
    const run: Runner = async () => {
      throw new Error("claude exited 1: boom");
    };
    await expect(
      collect(claudeCliClientFactory({ cmd: "claude", run })),
    ).rejects.toThrow(/exited 1/);
  });

  it("stripAgyHeader leaves non-header output alone", () => {
    expect(stripAgyHeader("PONG")).toBe("PONG");
  });

  it("agy 直调模式:--print/--model/--print-timeout/--new-project/--sandbox,不再依赖包装脚本", async () => {
    let gotFile = "";
    let gotArgs: string[] = [];
    const run: Runner = async (file, args) => {
      gotFile = file;
      gotArgs = args;
      return "REPLY";
    };
    expect(await collect(agyClientFactory({ cmd: "/bin/agy", run }))).toBe(
      "REPLY",
    );
    expect(gotFile).toBe("/bin/agy");
    expect(gotArgs[gotArgs.indexOf("--print") + 1]).toBe("hi");
    // unknown ids pass through unchanged (collect's model is "m")
    expect(gotArgs[gotArgs.indexOf("--model") + 1]).toBe("m");
    expect(gotArgs).toContain("--new-project");
    expect(gotArgs).toContain("--sandbox");
    expect(gotArgs[gotArgs.indexOf("--print-timeout") + 1]).toBe("110s");
  });

  it("agy 直调:alias id 映射成 CLI 模型全名(pro → Gemini 3.1 Pro (High))", async () => {
    let gotArgs: string[] = [];
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      return "ok";
    };
    const client = agyClientFactory({ cmd: "/bin/agy", run });
    for await (const _ of client.stream({
      model: "pro",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    })) {
      /* drain */
    }
    expect(gotArgs[gotArgs.indexOf("--model") + 1]).toBe(
      "Gemini 3.1 Pro (High)",
    );
  });

  it("agy 直调:直调输出不剥头行(agy stdout 本来就是干净回复)", async () => {
    const run: Runner = async () => "[agy-run] 长得像头行但其实是回复\nbody";
    // cmd is not .mjs → direct-invocation mode, output kept verbatim
    const out = await collect(agyClientFactory({ cmd: "/bin/agy", run }));
    expect(out).toBe("[agy-run] 长得像头行但其实是回复\nbody");
  });

  it("agy 兼容:cmd 以 .mjs 结尾 → 走旧 node+包装脚本模式并剥头行", async () => {
    let gotFile = "";
    let gotArgs: string[] = [];
    const run: Runner = async (file, args) => {
      gotFile = file;
      gotArgs = args;
      return "[agy-run] role=ask\nREAL";
    };
    const out = await collect(
      agyClientFactory({ cmd: "/x/agy-run.mjs", node: "node", run }),
    );
    expect(out).toBe("REAL");
    expect(gotFile).toBe("node");
    expect(gotArgs[0]).toBe("/x/agy-run.mjs");
    expect(gotArgs).toContain("ask");
  });

  it("agy 兼容:legacy .mjs 模式在 win32 上同样受 argv 守卫(agy flash 复核 #3)", async () => {
    const run: Runner = async () => "should not run";
    const client = agyClientFactory({
      cmd: "/x/agy-run.mjs",
      node: "node",
      platform: "win32",
      run,
    });
    const big = "x".repeat(30_001);
    await expect(
      collect({
        stream: (p) =>
          client.stream({ ...p, messages: [{ role: "user", content: big }] }),
      } as AnthropicLike),
    ).rejects.toThrow(/32K/);
  });

  it("agy 直调:win32 超限 prompt 落盘中转(--print 换读文件引导语 + --add-dir),用后清理", async () => {
    let gotArgs: string[] = [];
    let fileContent = "";
    let filePath = "";
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      const printArg = args[args.indexOf("--print") + 1]!;
      filePath = printArg.match(/at (.+?) in full/)![1]!;
      fileContent = readFileSync(filePath, "utf-8");
      return "ok";
    };
    const client = agyClientFactory({
      cmd: "C:\\bin\\agy.exe",
      platform: "win32",
      run,
    });
    const big = "x".repeat(30_001);
    await expect(
      collect({
        stream: (p) =>
          client.stream({ ...p, messages: [{ role: "user", content: big }] }),
      } as AnthropicLike),
    ).resolves.toBe("ok");
    const printArg = gotArgs[gotArgs.indexOf("--print") + 1]!;
    expect(printArg).toMatch(/Read the file/);
    expect(printArg.length).toBeLessThan(1000);
    expect(fileContent).toBe(big); // what was spilled to disk is the full prompt
    expect(gotArgs).toContain("--add-dir");
    expect(existsSync(filePath)).toBe(false); // cleaned up in finally
  });

  it("agy 直调:win32 经 cmd.exe 跑 .cmd 时任意非空 prompt 恒落盘(不再按长度分档);.exe 30K 内直传(agy flash 复核 #4 → 2026-07-31 审计 Critical 修复)", async () => {
    const printArgOf = async (cmd: string, content: string) => {
      let printArg = "";
      const run: Runner = async (_f, args) => {
        printArg = args[args.indexOf("--print") + 1]!;
        return "ok";
      };
      const client = agyClientFactory({ cmd, platform: "win32", run });
      for await (const _ of client.stream({
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content }],
      })) {
        /* drain */
      }
      return printArg;
    };
    const mid = "x".repeat(8_000); // 8K: spilled on .cmd, passed inline on .exe
    expect(await printArgOf("C:\\npm\\agy.cmd", mid)).toMatch(/Read the file/);
    expect(await printArgOf("C:\\bin\\agy.exe", mid)).toBe(mid);
    // Before the fix: on .cmd anything under 7000 characters went straight into
    // argv without spilling — this fixture's short prompt (far below the old
    // WIN_BATCH_PROMPT_LIMIT=7000) must now be spilled too, otherwise the very
    // injection path this audit item closes is still open.
    const short = "hi";
    expect(await printArgOf("C:\\npm\\agy.cmd", short)).toMatch(
      /Read the file/,
    );
    // no length limit on mac, passed inline
    let macPrint = "";
    const run: Runner = async (_f, args) => {
      macPrint = args[args.indexOf("--print") + 1]!;
      return "ok";
    };
    const mac = agyClientFactory({ cmd: "/bin/agy", platform: "darwin", run });
    const big = "x".repeat(30_001);
    for await (const _ of mac.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: big }],
    })) {
      /* drain */
    }
    expect(macPrint).toBe(big);
  });

  it("agy 直调:win32 .cmd 上含 cmd.exe 元字符/未闭合引号的 prompt 经文件中转到达后端,argv 元素本身不含这些字符(2026-07-31 审计 Critical:命令注入)", async () => {
    // & / % / an unclosed " are the three high-risk character classes the audit
    // named — HP percentage text hits % almost every time.
    const dangerous = 'Player at 42% HP & echo pwned | del "everything^';
    let gotArgs: string[] = [];
    let fileContent = "";
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      const printArg = args[args.indexOf("--print") + 1]!;
      const filePath = printArg.match(/at (.+?) in full/)![1]!;
      fileContent = readFileSync(filePath, "utf-8");
      return "ok";
    };
    const client = agyClientFactory({
      cmd: "C:\\npm\\agy.cmd",
      platform: "win32",
      run,
    });
    for await (const _ of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: dangerous }],
    })) {
      /* drain */
    }
    // The prompt reaches the backend — but through a file, not through argv.
    expect(fileContent).toBe(dangerous);
    // Not one argv element still carries those dangerous characters — the spill
    // actually works, it isn't just for show.
    for (const arg of gotArgs) {
      expect(arg).not.toContain(dangerous);
    }
    // And the whole argv passes the very same guard defaultRun really runs
    // (single-source predicate: not a separate ad-hoc "looks clean" check).
    expect(() =>
      assertNoWindowsCmdMetacharacters(gotArgs, "C:\\npm\\agy.cmd"),
    ).not.toThrow();
  });

  it("codex 拼装 exec/-/-m/model/sandbox read-only/-o 参数,prompt 走 stdin", async () => {
    let gotStdin = "";
    let gotArgs: string[] = [];
    const run: Runner = async (_file, args, stdin) => {
      gotStdin = stdin;
      gotArgs = args;
      return "";
    };
    await collect(codexClientFactory({ cmd: "codex", run }));
    expect(gotStdin).toBe("hi");
    expect(gotArgs).toContain("exec");
    expect(gotArgs).toContain("-");
    expect(gotArgs[gotArgs.indexOf("-m") + 1]).toBe("m");
    expect(gotArgs).toContain("--sandbox");
    expect(gotArgs[gotArgs.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(gotArgs).toContain("-o");
  });

  it("codex 优先取 -o 文件内容(stdout 混杂 agent 日志,不是干净回复)", async () => {
    const run: Runner = async (_file, args) => {
      const outFile = args[args.indexOf("-o") + 1];
      writeFileSync(outFile, "CLEAN REPLY FROM FILE", "utf-8");
      return "noisy agent log lines mixed with the reply";
    };
    const out = await collect(codexClientFactory({ cmd: "codex", run }));
    expect(out).toBe("CLEAN REPLY FROM FILE");
  });

  it("codex 回退用 stdout(仅当 -o 文件缺失,readFileSync 抛错时)", async () => {
    let outFileSeen = "";
    const run: Runner = async (_file, args) => {
      outFileSeen = args[args.indexOf("-o") + 1];
      // Deliberately write no file, simulating an older codex that doesn't
      // understand -o.
      return "FALLBACK STDOUT";
    };
    const out = await collect(codexClientFactory({ cmd: "codex", run }));
    expect(out).toBe("FALLBACK STDOUT");
    // Best-effort cleanup in finally: unlinking a nonexistent file must not
    // throw, and nothing is left behind afterwards.
    expect(existsSync(outFileSeen)).toBe(false);
  });

  it("codex -o 文件存在但内容为空 → delta 为空串,不回退脏 stdout(空回复是合法模型输出)", async () => {
    const run: Runner = async (_file, args) => {
      const outFile = args[args.indexOf("-o") + 1];
      writeFileSync(outFile, "", "utf-8");
      return "noisy agent log lines that must NOT leak through";
    };
    const out = await collect(codexClientFactory({ cmd: "codex", run }));
    expect(out).toBe("");
  });

  it("codex 透传 params.model 成 -m(否则模型下拉是摆设)", async () => {
    let gotArgs: string[] = [];
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      return "ok";
    };
    await collect(codexClientFactory({ cmd: "codex", run }));
    expect(gotArgs[gotArgs.indexOf("-m") + 1]).toBe("m");
  });
});

describe("agy --add-dir 收窄到专用子目录,不再是整个 OS 临时目录(2026-07-31 审计 Important)", () => {
  it("--add-dir 的值是 AGY_PROMPT_SPILL_DIR,不是 tmpdir();spill 文件本身也落在这个子目录下(红→绿:修复前 addDirArg === tmpdir())", async () => {
    let gotArgs: string[] = [];
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      return "ok";
    };
    const client = agyClientFactory({
      cmd: "C:\\bin\\agy.exe",
      platform: "win32",
      run,
    });
    const big = "x".repeat(30_001);
    for await (const _ of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: big }],
    })) {
      /* drain */
    }
    const addDirArg = gotArgs[gotArgs.indexOf("--add-dir") + 1]!;
    expect(addDirArg).not.toBe(tmpdir());
    expect(addDirArg).toBe(AGY_PROMPT_SPILL_DIR);
    const printArg = gotArgs[gotArgs.indexOf("--print") + 1]!;
    const filePath = printArg.match(/at (.+?) in full/)![1]!;
    expect(filePath.startsWith(AGY_PROMPT_SPILL_DIR)).toBe(true);
  });

  it("spill 文件写入时带 mode 0o600(POSIX 收紧;Windows ACL 下 no-op,见实现注释)", async () => {
    vi.mocked(writeFileSync).mockClear();
    const run: Runner = async () => "ok";
    const client = agyClientFactory({
      cmd: "C:\\bin\\agy.exe",
      platform: "win32",
      run,
    });
    const big = "x".repeat(30_001);
    for await (const _ of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: big }],
    })) {
      /* drain */
    }
    const spillCall = vi
      .mocked(writeFileSync)
      .mock.calls.find(([path]) =>
        String(path).startsWith(AGY_PROMPT_SPILL_DIR),
      );
    expect(spillCall).toBeDefined();
    expect(spillCall![2]).toMatchObject({ mode: 0o600 });
  });
});

describe("ensureSpillDirSwept:spill 子目录初始化 + 崩溃遗留清扫(2026-07-31 审计 Important)", () => {
  it("清扫超过阈值(>1h)的陈旧文件,保留新鲜文件", () => {
    const dir = join(
      tmpdir(),
      `gladlog-agy-prompts-test-stale-${process.pid}-${Date.now()}`,
    );
    mkdirSync(dir, { recursive: true });
    const staleFile = join(dir, "stale.txt");
    const freshFile = join(dir, "fresh.txt");
    writeFileSync(staleFile, "leftover match data from a crashed process");
    writeFileSync(freshFile, "recent");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(staleFile, twoHoursAgo, twoHoursAgo);

    ensureSpillDirSwept(dir);

    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);
    unlinkSync(freshFile);
  });

  it("同一目录只在首次调用时扫描:第二次调用不会清掉后来才变陈旧的文件", () => {
    const dir = join(
      tmpdir(),
      `gladlog-agy-prompts-test-once-${process.pid}-${Date.now()}`,
    );
    mkdirSync(dir, { recursive: true });
    ensureSpillDirSwept(dir); // first call: marks this directory as swept

    const lateStale = join(dir, "late-stale.txt");
    writeFileSync(lateStale, "x");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(lateStale, twoHoursAgo, twoHoursAgo);

    ensureSpillDirSwept(dir); // second call: already in the swept set, no rescan

    expect(existsSync(lateStale)).toBe(true);
    unlinkSync(lateStale);
  });
});

describe("withVersionHint(#21 item6:版本探测结果 threading 进错误提示)", () => {
  it("成功路径不受影响,versionProbe 完全不被读取", async () => {
    const out = await withVersionHint(
      async () => "ok",
      "claude",
      Promise.resolve<CliVersionProbe>({ ok: false }),
    );
    expect(out).toBe("ok");
  });

  it("失败 + versionProbe 探测成功 → 错误信息附「检测到的 X 版本 Y」", async () => {
    await expect(
      withVersionHint(
        async () => {
          throw new Error("claude exited 1: boom");
        },
        "claude",
        Promise.resolve<CliVersionProbe>({ ok: true, version: "1.2.3" }),
      ),
    ).rejects.toThrow(/boom.*检测到的 claude 版本 1\.2\.3.*可能版本不兼容/s);
  });

  it("失败 + versionProbe 探测失败 → 错误信息附「版本探测失败」", async () => {
    await expect(
      withVersionHint(
        async () => {
          throw new Error("agy exited 1: boom");
        },
        "agy",
        Promise.resolve<CliVersionProbe>({ ok: false }),
      ),
    ).rejects.toThrow(/boom.*版本探测失败.*可能版本不兼容/s);
  });

  it("失败 + versionProbe 为 null(手填命令路径,未走自动检测)→ 原始错误不附加任何提示", async () => {
    await expect(
      withVersionHint(
        async () => {
          throw new Error("codex exited 1: boom");
        },
        "codex",
        null,
      ),
    ).rejects.toThrow(/^codex exited 1: boom$/);
  });

  it('失败信息恰为 "aborted"(用户取消)+ versionProbe 非 null(生产自动检测路径)→ 原样抛出,不附版本提示', async () => {
    await expect(
      withVersionHint(
        async () => {
          throw new Error("aborted");
        },
        "claude",
        Promise.resolve<CliVersionProbe>({ ok: true, version: "1.2.3" }),
      ),
    ).rejects.toThrow(/^aborted$/);
  });
});

describe("killAllCliChildren(#21 item9:quitLifecycle 完整性收尾)", () => {
  function lastSpawnedChild() {
    return vi.mocked(spawn).mock.results.at(-1)!.value as EventEmitter & {
      kill: () => void;
    };
  }

  it("红→绿:飞行中的子进程被 SIGKILL", async () => {
    const promise = defaultRun("some-cli", [], "");
    const child = lastSpawnedChild();
    const killSpy = vi.fn();
    child.kill = killSpy;

    killAllCliChildren();
    expect(killSpy).toHaveBeenCalledWith("SIGKILL");

    // Wind down so no unhandled promise is left behind.
    child.emit("close", 0);
    await promise;
  });

  it("没有飞行中的子进程时调用不报错(idempotent/no-op)", () => {
    expect(() => killAllCliChildren()).not.toThrow();
  });

  it("子进程结束后不再被追踪:结束后调用不会再次 kill 它", async () => {
    const promise = defaultRun("some-cli", [], "");
    const child = lastSpawnedChild();
    const killSpy = vi.fn();
    child.kill = killSpy;
    child.emit("close", 0);
    await promise;

    killAllCliChildren();
    expect(killSpy).not.toHaveBeenCalled();
  });
});

describe("resolveAiClient", () => {
  it("returns a client for the claudeCli backend with no API key", () => {
    expect(
      resolveAiClient({ anthropicApiKey: null, aiBackend: "claudeCli" }),
    ).not.toBeNull();
  });
  it("returns a client for the agy backend with no API key", () => {
    expect(
      resolveAiClient({ anthropicApiKey: null, aiBackend: "agy" }),
    ).not.toBeNull();
  });
  it("returns a client for the codex backend with no API key", () => {
    expect(
      resolveAiClient({ anthropicApiKey: null, aiBackend: "codex" }),
    ).not.toBeNull();
  });
  it("anthropic backend without a key returns null (falls back)", () => {
    expect(
      resolveAiClient({ anthropicApiKey: null, aiBackend: "anthropic" }),
    ).toBeNull();
  });
  it("anthropic backend with a key returns a client", () => {
    expect(
      resolveAiClient({ anthropicApiKey: "sk-x", aiBackend: "anthropic" }),
    ).not.toBeNull();
  });
  it("deepseek:无 key → null(确定性回退);有 key → client", () => {
    expect(
      resolveAiClient({
        anthropicApiKey: null,
        deepseekApiKey: null,
        aiBackend: "deepseek",
      }),
    ).toBeNull();
    expect(
      resolveAiClient({
        anthropicApiKey: null,
        deepseekApiKey: "sk-ds",
        aiBackend: "deepseek",
      }),
    ).not.toBeNull();
  });
});

describe("system prompt 经本地后端(backlog #1)", () => {
  it("claudeCli:system 拼接在 prompt 最前", async () => {
    const seen: string[] = [];
    const client = claudeCliClientFactory({
      cmd: "claude",
      run: async (_cmd, _args, stdin) => {
        seen.push(stdin);
        return "ok";
      },
    });
    for await (const _ of client.stream({
      model: "m",
      max_tokens: 1,
      system: "SYS-LANG",
      messages: [{ role: "user", content: "PROMPT" }],
    })) {
      /* drain */
    }
    expect(seen[0]).toBe("SYS-LANG\nPROMPT");
  });
});

describe("claudeCli sessionIdHint(coach chat 会话事件)", () => {
  it("claudeCli:传 sessionIdHint 时追加 --session-id 并回报 sessionId 事件", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      return "回答文本";
    };
    const client = claudeCliClientFactory({ cmd: "/bin/claude", run });
    const events: Array<{ delta?: string; sessionId?: string }> = [];
    for await (const ev of client.stream({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      sessionIdHint: "11111111-2222-3333-4444-555555555555",
    })) {
      events.push(ev);
    }
    expect(calls[0]).toContain("--session-id");
    expect(calls[0]).toContain("11111111-2222-3333-4444-555555555555");
    expect(events).toEqual([
      { delta: "回答文本" },
      { sessionId: "11111111-2222-3333-4444-555555555555" },
    ]);
  });

  it("claudeCli:不传 sessionIdHint 时 args 与事件保持旧形状", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      return "ok";
    };
    const client = claudeCliClientFactory({ cmd: "/bin/claude", run });
    const events: unknown[] = [];
    for await (const ev of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(ev);
    }
    expect(calls[0]).not.toContain("--session-id");
    expect(events).toEqual([{ delta: "ok" }]);
  });
});

describe("agy 会话捕获", () => {
  const ENVELOPE = JSON.stringify({
    conversation_id: "b013bd24-0cbc-46fb-a95f-67a267a90c4b",
    status: "SUCCESS",
    response: "教练回答",
  });

  it("captureSession:args 含 --output-format json,信封拆出回答与会话 id", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      return ENVELOPE;
    };
    const client = agyClientFactory({ cmd: "/bin/agy", run });
    const events: Array<{ delta?: string; sessionId?: string }> = [];
    for await (const ev of client.stream({
      model: "gemini-3-pro",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
      captureSession: true,
    })) {
      events.push(ev);
    }
    expect(calls[0]).toContain("--output-format");
    expect(calls[0]).toContain("json");
    expect(events).toEqual([
      { delta: "教练回答" },
      { sessionId: "b013bd24-0cbc-46fb-a95f-67a267a90c4b" },
    ]);
  });

  it("captureSession:status 非 SUCCESS 抛错(带 status 便于归因)", async () => {
    const run: Runner = async () =>
      JSON.stringify({ conversation_id: "x", status: "ERROR", response: "" });
    const client = agyClientFactory({ cmd: "/bin/agy", run });
    await expect(async () => {
      for await (const _ of client.stream({
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
        captureSession: true,
      })) {
        /* drain */
      }
    }).rejects.toThrow(/ERROR/);
  });

  it("captureSession:信封解析失败回退当纯文本,无 sessionId 事件(分析不因此失败)", async () => {
    const run: Runner = async () => "不是 json 的输出";
    const client = agyClientFactory({ cmd: "/bin/agy", run });
    const events: Array<{ delta?: string; sessionId?: string }> = [];
    for await (const ev of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
      captureSession: true,
    })) {
      events.push(ev);
    }
    expect(events).toEqual([{ delta: "不是 json 的输出" }]);
  });

  it("不传 captureSession:args 不含 --output-format(旧行为字节不变)", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      return "raw";
    };
    const client = agyClientFactory({ cmd: "/bin/agy", run });
    for await (const _ of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    })) {
      /* drain */
    }
    expect(calls[0]).not.toContain("--output-format");
  });
});

describe("codex 会话捕获", () => {
  it("captureSession:args 含 --json 去 --ephemeral,JSONL 抓 session id,回答取 -o 文件", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      // simulate codex writing the -o file
      const oIdx = args.indexOf("-o");
      writeFileSync(args[oIdx + 1]!, "最终回答", "utf-8");
      return [
        JSON.stringify({
          type: "session_configured",
          session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }),
        JSON.stringify({ type: "agent_message", text: "噪声" }),
      ].join("\n");
    };
    const client = codexClientFactory({ cmd: "/bin/codex", run });
    const events: Array<{ delta?: string; sessionId?: string }> = [];
    for await (const ev of client.stream({
      model: "gpt-x",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
      captureSession: true,
    })) {
      events.push(ev);
    }
    expect(calls[0]).toContain("--json");
    expect(calls[0]).not.toContain("--ephemeral");
    expect(events).toEqual([
      { delta: "最终回答" },
      { sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    ]);
  });

  it("captureSession:JSONL 无 id 时只出 delta(分析不因此失败)", async () => {
    const run: Runner = async (_f, args) => {
      const oIdx = args.indexOf("-o");
      writeFileSync(args[oIdx + 1]!, "回答", "utf-8");
      return "非 json 行\n另一行";
    };
    const client = codexClientFactory({ cmd: "/bin/codex", run });
    const events: Array<{ delta?: string; sessionId?: string }> = [];
    for await (const ev of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
      captureSession: true,
    })) {
      events.push(ev);
    }
    expect(events).toEqual([{ delta: "回答" }]);
  });

  it("不传 captureSession:args 保留 --ephemeral 无 --json(旧行为)", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      const oIdx = args.indexOf("-o");
      writeFileSync(args[oIdx + 1]!, "x", "utf-8");
      return "";
    };
    const client = codexClientFactory({ cmd: "/bin/codex", run });
    for await (const _ of client.stream({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    })) {
      /* drain */
    }
    expect(calls[0]).toContain("--ephemeral");
    expect(calls[0]).not.toContain("--json");
  });
});

describe("continueCliChat", () => {
  it("claudeCli:--resume <id>,问题走 stdin", async () => {
    const calls: Array<{ args: string[]; stdin: string }> = [];
    const run: Runner = async (_f, args, stdin) => {
      calls.push({ args, stdin });
      return "续聊回答";
    };
    const out = await continueCliChat({
      backend: "claudeCli",
      cmd: "/bin/claude",
      sessionId: "sid-1",
      question: "为什么该开减伤?",
      model: "claude-sonnet-5",
      run,
    });
    expect(out).toBe("续聊回答");
    expect(calls[0]!.args).toEqual([
      "-p",
      "--output-format",
      "text",
      "--model",
      "claude-sonnet-5",
      "--resume",
      "sid-1",
      "--tools=",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ]);
    expect(calls[0]!.stdin).toBe("为什么该开减伤?");
  });

  it("agy:--conversation <id>,无 --new-project,问题在 argv,剥 [agy-run] 头", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args) => {
      calls.push(args);
      return "[agy-run] header\n回答";
    };
    const out = await continueCliChat({
      backend: "agy",
      cmd: "/bin/agy",
      sessionId: "conv-1",
      question: "问题",
      model: "flash",
      run,
    });
    expect(out).toBe("回答");
    expect(calls[0]).toContain("--conversation");
    expect(calls[0]).toContain("conv-1");
    expect(calls[0]).not.toContain("--new-project");
  });

  it("codex:exec resume <id>,问题走 stdin,回答取 -o 文件", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_f, args, stdin) => {
      calls.push(args);
      expect(stdin).toBe("问题");
      const oIdx = args.indexOf("-o");
      writeFileSync(args[oIdx + 1]!, "codex 回答", "utf-8");
      return "";
    };
    const out = await continueCliChat({
      backend: "codex",
      cmd: "/bin/codex",
      sessionId: "sid-c",
      question: "问题",
      model: "gpt-x",
      run,
    });
    expect(out).toBe("codex 回答");
    expect(calls[0]!.slice(0, 3)).toEqual(["exec", "resume", "sid-c"]);
    expect(calls[0]).not.toContain("--ephemeral");
  });
});

describe("parseCodebuddyJsonEnvelope", () => {
  it("parses cbc event-array format (assistant message with output_text blocks)", () => {
    const stdout = JSON.stringify([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
      { type: "file-history-snapshot", id: "x", timestamp: 1 },
      { type: "reasoning", id: "y", timestamp: 2 },
      {
        type: "message",
        role: "assistant",
        sessionId: "sess-abc",
        content: [
          {
            providerData: { annotations: [] },
            type: "output_text",
            text: "Hello",
          },
        ],
        id: "z",
        timestamp: 3,
      },
      { type: "result", id: "w", timestamp: 4 },
    ]);
    const env = parseCodebuddyJsonEnvelope(stdout);
    expect(env).not.toBeNull();
    expect(env!.response).toBe("Hello");
    expect(env!.sessionId).toBe("sess-abc");
  });

  it("concatenates multiple output_text blocks in one assistant message", () => {
    const stdout = JSON.stringify([
      {
        type: "message",
        role: "assistant",
        sessionId: "s1",
        content: [
          { type: "output_text", text: "Hello " },
          { type: "output_text", text: "world" },
        ],
      },
    ]);
    expect(parseCodebuddyJsonEnvelope(stdout)!.response).toBe("Hello world");
  });

  it("falls back to result event text when assistant message has no content", () => {
    const stdout = JSON.stringify([
      { type: "message", role: "assistant", sessionId: "s2", content: [] },
      { type: "result", result: "fallback text" },
    ]);
    expect(parseCodebuddyJsonEnvelope(stdout)!.response).toBe("fallback text");
  });

  it("returns null for event array with no extractable text", () => {
    const stdout = JSON.stringify([
      { type: "message", role: "user", content: [] },
      { type: "file-history-snapshot" },
    ]);
    expect(parseCodebuddyJsonEnvelope(stdout)).toBeNull();
  });

  it("handles flat single-object format (defensive)", () => {
    const stdout = JSON.stringify({
      response: "flat response",
      sessionId: "flat-sid",
    });
    const env = parseCodebuddyJsonEnvelope(stdout);
    expect(env!.response).toBe("flat response");
    expect(env!.sessionId).toBe("flat-sid");
  });

  it("returns null for invalid JSON", () => {
    expect(parseCodebuddyJsonEnvelope("not json")).toBeNull();
  });
});

describe("codebuddy factory / continueCliChat(PR #35 review #1:argv 形状与 stdin 契约钉死)", () => {
  const envelope = JSON.stringify([
    {
      type: "message",
      role: "assistant",
      sessionId: "sess-cb",
      content: [{ type: "output_text", text: "分析结果" }],
    },
  ]);

  it("captureSession:json 模式 argv + 安全参数单源 + prompt 走 stdin + sessionId 事件", async () => {
    let gotArgs: string[] = [];
    let gotStdin = "";
    const run: Runner = async (_f, args, stdin) => {
      gotArgs = args;
      gotStdin = stdin;
      return envelope;
    };
    const events: Array<{ delta?: string; sessionId?: string }> = [];
    for await (const ev of codebuddyClientFactory({ cmd: "cbc", run }).stream({
      model: "m",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
      captureSession: true,
    })) {
      events.push(ev);
    }
    expect(gotArgs).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "m",
      ...CODEBUDDY_SAFETY_ARGS,
    ]);
    // 整个后端建立在「cbc -p 从 stdin 读 prompt」这个契约上 —— argv 里没有
    // prompt 位置参数,契约破了所有调用发的都是空 prompt,必须钉死。
    expect(gotStdin).toContain("hi");
    expect(events.map((e) => e.delta).join("")).toBe("分析结果");
    expect(events.some((e) => e.sessionId === "sess-cb")).toBe(true);
  });

  it("非 captureSession(对比):text 模式 argv + 原文透传", async () => {
    let gotArgs: string[] = [];
    const run: Runner = async (_f, args) => {
      gotArgs = args;
      return "TEXT_OUT";
    };
    expect(await collect(codebuddyClientFactory({ cmd: "cbc", run }))).toBe(
      "TEXT_OUT",
    );
    expect(gotArgs).toEqual([
      "-p",
      "--output-format",
      "text",
      "--model",
      "m",
      ...CODEBUDDY_SAFETY_ARGS,
    ]);
  });

  it("continueCliChat codebuddy:--resume + 安全参数同一单源,问题走 stdin", async () => {
    const calls: Array<{ args: string[]; stdin: string }> = [];
    const run: Runner = async (_f, args, stdin) => {
      calls.push({ args, stdin });
      return "续聊回答";
    };
    const out = await continueCliChat({
      backend: "codebuddy",
      cmd: "/bin/cbc",
      sessionId: "sid-cb",
      question: "为什么该开减伤?",
      model: "hy3",
      run,
    });
    expect(out).toBe("续聊回答");
    expect(calls[0]!.args).toEqual([
      "-p",
      "--output-format",
      "text",
      "--model",
      "hy3",
      "--resume",
      "sid-cb",
      ...CODEBUDDY_SAFETY_ARGS,
    ]);
    expect(calls[0]!.stdin).toBe("为什么该开减伤?");
  });

  it("安全参数形状钉死:--tools 空串与 --max-turns 1 成对(win 空参风险见常量注释)", () => {
    expect([...CODEBUDDY_SAFETY_ARGS]).toEqual([
      "--tools",
      "",
      "--max-turns",
      "1",
    ]);
  });
});
