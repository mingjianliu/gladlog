import { describe, expect, it, vi } from "vitest";

import {
  abortAllDeepSeekStreams,
  deepseekClientFactory,
  scrubSecrets,
} from "./deepseekClient";

const enc = new TextEncoder();

function fakeFetch(opts: {
  status?: number;
  chunks?: string[];
  captured?: { body?: unknown };
  errorText?: string;
}) {
  return (async (_url: unknown, init?: { body?: string }) => {
    if (opts.captured) opts.captured.body = JSON.parse(init?.body ?? "{}");
    const ok = (opts.status ?? 200) === 200;
    return {
      ok,
      status: opts.status ?? 200,
      text: async () => opts.errorText ?? "boom detail",
      body: ok
        ? (async function* () {
            for (const c of opts.chunks ?? []) yield enc.encode(c);
          })()
        : null,
    };
  }) as unknown as typeof fetch;
}

/** body is an async iterable that genuinely hangs (never resolves or rejects)
 * — simulating a connection that stalls mid-stream after being established
 * (no new chunk, no [DONE], no error). Used to verify that the stall watchdog
 * gets the caller out of the loop without relying on the underlying iterable
 * honoring the abort signal itself. */
function stalledBodyFetch() {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    body: {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {}), // never settles
        };
      },
    },
  })) as unknown as typeof fetch;
}

/** Emits a chunk immediately on every consume, but at an interval shorter than
 * the stall window while the total runtime exceeds the overall cap — used to
 * verify that "no single stall, yet too long in total" is still cut off by the
 * hard overall ceiling. */
function slowDripFetch(chunkIntervalMs: number, chunkCount: number) {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    body: {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next: () =>
            new Promise((resolve) => {
              setTimeout(() => {
                i += 1;
                resolve({
                  value: enc.encode(
                    `data: {"choices":[{"delta":{"content":"x${i}"}}]}\n`,
                  ),
                  done: i > chunkCount,
                });
              }, chunkIntervalMs);
            }),
        };
      },
    },
  })) as unknown as typeof fetch;
}

/** body yields pre-sliced raw byte chunks one by one — used to control exactly
 * which byte offset a multi-byte UTF-8 character gets split at, which the
 * plain `chunks: string[]` helper cannot do (each string is encoded
 * separately, so splits always land on character boundaries). */
function rawChunkFetch(chunks: Uint8Array[]) {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    body: (async function* () {
      for (const c of chunks) yield c;
    })(),
  })) as unknown as typeof fetch;
}

async function collect(client: ReturnType<typeof deepseekClientFactory>) {
  const out: string[] = [];
  for await (const ev of client.stream({
    model: "deepseek-chat",
    max_tokens: 100,
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
  })) {
    if (ev.delta) out.push(ev.delta);
  }
  return out;
}

