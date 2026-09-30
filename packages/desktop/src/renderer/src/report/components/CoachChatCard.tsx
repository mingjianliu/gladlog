import { ensureAnalysisData } from "@gladlog/analysis";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { bridge } from "../../bridge";
import { buildAnalysisInput } from "../derive/analysisInput";
import { renderMarkdown } from "../derive/markdown";
import type { ReportSource } from "../derive/types";

type ChatMessage = { role: "user" | "assistant"; content: string; at: number };
type ChatState =
  | { status: "unsupported" }
  | { status: "not-ready" }
  | {
      status: "ready";
      backend: string;
      model: string;
      messages: ChatMessage[];
      busy: boolean;
    };

/**
 * Coach follow-up card (spec 2026-08-02): mounted in the AI view, it continues
 * the conversation on top of this run's analysis session.
 * A small state machine — unsupported (non-CLI backend) / not-ready (no
 * resumable session yet) / ready (message list + input box). Stub discipline:
 * when the bridge().chat surface is missing the card renders null (rather than
 * blowing up the whole AI view).
 */
export function CoachChatCard({
  source,
  matchId,
  rich,
}: {
  source: ReportSource;
  matchId: string;
  /** Optional per-passage rich-text renderer (inlineRich.makeRichText) so spell
   * names inside Markdown keep their icons. Without it the reply still renders
   * as Markdown, just without icons. */
  rich?: (text?: string | null) => ReactNode;
}) {
  const [chatState, setChatState] = useState<ChatState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [available, setAvailable] = useState(true);
  const msgsRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    try {
      const s = await bridge().chat.getState(matchId);
      setChatState(s);
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
  }

  useEffect(() => {
    // Fix for state leaking across matches (final review F4): when matchId
    // changes, the leftover in-flight marker / failure marker / unsent draft all
    // belong to the previous conversation and must be cleared — otherwise
    // match1's failure/pending renders inside match2's chat card.
    setPending(null);
    setFailed(null);
    setDraft("");
    void refresh();
    let off: (() => void) | undefined;
    try {
      off = bridge().analysis?.onDone?.(() => void refresh());
    } catch {
      /* Silent when the surface is missing — degrade to refreshing on
         mount / matchId change */
    }
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    if (msgsRef.current)
      msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [chatState, pending]);

  if (!available) return null;
  if (!chatState) return null;

  /**
   * `fromDraft` (final review B1): whether this call is a "send from the
   * current draft box" — only that entry point is allowed to touch the draft
   * state. The retry button passes false: it sends the old text captured in
   * `failed`, not the current draft. The old implementation called
   * `setDraft("")` unconditionally at the top of doSend, so a new question the
   * user typed while a failure bubble was showing got wiped the instant they
   * hit "retry" — the same defect F6a fixed, reopened through the retry entry
   * point. This time "clear the draft" is scoped to the call site that actually
   * owns the draft.
   */
  async function doSend(question: string, fromDraft: boolean) {
    setPending(question);
    setFailed(null);
    // Fix for the in-flight draft being wiped (final review F6a): the clear
    // moved to the start of the send instead of waiting for a successful
    // response — the local parameter `question` already captured the text to
    // send and is used throughout, so we no longer depend on the draft state
    // surviving. That way a new draft the user types while the request is in
    // flight is not overwritten after the fact by "send succeeded". We clear
    // only when this send came from the draft (fromDraft) — see the note above.
    if (fromDraft) setDraft("");
    try {
      let r = await bridge().chat.send({ matchId, question });
      if (r.status === "need-reseed") {
        await ensureAnalysisData();
        const input = buildAnalysisInput(source, matchId);
        const cached = (await bridge().analysis.getCached(matchId)) as {
          findings?: Array<{ title: string; explanation?: string }>;
        } | null;
        const findingsSummary =
          (cached?.findings ?? [])
            .map((f, i) => `${i + 1}. ${f.title} — ${f.explanation ?? ""}`)
            .join("\n") || "(none)";
        if (!input) {
          setFailed(question);
          setPending(null);
          return;
        }
        r = await bridge().chat.send({
          matchId,
          question,
          seed: {
            richContext: input.richContext,
            spec: input.spec,
            ownerName: input.ownerName,
            findingsSummary,
          },
        });
      }
      if (r.status === "ok") {
        // Optimistic-echo lifecycle (final review F5, round-two B2 fix): we no
        // longer keep a separate `optimistic` array. That design assumed only
        // doSend's own refresh() would pull in the turn that was just
        // persisted, but the analysis:onDone listener (see the effect above)
        // triggers refresh() too; if it lands between setOptimistic(add) and
        // setOptimistic([]), the server messages already contain the turn while
        // optimistic has not been cleared, so `[...messages, ...optimistic]`
        // flashes a duplicated bubble for one frame. The fix: never go through
        // optimistic at all — keep `pending` (the question bubble + "coach is
        // thinking") up until this call's own refresh() completes
        // (the setPending(null) before the finally below). Any concurrent
        // refresh() landing then merely refreshes chatState early and cannot
        // fight a separately maintained optimistic array.
        await refresh();
      } else if (r.status === "error" && r.message === "已停止") {
        // Fix for cancels being mislabeled as failures (final review F6b):
        // pressing "stop" is a neutral action, not a failure — it must not
        // enter the failed+retry UI; we just drop this pending bubble. When the
        // send came from the draft we hand the question text back to the input
        // box so the user can edit/resend it directly; when it came from
        // "retry" (final review B1) we do NOT touch the draft — that is another
        // message's draft — and fall back to the failed state so the user can
        // press "retry" again.
        if (fromDraft) setDraft(question);
        else setFailed(question);
      } else {
        setFailed(question);
      }
    } catch {
      setFailed(question);
    }
    setPending(null);
  }

  if (chatState.status === "unsupported") {
    return (
      <div className="coach-chat-card" data-testid="coach-chat-card">
        <div className="coach-chat-empty">对话教练需要本地 CLI 后端</div>
      </div>
    );
  }
  if (chatState.status === "not-ready") {
    return (
      <div className="coach-chat-card" data-testid="coach-chat-card">
        <div className="coach-chat-empty">开始 AI 分析后才能对话</div>
      </div>
    );
  }

  // Coach replies are Markdown (see derive/markdown): they routinely come back
  // with **bold** / headings / lists / tables, which used to reach the user as
  // literal characters. The user's own turn stays plain text — what they typed
  // is what they should see, not something re-interpreted as markup.
  const renderCoachReply = (content: string) =>
    renderMarkdown(content, rich ? (t: string) => rich(t) : undefined);

  return (
    <div className="coach-chat-card" data-testid="coach-chat-card">
      <div className="coach-chat-head">
        {chatState.backend} · {chatState.model}
      </div>
      <div className="coach-chat-msgs" ref={msgsRef} tabIndex={0}>
        {chatState.messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "coach-chat-msg coach-chat-msg--user"
                : "coach-chat-msg coach-chat-msg--coach"
            }
          >
            {m.role === "assistant" ? renderCoachReply(m.content) : m.content}
          </div>
        ))}
        {pending && (
          <div className="coach-chat-msg coach-chat-msg--user">{pending}</div>
        )}
        {pending && (
          <div className="coach-chat-msg coach-chat-msg--coach coach-chat-thinking">
            教练思考中…
          </div>
        )}
        {failed && (
          <div className="coach-chat-msg coach-chat-msg--user coach-chat-failed">
            {failed}
            <span className="coach-chat-fail-text">发送失败 · </span>
            <button
              className="coach-chat-retry"
              onClick={() => void doSend(failed, false)}
            >
              重试
            </button>
          </div>
        )}
      </div>
      <div className="coach-chat-input-row">
        {/* A placeholder is not a label (axe: form elements must have labels).
            This card was never part of any visual/axe scene, which is why it
            went unnoticed. */}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="问教练…"
          aria-label="向教练提问"
        />
        {pending ? (
          <button onClick={() => void bridge().chat.cancel(matchId)}>
            停止
          </button>
        ) : (
          <button
            disabled={!draft.trim()}
            onClick={() => {
              const q = draft.trim();
              if (q) void doSend(q, true);
            }}
          >
            发送
          </button>
        )}
      </div>
      <div className="coach-chat-disclaimer">回答基于日志推理,可能有误</div>
    </div>
  );
}
