import { describe, expect, it } from "vitest";
import {
  agyClientFactory,
  claudeCliClientFactory,
  stripAgyHeader,
  type Runner,
} from "./localAiBackends";
import { resolveAiClient, type AnthropicLike } from "./ai";

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
