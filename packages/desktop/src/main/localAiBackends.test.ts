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
    expect(gotArgs).toEqual(["/x", "ask", "--timeout", "110", "hi"]);
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
