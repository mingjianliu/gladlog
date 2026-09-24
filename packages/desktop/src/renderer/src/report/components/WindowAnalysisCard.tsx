import type { ReactNode } from "react";

import { fmtTime } from "@gladlog/analysis";

import { ChipIcon } from "./SpellInline";

/** Same shape as the deep-dive chips (matching deepDive.chips in
 * FindingsList/StructuredAnalysisPanel); #16 window analysis takes its own path
 * and does not reuse the Finding type, so this is exported separately for the
 * renderer to assemble. */
type Chips = Array<{
  t: number;
  label: string;
  unitNames: string[];
  /** Only used by the UI to pick an icon (SPELL_ICONS_GENERATED); left unset for
   * entries with no single spell. */
  spellId?: string;
}>;

/** One deep-dive entry (window-multi-finding Task 2): up to 4 may share one
 * "result" state, each audited independently — see auditDeepDives' `mode:
 * "window"` doc comment (packages/analysis/src/analysis/deepDive.ts) and
 * WindowAnalyzeEntry (main/analysis.ts). `title` is `null` when the model
 * omitted it (or on old data), in which case the card renders no heading row
 * for that entry rather than an empty one. */
export type Entry = { title: string | null; text: string; chips: Chips };

export type WindowCardState =
  | { phase: "loading" }
  | { phase: "result"; entries: Entry[]; fromCache: boolean }
  | { phase: "none" } // no signal (deterministic, zero cost — the gate already filtered in the renderer, no model call)
  | { phase: "audit-empty" } // every model output failed the audit → retryable
  | { phase: "no-client" } // no AI configured
  | { phase: "error" } // network/service failure (kept separate from audit-empty; also retryable)
  | { phase: "busy" }; // a request for the same match+window is already in flight (idempotency guard hit) → retryable, no polling

/** Terminal-state card for window analysis (#16): the one-shot deep-dive result
 * for the currently dragged window, in six terminal states.
 * Styling reuses the finding card (`rpt-finding rpt-finding-low`), and the chips
 * row follows the same convention as FindingsList's deep-dive chips (ChipIcon +
 * fmtTime + click to seek the replay). */
export function WindowAnalysisCard({
  state,
  range,
  rich,
  onJumpT,
  onRetry,
}: {
  state: WindowCardState;
  range: { fromS: number; toS: number };
  rich: (t?: string | null) => ReactNode;
  onJumpT: (tSeconds: number, unitNames: string[]) => void;
  onRetry: () => void;
}) {
  return (
    <div
      className="rpt-finding rpt-finding-low rpt-window-ai"
      data-testid="window-ai-card"
    >
      <div className="rpt-finding-head">
        <span className="rpt-finding-title">
          选段分析 {fmtTime(range.fromS)}–{fmtTime(range.toS)}
        </span>
        {state.phase === "result" && state.fromCache && (
          <span className="rpt-finding-habit" title="本窗口的分析结果来自缓存">
            (缓存)
          </span>
        )}
      </div>
      {state.phase === "loading" && (
        <p className="rpt-finding-body">分析中…(约 10–30s)</p>
      )}
      {state.phase === "result" &&
        state.entries.map((e, i) => (
          // Reuses FindingsList/KeyMomentAxis's existing `.rpt-finding-deep`
          // sub-card convention (border-left + tinted background) rather than
          // inventing a new one — window mode is the first caller to put a
          // per-entry heading in that tag slot instead of the fixed literal
          // "深挖" text.
          <div
            key={i}
            className="rpt-finding-deep"
            data-testid="window-ai-entry"
          >
            {e.title && <span className="rpt-finding-deep-tag">{e.title}</span>}
            <p className="rpt-finding-deep-text">{rich(e.text)}</p>
            <span className="rpt-finding-deep-chips">
              {e.chips.map((c, ci) => (
                <button
                  key={ci}
                  className="rpt-finding-evt"
                  title={c.label}
                  onClick={() => onJumpT(c.t, c.unitNames)}
                >
                  <ChipIcon spellId={c.spellId} />⏱ {fmtTime(c.t)} {c.label}
                </button>
              ))}
            </span>
          </div>
        ))}
      {state.phase === "none" && (
        <p className="rpt-finding-body">
          这段未检出可教信号(无受控/防御施放/敌方爆发/HP 骤降等)。
        </p>
      )}
      {state.phase === "audit-empty" && (
        <>
          <p className="rpt-finding-body">模型输出未通过审计。</p>
          <button className="rpt-finding-toggle" onClick={onRetry}>
            重试
          </button>
        </>
      )}
      {state.phase === "error" && (
        <>
          <p className="rpt-finding-body">分析失败(网络或服务异常)。</p>
          <button className="rpt-finding-toggle" onClick={onRetry}>
            重试
          </button>
        </>
      )}
      {state.phase === "no-client" && (
        <p className="rpt-finding-body">未配置 AI(设置里填 API Key 后可用)。</p>
      )}
      {state.phase === "busy" && (
        <>
          <p className="rpt-finding-body">
            该窗口的分析仍在进行中——稍候点重试查看结果。
          </p>
          <button className="rpt-finding-toggle" onClick={onRetry}>
            重试
          </button>
        </>
      )}
    </div>
  );
}