describe("deepseekClientFactory", () => {
  it("SSE 跨块半帧拼接;[DONE] 终止;system 转 messages 首条", async () => {
    const captured: { body?: unknown } = {};
    const client = deepseekClientFactory(
      "k",
      fakeFetch({
        captured,
        chunks: [
          'data: {"choices":[{"delta":{"content":"你"}}]}\n',
          'data: {"choices":[{"delta":{"con', // half a frame
          'tent":"好"}}]}\n',
          "data: [DONE]\n",
          'data: {"choices":[{"delta":{"content":"不该出现"}}]}\n',
        ],
      }),
    );
    expect(await collect(client)).toEqual(["你", "好"]);
    const body = captured.body as {
      stream: boolean;
      messages: Array<{ role: string }>;
    };
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("reasoning_content(R1 思维链)帧不产出 delta", async () => {
    const client = deepseekClientFactory(
      "k",
      fakeFetch({
        chunks: [
          'data: {"choices":[{"delta":{"reasoning_content":"想…","content":null}}]}\n',
          'data: {"choices":[{"delta":{"content":"答"}}]}\n',
          "data: [DONE]\n",
        ],
      }),
    );
    expect(await collect(client)).toEqual(["答"]);
  });

  it("非 200:抛错并带状态码与摘要", async () => {
    const client = deepseekClientFactory("k", fakeFetch({ status: 402 }));
    await expect(collect(client)).rejects.toThrow(/DeepSeek API 402.*boom/);
  });

  it("非 200 且错误体回显了配置的 key:抛出的错误信息里 key 已被抹除", async () => {
    const key = "sk-abcDEF1234567890realKey";
    const client = deepseekClientFactory(
      key,
      fakeFetch({
        status: 401,
        errorText: `missing authentication string, got Bearer ${key}`,
      }),
    );
    const err = await collect(client).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("DeepSeek API 401");
    expect(err!.message).not.toContain(key);
    expect(err!.message).toContain("[REDACTED]");
  });

  it("多字节 UTF-8 字符被切在原始字节 chunk 边界:{stream:true} 解码后仍完整", async () => {
    // prefix is pure ASCII, so byte length == character length and we can
    // compute the exact starting byte offset of the first CJK character
    // (U+4E2D), then cut 1 byte past it — guaranteeing the split lands on that
    // character's second byte (E4 B8 AD).
    const prefix = 'data: {"choices":[{"delta":{"content":"';
    const suffix = '"}}]}\n';
    const full = enc.encode(prefix + "中文测试" + suffix);
    const splitAt = prefix.length + 1;
    const client = deepseekClientFactory(
      "k",
      rawChunkFetch([
        full.slice(0, splitAt),
        full.slice(splitAt),
        enc.encode("data: [DONE]\n"),
      ]),
    );
    expect(await collect(client)).toEqual(["中文测试"]);
  });

  it("尾帧无换行符收尾(服务端在 JSON 帧末尾、换行符之前断连):flush 出该帧 delta,不静默丢弃(红→绿)", async () => {
    const client = deepseekClientFactory(
      "k",
      fakeFetch({
        chunks: [
          'data: {"choices":[{"delta":{"content":"你"}}]}\n',
          // The last frame is not followed by a newline — in the original
          // implementation this leftover sat in buf, never processed before
          // the generator ended, and its delta was silently dropped.
          'data: {"choices":[{"delta":{"content":"好"}}]}',
        ],
      }),
    );
    const out: string[] = [];
    let err: Error | null = null;
    try {
      for await (const ev of client.stream({
        model: "deepseek-chat",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      })) {
        if (ev.delta) out.push(ev.delta);
      }
    } catch (e) {
      err = e as Error;
    }
    // The trailing frame's delta must be flushed out; a missing newline is no
    // reason to drop it.
    expect(out).toEqual(["你", "好"]);
    // And since [DONE] was never seen during this run (the server hung up
    // early), it must be treated as a failure — the partial text already
    // emitted must not be silently passed off as a normal result.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/DeepSeek 流异常提前结束.*\[DONE\]/);
  });

  it("流干净结束但从未收到 [DONE](服务端提前断连):抛出清晰错误,不静默截断(红→绿)", async () => {
    const client = deepseekClientFactory(
      "k",
      fakeFetch({
        // Every line is complete with its newline, so buf gets fully drained —
        // this isolates the "stream physically ended without ever seeing
        // [DONE]" path, decoupled from the trailing half-line flush logic.
        chunks: ['data: {"choices":[{"delta":{"content":"完整一帧"}}]}\n'],
      }),
    );
    await expect(collect(client)).rejects.toThrow(
      /DeepSeek 流异常提前结束.*\[DONE\]/,
    );
  });

  it("残留 data: [DONE] 没有换行符收尾:按正常结束处理,不报错(reviewer 补测)", async () => {
    const client = deepseekClientFactory(
      "k",
      fakeFetch({
        chunks: [
          'data: {"choices":[{"delta":{"content":"正常"}}]}\n',
          // [DONE] itself can arrive as a trailing frame the server never got
          // to newline-terminate before hanging up — that takes the "try
          // parsing the leftover buf as a standalone frame" branch rather than
          // the line-by-line scan branch. The predicate must recognize it as
          // the terminator exactly as the line-scan branch does, and must not
          // discard it as a half frame and then report "stream ended
          // prematurely".
          "data: [DONE]",
        ],
      }),
    );
    await expect(collect(client)).resolves.toEqual(["正常"]);
  });

  it("decoder flush(红→绿):物理流结束前最后一段字节卡在多字节字符中间,flush 后仍走同一套解析,此前已产出的完整帧不受影响、且不会静默产出乱码 delta", async () => {
    // Note: the decoder only keeps half a sequence in its internal state when
    // the remaining bytes of that multi-byte sequence will never arrive — and
    // that necessarily means data: [DONE] was never seen (had it been, the
    // line-scan branch would have returned long before reaching the physical
    // done branch). So this kind of truncation can never have it both ways
    // between "clean finish with fully recovered text" and "a truncation
    // really happened": the half character is necessarily embedded in a JSON
    // fragment with no closing quote/brace, so JSON.parse must throw (swallowed
    // by parseSseLine's catch) and it is never parsed into a delta.
    // The most honest assertion about "did this fix actually take effect" is
    // therefore NOT comparing the text of the truncated fragment (it is
    // unrecoverable by construction — collect()'s visible output really is
    // identical before and after the fix), but rather:
    // 1) spy directly on decoder.decode() to confirm it was called with no
    //    arguments (the flush genuinely happened);
    // 2) the earlier, fully delivered normal frame is unaffected by that flush
    //    and comes out unchanged;
    // 3) since [DONE] was never seen, it still errors as "hung up early" — a
    //    truncation is never mistaken for success.
    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const prefix = 'data: {"choices":[{"delta":{"content":"';
    // U+6D4B encodes to the three UTF-8 bytes E6 B5 8B; we feed only the first
    // two and the third never arrives — a real, unrecoverable truncation, not
    // a "split across chunks but eventually complete" case.
    const truncatedMultibyte = enc.encode("测").slice(0, 2);
    const finalChunk = new Uint8Array([
      ...enc.encode(prefix),
      ...truncatedMultibyte,
    ]);
    const client = deepseekClientFactory(
      "k",
      rawChunkFetch([
        enc.encode('data: {"choices":[{"delta":{"content":"完整帧"}}]}\n'),
        finalChunk,
      ]),
    );
    const out: string[] = [];
    let err: Error | null = null;
    try {
      for await (const ev of client.stream({
        model: "deepseek-chat",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      })) {
        if (ev.delta) out.push(ev.delta);
      }
    } catch (e) {
      err = e as Error;
    }
    // Assertion 1: flush really was called (a no-argument decode()), proving
    // the fixed code path executed.
    expect(decodeSpy.mock.calls.some((args) => args.length === 0)).toBe(true);
    // Assertion 2: the complete frame preceding the truncated fragment comes
    // out unchanged, unaffected by this flush and uncontaminated by a
    // flushed-out U+FFFD leaking into the adjacent frame.
    expect(out).toEqual(["完整帧"]);
    // Assertion 3: [DONE] was never seen, so it is still handled as a
    // truncation and never silently passed through.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/DeepSeek 流异常提前结束.*\[DONE\]/);
    decodeSpy.mockRestore();
  });

  it("正常 [DONE] 收尾路径不受影响(回归)", async () => {
    const client = deepseekClientFactory(
      "k",
      fakeFetch({
        chunks: [
          'data: {"choices":[{"delta":{"content":"正常"}}]}\n',
          "data: [DONE]\n",
        ],
      }),
    );
    expect(await collect(client)).toEqual(["正常"]);
  });

  it("流中途卡死(无新 chunk、无 [DONE]、无报错):停滞看门狗到点触发,报错清晰、不挂起", async () => {
    vi.useFakeTimers();
    try {
      const client = deepseekClientFactory("k", stalledBodyFetch());
      const gen = client
        .stream({
          model: "deepseek-chat",
          max_tokens: 100,
          messages: [{ role: "user", content: "hi" }],
        })
        [Symbol.asyncIterator]();
      const pending = gen.next();
      const assertion = expect(pending).rejects.toThrow(/DeepSeek 流停滞/);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("持续有进展但单次间隔都低于停滞阈值:总时长超过整体上限仍会被硬顶掐断", async () => {
    vi.useFakeTimers();
    try {
      // One chunk every 50s (< the 60s stall threshold, so no single gap trips
      // the stall watchdog), accumulating to 7*50s=350s > the 300s overall
      // cap.
      const client = deepseekClientFactory("k", slowDripFetch(50_000, 10));
      const gen = client
        .stream({
          model: "deepseek-chat",
          max_tokens: 100,
          messages: [{ role: "user", content: "hi" }],
        })
        [Symbol.asyncIterator]();
      const resultPromise = (async () => {
        try {
          for (;;) {
            const r = await gen.next();
            if (r.done) return { ok: true as const };
          }
        } catch (e) {
          return { ok: false as const, error: e as Error };
        }
      })();
      for (let i = 0; i < 7; i++) {
        await vi.advanceTimersByTimeAsync(50_000);
      }
      const result = await resultPromise;
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toMatch(/DeepSeek 超时/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("abortAllDeepSeekStreams(#21 item9:quitLifecycle 完整性收尾)", () => {
  it("红→绿:中止飞行中请求的 AbortSignal,连接阶段的 fetch 随之 reject", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = (async (
      _url: unknown,
      init?: { signal?: AbortSignal },
    ) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    }) as unknown as typeof fetch;
    const client = deepseekClientFactory("k", fetchImpl);
    const iterator = client
      .stream({
        model: "m",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    expect(capturedSignal?.aborted).toBe(false);

    abortAllDeepSeekStreams();

    expect(capturedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow(/aborted/);
  });

  it("调用方的 signal 一 abort,请求本身随之中止(codex 50-SR-01 #2:自查超时)", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = (async (
      _url: unknown,
      init?: { signal?: AbortSignal },
    ) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    }) as unknown as typeof fetch;
    const ac = new AbortController();
    const pending = deepseekClientFactory("k", fetchImpl)
      .stream({
        model: "m",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
        signal: ac.signal,
      })
      [Symbol.asyncIterator]()
      .next();
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);
    ac.abort();
    expect(capturedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow(/aborted/);
  });

  it("没有飞行中的请求时调用不报错(idempotent/no-op)", () => {
    expect(() => abortAllDeepSeekStreams()).not.toThrow();
  });

  it("请求正常结束后不再被追踪:后续 abortAllDeepSeekStreams() 不影响已完成的流", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      body: (async function* () {
        yield new TextEncoder().encode('data: {"choices":[{"delta":{}}]}\n');
        yield new TextEncoder().encode("data: [DONE]\n");
      })(),
    })) as unknown as typeof fetch;
    const client = deepseekClientFactory("k", fetchImpl);
    const chunks: string[] = [];
    for await (const ev of client.stream({
      model: "m",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (ev.delta) chunks.push(ev.delta);
    }
    // Calling it after completion must not throw (the controller has already
    // been removed from the tracking set).
    expect(() => abortAllDeepSeekStreams()).not.toThrow();
  });
});

describe("scrubSecrets", () => {
  it("抹掉配置的 key 本体与通用 sk-xxxx 形态令牌", () => {
    expect(
      scrubSecrets(
        "Bearer sk-configuredKey123 rejected",
        "sk-configuredKey123",
      ),
    ).toBe("Bearer [REDACTED] rejected");
    // Beyond the configured key, any other leaked sk-shaped token must also be
    // caught (via the generic regex).
    expect(
      scrubSecrets("leaked sk-someOtherToken999 too", "sk-configuredKey123"),
    ).toBe("leaked [REDACTED] too");
  });

  it("没有可疑内容时原样返回", () => {
    expect(scrubSecrets("plain error text", "sk-configuredKey123")).toBe(
      "plain error text",
    );
  });
});
