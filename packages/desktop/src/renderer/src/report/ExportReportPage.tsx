import { useEffect, useState } from "react";

import { bridge } from "../bridge";
import { MatchReport } from "./components/MatchReport";
import type { TimeRange } from "./derive/timeRange";
import type { ReportSource, StoredMatch, StoredShuffle } from "./derive/types";

/**
 * C3 导出图片的离屏页(hash 路由 `#export-report=<id>&round=&from=&to=`):
 * 渲染与在屏完全相同的 MatchReport(同 derive、同组件、同样式),
 * 数据就绪 + 字体加载 + 两帧后置 `window.__gladlogExportReady`,
 * 主进程(exportImage.ts)轮询该标志后整页截图。
 * 不做任何"导出专用"的二次排版 —— 第二条绘制路径就是第二个谎源。
 */
export function parseExportHash(hash: string): {
  matchId: string;
  roundSeq: number | null;
  range: TimeRange | null;
} | null {
  const m = /^#?export-report=([^&]+)(.*)$/.exec(hash);
  if (!m) return null;
  const rest = new URLSearchParams(m[2]!.replace(/^&/, ""));
  const from = rest.get("from");
  const to = rest.get("to");
  return {
    matchId: decodeURIComponent(m[1]!),
    roundSeq: rest.has("round") ? Number(rest.get("round")) : null,
    range:
      from !== null && to !== null
        ? { fromS: Number(from), toS: Number(to) }
        : null,
  };
}

export function ExportReportPage({
  matchId,
  roundSeq,
  range,
}: {
  matchId: string;
  roundSeq: number | null;
  range: TimeRange | null;
}) {
  const [source, setSource] = useState<ReportSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const doc = (await bridge().matches.get(matchId)) as {
          kind?: string;
          data?: unknown;
        } | null;
        if (!alive) return;
        if (!doc?.data) {
          setError(`对局 ${matchId} 不存在`);
          return;
        }
        if (doc.kind === "shuffle") {
          const s = doc.data as StoredShuffle;
          const round =
            s.rounds.find((r) => r.sequenceNumber === (roundSeq ?? 0)) ??
            s.rounds[0];
          if (!round) {
            setError("shuffle 无回合数据");
            return;
          }
          setSource(round);
        } else {
          setSource(doc.data as StoredMatch);
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [matchId, roundSeq]);

  useEffect(() => {
    if (!source && !error) return;
    let cancelled = false;
    void (async () => {
      try {
        await document.fonts?.ready;
      } catch {
        /* jsdom 无 fonts */
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          setTimeout(() => {
            if (!cancelled)
              (
                window as unknown as { __gladlogExportReady?: boolean }
              ).__gladlogExportReady = true;
          }, 200),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [source, error]);

  if (error) return <div className="rpt-export-error">{error}</div>;
  if (!source) return <div className="rpt-export-loading">加载中…</div>;
  return (
    <div className="rpt-export-page">
      <MatchReport
        source={source}
        matchId={matchId}
        initialView="report"
        initialTimeRange={range}
      />
    </div>
  );
}
