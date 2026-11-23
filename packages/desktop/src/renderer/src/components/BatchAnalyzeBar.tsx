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
import { batchItemLabel } from "../batch/itemLabel";
import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";

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
  const { t, lang } = useT();
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
    ).map((m) => ({
      id: m.id,
      label: batchItemLabel(m.startTime, m.bracket, lang),
    }));
    if (items.length === 0) {
      setNote(
        selCount > 0 ? t("batch.empty.selected") : t("batch.empty.recent"),
      );
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
          {t("batch.running", { done: st.done, total: st.total })}
          {st.currentLabel ? ` · ${st.currentLabel}` : ""}
        </span>
        <button className="batch-cancel" onClick={() => cancelBatch()}>
          {t("batch.cancel")}
        </button>
      </div>
    );
  }

  if (st.finishedAt) {
    return (
      <div className="batch-bar" data-testid="batch-bar">
        <span className="batch-summary">
          {st.cancelled
            ? t("batch.cancelledPrefix")
            : t("batch.finishedPrefix")}
          {t("batch.summary", {
            ok: st.ok,
            skipped: st.skipped,
            failed: st.failed,
          })}
        </span>
        <button
          className="batch-dismiss"
          aria-label={t("batch.dismissAria")}
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
        title={t("batch.titleHint")}
      >
        {t("batch.title")}
      </span>
      {selCount > 0 ? (
        <span className="batch-sel" data-testid="batch-sel">
          {t("batch.selected", { n: selCount })}
          <button
            className="batch-sel-clear"
            aria-label={t("batch.clearSelection")}
            title={t("batch.clearSelection")}
            onClick={() => onClearSelected?.()}
          >
            ✕
          </button>
        </span>
      ) : (
        <label className="batch-n">
          {t("batch.recentBefore")}
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
          {t("batch.recentAfter")}
        </label>
      )}
      <label
        className="batch-skip"
        title={t("batch.skipHint")}
      >
        <input
          type="checkbox"
          data-testid="batch-skip"
          checked={skipAnalyzed}
          onChange={(e) => setSkipAnalyzed(e.target.checked)}
        />
        {t("batch.skip")}
      </label>
      <button className="batch-start" onClick={() => void start()}>
        {selCount > 0
          ? t("batch.startSelected", { n: selCount })
          : t("batch.start")}
      </button>
      {note && <span className="batch-note">{note}</span>}
    </div>
  );
}
