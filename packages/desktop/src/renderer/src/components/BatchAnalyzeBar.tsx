import { useEffect, useState } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import {
  type BatchStatus,
  cancelBatch,
  dismissBatchSummary,
  getBatchStatus,
  startBatch,
  subscribeBatch,
} from "../batch/batchAnalysis";
import { bridge } from "../bridge";

const labelFor = (m: StoredMatchMeta): string => {
  const d = new Date(m.startTime);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm} · ${m.bracket}`;
};

/**
 * Entry point for batch AI analysis (top of the match-list sidebar). Two ways
 * to choose the work set:
 *  - default: the N newest matches ("最近 N 场");
 *  - selection: the rows checked in the match list below (a checked shuffle
 *    row means the whole lobby — the driver expands it to all its rounds).
 * Either way the 跳过已分析 toggle decides whether cached matches are skipped
 * (default, the pre-2026-08-04 behavior) or re-run and overwritten.
 * The driver is a module singleton, so switching views does not interrupt it;
 * this component is only its display surface.
 */
export function BatchAnalyzeBar({
  metas,
  selected,
  onClearSelected,
}: {
  metas: StoredMatchMeta[];
  /** Match-list row selection (meta ids). Non-empty switches the bar into
   * "analyze exactly these" mode. */
  selected?: Set<string>;
  onClearSelected?: () => void;
}) {
  const [st, setSt] = useState<BatchStatus>(getBatchStatus);
  const [n, setN] = useState(10);
  const [skipAnalyzed, setSkipAnalyzed] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => subscribeBatch(() => setSt(getBatchStatus())), []);

  const selCount = selected?.size ?? 0;

  const start = async () => {
    setNote(null);
    let analyzed: Set<string>;
    try {
      analyzed = new Set(await bridge().analysis.listAnalyzed());
    } catch {
      analyzed = new Set();
    }
    // metas is always newest→oldest (both paging and store insertion maintain
    // descending startTime).
    // Shuffles are NOT pre-filtered by `analyzed`: their meta.id is the first
    // round's id, and a cached first round ≠ all rounds analyzed (agy flash
    // review F2 — having manually viewed R1 would skip the whole match and R2+
    // would never get their turn). Shuffles are handed to the driver, which
    // checks the cache round by round and counts the match as skipped only when
    // every round is cached.
    // In re-analyze mode (跳过已分析 off) there is no pre-filter at all — the
    // point is to run the cached ones again.
    const preFilter = (m: StoredMatchMeta): boolean =>
      !skipAnalyzed || m.kind === "shuffle" || !analyzed.has(m.id);
    const items = (
      selCount > 0
        ? metas.filter((m) => selected!.has(m.id) && preFilter(m))
        : metas.filter(preFilter).slice(0, Math.max(1, n))
    ).map((m) => ({ id: m.id, label: labelFor(m) }));
    if (items.length === 0) {
      setNote(selCount > 0 ? "勾选的对局都已分析" : "没有未分析的对局");
      return;
    }
    void startBatch(items, { skipAnalyzed });
    // The batch owns the work set now; leftover checkmarks would only invite a
    // confusing second launch of the same matches.
    if (selCount > 0) onClearSelected?.();
  };

  if (st.running) {
    return (
      <div className="batch-bar" data-testid="batch-bar">
        <span className="batch-progress">
          批量分析中 {st.done}/{st.total}
          {st.currentLabel ? ` · ${st.currentLabel}` : ""}
        </span>
        <button className="batch-cancel" onClick={() => cancelBatch()}>
          取消
        </button>
      </div>
    );
  }

  if (st.finishedAt) {
    return (
      <div className="batch-bar" data-testid="batch-bar">
        <span className="batch-summary">
          {st.cancelled ? "已取消:" : "批量完成:"}
          成功 {st.ok} · 跳过 {st.skipped} · 失败 {st.failed}
        </span>
        <button
          className="batch-dismiss"
          aria-label="关闭小结"
          onClick={() => dismissBatchSummary()}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="batch-bar" data-testid="batch-bar">
      <span
        className="batch-title"
        title="默认从最新往旧取 N 场;在下方列表勾选后改为只分析勾选的对局(shuffle 一勾整场 6 盘)。最多三路并行,输出与手动逐场分析一致(含深挖)。"
      >
        批量 AI 分析
      </span>
      {selCount > 0 ? (
        <span className="batch-sel" data-testid="batch-sel">
          已勾选 {selCount} 场
          <button
            className="batch-sel-clear"
            aria-label="清除勾选"
            title="清除勾选"
            onClick={() => onClearSelected?.()}
          >
            ✕
          </button>
        </span>
      ) : (
        <label className="batch-n">
          最近
          <input
            type="number"
            min={1}
            max={999}
            value={n}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setN(Math.floor(v));
            }}
          />
          场
        </label>
      )}
      <label
        className="batch-skip"
        title="勾选(默认):已有分析缓存的对局跳过,不重复花钱。取消勾选:重新分析并覆盖旧结果(与单场面板的「重新分析」一致);正在分析中的对局任何模式下都不会重复跑。"
      >
        <input
          type="checkbox"
          data-testid="batch-skip"
          checked={skipAnalyzed}
          onChange={(e) => setSkipAnalyzed(e.target.checked)}
        />
        跳过已分析
      </label>
      <button className="batch-start" onClick={() => void start()}>
        {selCount > 0 ? `分析勾选的 ${selCount} 场` : "开始"}
      </button>
      {note && <span className="batch-note">{note}</span>}
    </div>
  );
}
