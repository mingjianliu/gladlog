import { ensureAnalysisData } from "@gladlog/analysis";
import { useEffect, useState } from "react";

import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";
import { MatchReport } from "./components/MatchReport";
import type { TimeRange } from "./derive/timeRange";
import type { ReportSource, StoredMatch, StoredShuffle } from "./derive/types";

/**
 * The off-screen page for C3 image export (hash route
 * `#export-report=<id>&round=&from=&to=`): it renders exactly the same
 * MatchReport as on screen (same derive, same components, same styles), then
 * sets `window.__gladlogExportReady` once the data is ready, fonts are loaded
 * and two frames have passed; the main process (exportImage.ts) polls that
 * flag and screenshots the whole page.
 * No "export-only" second layout pass — a second drawing path is a second
 * source of lies.
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
  const { t } = useT();
  const [source, setSource] = useState<ReportSource | null>(null);
  // Kept as data and worded at render, so the load effect does not depend on
  // the UI language.
  const [error, setError] = useState<
    | { kind: "notFound" }
    | { kind: "noRounds" }
    | { kind: "thrown"; text: string }
    | null
  >(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The spell-name / talent tables load in the background, and the
        // export is a one-shot screenshot, so we must wait for them before
        // rendering — MatchReport's useMemo does not recompute when the tables
        // finish loading, so rendering first bakes the degraded result into
        // the PNG forever (agy review F2).
        await ensureAnalysisData();
        const doc = (await bridge().matches.get(matchId)) as {
          kind?: string;
          data?: unknown;
        } | null;
        if (!alive) return;
        if (!doc?.data) {
          setError({ kind: "notFound" });
          return;
        }
        if (doc.kind === "shuffle") {
          const s = doc.data as StoredShuffle;
          const round =
            s.rounds.find((r) => r.sequenceNumber === (roundSeq ?? 0)) ??
            s.rounds[0];
          if (!round) {
            setError({ kind: "noRounds" });
            return;
          }
          setSource(round);
        } else {
          setSource(doc.data as StoredMatch);
        }
      } catch (e) {
        if (alive) setError({ kind: "thrown", text: String(e) });
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
        /* jsdom has no fonts */
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

  if (error)
    return (
      <div className="rpt-export-error">
        {error.kind === "notFound"
          ? t("report.exportPage.notFound", { matchId })
          : error.kind === "noRounds"
            ? t("report.exportPage.noRounds")
            : error.text}
      </div>
    );
  if (!source)
    return (
      <div className="rpt-export-loading">{t("report.exportPage.loading")}</div>
    );
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
