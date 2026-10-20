import { mkdirSync,mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SELF_REVIEW_PROMPT_VERSION } from "@gladlog/analysis/src/analysis/selfReview";
import { expect, it, vi } from "vitest";

import { PROMPT_VERSION } from "../shared/promptVersion";
import { createCoachChatService } from "./coachChat";

function seedAnalysisCache(
  dir: string,
  matchId: string,
  opts?: { sessionId?: string; selfReview?: unknown; emptySession?: boolean },
) {
  mkdirSync(join(dir, matchId), { recursive: true });
  writeFileSync(
    join(dir, matchId, "analysis-v2.zh.json"),
    JSON.stringify({
      schemaVersion: 2,
      language: "zh",
      lastSlotKey: "claudeCli:claude-sonnet-5",
      slots: {
        "claudeCli:claude-sonnet-5": {
          promptVersion: PROMPT_VERSION,
          createdAt: 1,
          result: {
            findings: [],
            dropped: 0,
            hadNarration: true,
            ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
            ...(opts?.emptySession ? { sessionId: "" } : {}),
            ...(opts?.selfReview ? { selfReview: opts.selfReview } : {}),
          },
        },
      },
    }),
  );
}

const settings = () => ({
  aiBackend: "claudeCli" as const,
  aiBackendCommand: null,
  aiLanguage: "zh" as const,
});

it("门槛:API 后端 unsupported;无分析 session not-ready;有则 ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  const svc = createCoachChatService({
    getSettings: () => ({ ...settings(), aiBackend: "anthropic" as const }),
    matchesDir: dir,
  });
  expect((await svc.getState("m1")).status).toBe("unsupported");

  const svc2 = createCoachChatService({
    getSettings: settings,
    matchesDir: dir,
  });
  expect((await svc2.getState("m1")).status).toBe("not-ready");
  seedAnalysisCache(dir, "m1", { sessionId: "sid-a" });
  const st = await svc2.getState("m1");
  expect(st.status).toBe("ready");
  expect((st as { model: string }).model).toBe("claude-sonnet-5");
});

it("旧缓存无 sessionId → not-ready(重新分析才解锁)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir, "m1"); // no sessionId
  const svc = createCoachChatService({
    getSettings: settings,
    matchesDir: dir,
  });
  expect((await svc.getState("m1")).status).toBe("not-ready");
});

it("send:resume 成功,消息追加并落盘;重开服务能读回(续聊)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir, "m1", { sessionId: "sid-a" });
  const chatRunner = vi.fn(async (_params?: unknown) => "教练回答");
  const svc = createCoachChatService({
    getSettings: settings,
    matchesDir: dir,
    chatRunner: chatRunner as never,
  });
  const r = await svc.send({ matchId: "m1", question: "问" });
  expect(r).toEqual({ status: "ok", reply: "教练回答" });
  expect(chatRunner.mock.calls[0]![0]).toMatchObject({
    backend: "claudeCli",
    sessionId: "sid-a",
    question: "问",
    model: "claude-sonnet-5",
  });
  // Persisted to disk + read back by a fresh instance
  const svc2 = createCoachChatService({
    getSettings: settings,
    matchesDir: dir,
  });
  const st = (await svc2.getState("m1")) as { messages: unknown[] };
  expect(st.messages).toHaveLength(2);
});

it("send:resume 失败且无 seed → need-reseed;带 seed → 播种新 session 后重问", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir, "m1", { sessionId: "sid-dead" });
  const chatRunner = vi
    .fn()
    .mockRejectedValueOnce(new Error("session not found"))
    .mockResolvedValue("自愈后的回答");
  // seedClient stub: captureSession seeds the session, yielding an answer plus
  // a new sessionId
  const seedClient = () => ({
    async *stream(params: { sessionIdHint?: string }) {
      yield { delta: "播种回答(含新问题的答案)" };
      yield { sessionId: params.sessionIdHint ?? "new-sid" };
    },
  });
  const svc = createCoachChatService({
    getSettings: settings,
    matchesDir: dir,
    chatRunner: chatRunner as never,
    seedClient: seedClient as never,
  });
  const r1 = await svc.send({ matchId: "m1", question: "问" });
  expect(r1).toEqual({ status: "need-reseed" });
  const r2 = await svc.send({
    matchId: "m1",
    question: "问",
    seed: { richContext: "CTX", spec: "Holy Paladin", findingsSummary: "F1" },
  });
  expect(r2.status).toBe("ok");
  // The thread's sessionId has been updated to the new id (self-heal)
  const st = (await svc.getState("m1")) as { messages: unknown[] };
  expect(st.messages).toHaveLength(2); // user + assistant (the need-reseed attempt is not persisted)
});

