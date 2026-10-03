// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { CoachChatCard } from "../src/renderer/src/report/components/CoachChatCard";

const src = { units: {} } as never;

function stubChat(state: unknown, send?: (input: unknown) => Promise<unknown>) {
  // Default send (used when no custom send is passed): the real backend's
  // send() persists to disk BEFORE it resolves — CoachChatCard's success path
  // only clears pending once its own refresh() has fetched the persisted
  // messages (final review F5/B2). So push the new messages into the passed-in
  // state.messages in place (same object reference) so later getState() calls
  // can see them, instead of forever returning an unchanging empty array like
  // the old stub did.
  const defaultSend = async (input: unknown) => {
    const s = state as { status: string; messages?: unknown[] };
    if (s.status === "ready" && Array.isArray(s.messages)) {
      const q = (input as { question: string }).question;
      s.messages = [
        ...s.messages,
        { role: "user", content: q, at: Date.now() },
        { role: "assistant", content: "答", at: Date.now() },
      ];
    }
    return { status: "ok", reply: "答" };
  };
  (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
    chat: {
      getState: async () => state,
      send: send ?? defaultSend,
      cancel: async () => {},
    },
    analysis: { getCached: async () => ({ findings: [] }) },
  };
}

it("unsupported:显示 CLI 引导文案,无输入框", async () => {
  stubChat({ status: "unsupported" });
  render(<CoachChatCard source={src} matchId="m1" />);
  await screen.findByText(/需要本地 CLI 后端/);
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("not-ready:显示「开始 AI 分析后才能对话」", async () => {
  stubChat({ status: "not-ready" });
  render(<CoachChatCard source={src} matchId="m1" />);
  await screen.findByText(/开始 AI 分析后才能对话/);
});

it("ready:发消息 → 显示用户消息与教练回复", async () => {
  stubChat({
    status: "ready",
    backend: "claudeCli",
    model: "sonnet",
    messages: [],
    busy: false,
  });
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "为什么?" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("答");
  expect(screen.getByText("为什么?")).toBeTruthy();
});

it("ready:真实后端持久化消息追上后展示,不产生重复气泡", async () => {
  let messages: Array<{
    role: "user" | "assistant";
    content: string;
    at: number;
  }> = [];
  (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
    chat: {
      getState: async () => ({
        status: "ready",
        backend: "claudeCli",
        model: "sonnet",
        messages,
        busy: false,
      }),
      // Simulate the real backend: a successful send persists this round into
      // messages (rather than the stub's fixed, unchanging empty array).
      send: async (input: { question: string }) => {
        messages = [
          ...messages,
          { role: "user" as const, content: input.question, at: Date.now() },
          { role: "assistant" as const, content: "答复", at: Date.now() },
        ];
        return { status: "ok", reply: "答复" };
      },
      cancel: async () => {},
    },
    analysis: { getCached: async () => ({ findings: [] }) },
  };
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "为什么?" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("答复");
  expect(screen.getAllByText("答复")).toHaveLength(1);
  expect(screen.getAllByText("为什么?")).toHaveLength(1);
});

it("ready:重复提问不被误杀(终审 F5/B2:成功路径不进 optimistic,pending 挂到自己这次 refresh() 完成才清,不做角色+内容匹配)", async () => {
  let messages: Array<{
    role: "user" | "assistant";
    content: string;
    at: number;
  }> = [];
  let replyCount = 0;
  (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
    chat: {
      getState: async () => ({
        status: "ready",
        backend: "claudeCli",
        model: "sonnet",
        messages,
        busy: false,
      }),
      // Every successful send persists that round into messages — simulating
      // how a real backend's conversation grows.
      send: async (input: { question: string }) => {
        replyCount += 1;
        const reply = `答复${replyCount}`;
        messages = [
          ...messages,
          { role: "user" as const, content: input.question, at: Date.now() },
          { role: "assistant" as const, content: reply, at: Date.now() },
        ];
        return { status: "ok", reply };
      },
      cancel: async () => {},
    },
    analysis: { getCached: async () => ({ findings: [] }) },
  };
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");

  fireEvent.change(input, { target: { value: "为什么?" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("答复1");

  fireEvent.change(input, { target: { value: "为什么?" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("答复2");

  // The old "role + text content" dedupe would mistake the second identical
  // question for the already-persisted first one as "has arrived" and pull the
  // bubble early. Now the success path never maintains a separate optimistic
  // array at all — what is displayed is chatState.messages itself, with no
  // content matching — so both user questions must be present.
  expect(screen.getAllByText("为什么?")).toHaveLength(2);
  expect(screen.getAllByText("答复1")).toHaveLength(1);
  expect(screen.getAllByText("答复2")).toHaveLength(1);
});

it("发送失败(error):该条标失败并给重试按钮", async () => {
  stubChat(
    {
      status: "ready",
      backend: "claudeCli",
      model: "sonnet",
      messages: [],
      busy: false,
    },
    async () => ({ status: "error", message: "boom" }),
  );
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "问" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText(/发送失败/);
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});

it("重试不清空无关在飞草稿(终审 B1):失败态下草稿有内容 → 点重试 → 草稿保留", async () => {
  stubChat(
    {
      status: "ready",
      backend: "claudeCli",
      model: "sonnet",
      messages: [],
      busy: false,
    },
    async () => ({ status: "error", message: "boom" }),
  );
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "第一条问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText(/发送失败/);
  // While the failure bubble is up, the user types a new draft that has
  // nothing to do with this retry.
  fireEvent.change(input, { target: { value: "无关的新草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  // Retry sends the old text captured in `failed`, not the current draft — it
  // must not touch draft (the old implementation's unconditional setDraft("")
  // at the top of doSend wiped this new draft instantly).
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "无关的新草稿",
  );
  // The retry fails too; wait for it to finish so no dangling promise / act
  // warning is left behind.
  await screen.findByText(/发送失败/);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "无关的新草稿",
  );
});

it("取消视为中性操作,不进失败态(终审 F6b):停止后不显示发送失败,问题文本还给草稿", async () => {
  stubChat(
    {
      status: "ready",
      backend: "claudeCli",
      model: "sonnet",
      messages: [],
      busy: false,
    },
    async () => ({ status: "error", message: "已停止" }),
  );
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "问题A" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  // pending is over and the button is back to its send label — doSend's
  // catch/else branch has already run.
  await screen.findByRole("button", { name: "发送" });
  expect(screen.queryByText(/发送失败/)).toBeNull();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "问题A",
  );
});

it("在飞草稿不被抹(终审 F6a):发送成功后不清空用户飞行期间新打的字", async () => {
  let messages: Array<{
    role: "user" | "assistant";
    content: string;
    at: number;
  }> = [];
  let releaseSend!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
    chat: {
      getState: async () => ({
        status: "ready",
        backend: "claudeCli",
        model: "sonnet",
        messages,
        busy: false,
      }),
      // Block on the gate until the test releases it, simulating "in flight";
      // the real backend's send() persists to disk before resolving, so once
      // it resolves messages already contains this round.
      send: async (input: { question: string }) => {
        await gate;
        messages = [
          ...messages,
          { role: "user" as const, content: input.question, at: Date.now() },
          { role: "assistant" as const, content: "答", at: Date.now() },
        ];
        return { status: "ok", reply: "答" };
      },
      cancel: async () => {},
    },
    analysis: { getCached: async () => ({ findings: [] }) },
  };
  render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "第一条问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  // The draft is cleared at the moment of sending (F6a) — the original
  // question text should be visible in the pending bubble.
  await screen.findByText("第一条问题");
  // The user keeps typing while the request is in flight.
  fireEvent.change(input, { target: { value: "还没发的新草稿" } });
  releaseSend();
  await screen.findByText("答");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "还没发的新草稿",
  );
});

it("切场清状态(终审 F4):match1 的失败标记/草稿不带进 match2", async () => {
  stubChat(
    {
      status: "ready",
      backend: "claudeCli",
      model: "sonnet",
      messages: [],
      busy: false,
    },
    async () => ({ status: "error", message: "boom" }),
  );
  const { rerender } = render(<CoachChatCard source={src} matchId="m1" />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "为什么?" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText(/发送失败/);
  // After the failure the user types another draft that has not been sent yet.
  fireEvent.change(input, { target: { value: "还没发的新草稿" } });

  rerender(<CoachChatCard source={src} matchId="m2" />);
  await screen.findByRole("textbox"); // m2 is ready too, so the input remains
  expect(screen.queryByText(/发送失败/)).toBeNull();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});

it("教练回复按 Markdown 渲染;用户自己的提问保持纯文本", async () => {
  stubChat({
    status: "ready",
    backend: "claudeCli",
    model: "sonnet",
    messages: [
      { role: "user", content: "我的 **问题** 就这么写的", at: Date.now() },
      {
        role: "assistant",
        content: "## 结论\n\n- 先开 **爆发**\n- 再看时机",
        at: Date.now(),
      },
    ],
    busy: false,
  });
  render(<CoachChatCard source={src} matchId="m1" />);
  await screen.findByText(/结论/);
  const coachBubble = document.querySelector(
    ".coach-chat-msg--coach",
  ) as HTMLElement;
  // The reply gets real elements instead of literal `##` / `**` characters.
  // "##" lands on h4 — h1/h2 have no business inside a chat bubble.
  expect(coachBubble.querySelector("h4.coach-md-h")?.textContent).toBe("结论");
  expect(coachBubble.querySelector("strong")?.textContent).toBe("爆发");
  expect(coachBubble.querySelectorAll("li")).toHaveLength(2);
  // The user's own turn is not re-interpreted as markup.
  expect(screen.getByText("我的 **问题** 就这么写的")).toBeTruthy();
});