it("并发守卫:同场在飞时再 send 得 busy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir, "m1", { sessionId: "sid-a" });
  let release!: () => void;
  const gate = new Promise<string>((r) => (release = () => r("慢回答")));
  const chatRunner = vi.fn(() => gate);
  const svc = createCoachChatService({
    getSettings: settings,
    matchesDir: dir,
    chatRunner: chatRunner as never,
  });
  const p1 = svc.send({ matchId: "m1", question: "a" });
  const r2 = await svc.send({ matchId: "m1", question: "b" });
  expect(r2.status).toBe("busy");
  release();
  await p1;
});

it("每 CLI 各一条线程:切后端显示各自历史", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir, "m1", { sessionId: "sid-a" });
  const chatRunner = vi.fn(async () => "答");
  let backend: "claudeCli" | "agy" = "claudeCli";
  const svc = createCoachChatService({
    getSettings: () => ({ ...settings(), aiBackend: backend }),
    matchesDir: dir,
    chatRunner: chatRunner as never,
  });
  await svc.send({ matchId: "m1", question: "问" });
  backend = "agy"; // agy has no analysis session → not-ready (and no thread either)
  expect((await svc.getState("m1")).status).toBe("not-ready");
  backend = "claudeCli";
  const st = (await svc.getState("m1")) as { messages: unknown[] };
  expect(st.messages).toHaveLength(2);
});

it("AI 自查开关是分析会话的身份:切换后分析面板显示未分析,问教练也不续接另一类的会话(codex 50-SR-01 #4)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  let selfReview = false;
  const svc = createCoachChatService({
    getSettings: () => ({ ...settings(), aiSelfReview: selfReview }),
    matchesDir: dir,
  });
  seedAnalysisCache(dir, "m1", { sessionId: "sid-plain" });
  expect((await svc.getState("m1")).status).toBe("ready");
  selfReview = true;
  expect((await svc.getState("m1")).status).toBe("not-ready");
  expect(await svc.send({ matchId: "m1", question: "q" })).toEqual({
    status: "not-ready",
  });
  seedAnalysisCache(dir, "m1", {
    sessionId: "sid-reviewed",
    selfReview: { version: SELF_REVIEW_PROMPT_VERSION, status: "reviewed" },
  });
  expect((await svc.getState("m1")).status).toBe("ready");
  selfReview = false;
  expect((await svc.getState("m1")).status).toBe("not-ready");
});

it("自查成功但没抓到自查会话的结果:问教练可用,第一问不续接任何会话而是走重新播种(codex 50-SR-02 #3)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir, "m1", {
    selfReview: { version: SELF_REVIEW_PROMPT_VERSION, status: "reviewed" },
  });
  const chatRunner = vi.fn();
  const seedClient = () => ({
    async *stream(params: { sessionIdHint?: string }) {
      yield { delta: "播种回答" };
      yield { sessionId: params.sessionIdHint ?? "new-sid" };
    },
  });
  const svc = createCoachChatService({
    getSettings: () => ({ ...settings(), aiSelfReview: true }),
    matchesDir: dir,
    chatRunner: chatRunner as never,
    seedClient: seedClient as never,
  });
  expect((await svc.getState("m1")).status).toBe("ready");
  expect(await svc.send({ matchId: "m1", question: "问" })).toEqual({
    status: "need-reseed",
  });
  expect(chatRunner).not.toHaveBeenCalled();
  const r2 = await svc.send({
    matchId: "m1",
    question: "问",
    seed: { richContext: "CTX", spec: "Holy Paladin", findingsSummary: "F1" },
  });
  expect(r2.status).toBe("ok");
  expect(chatRunner).not.toHaveBeenCalled();
  expect(
    ((await svc.getState("m1")) as { messages: unknown[] }).messages,
  ).toHaveLength(2);

  // 自查失败 / 没开自查的老结果没有会话:仍是 not-ready(既有规则不变)
  const dir2 = mkdtempSync(join(tmpdir(), "chat-"));
  seedAnalysisCache(dir2, "m1", {
    selfReview: { version: SELF_REVIEW_PROMPT_VERSION, status: "failed" },
  });
  const svc2 = createCoachChatService({
    getSettings: () => ({ ...settings(), aiSelfReview: true }),
    matchesDir: dir2,
  });
  expect((await svc2.getState("m1")).status).toBe("not-ready");
});

it("存了空串会话的未自查 / 自查失败结果:仍是 not-ready(codex 50-SR-03 #3)", async () => {
  for (const [selfReview, on] of [
    [undefined, false],
    [{ version: SELF_REVIEW_PROMPT_VERSION, status: "failed" }, true],
  ] as const) {
    const dir = mkdtempSync(join(tmpdir(), "chat-"));
    seedAnalysisCache(dir, "m1", { emptySession: true, selfReview });
    const svc = createCoachChatService({
      getSettings: () => ({ ...settings(), aiSelfReview: on }),
      matchesDir: dir,
    });
    expect((await svc.getState("m1")).status).toBe("not-ready");
    expect(await svc.send({ matchId: "m1", question: "q" })).toEqual({
      status: "not-ready",
    });
  }
});
