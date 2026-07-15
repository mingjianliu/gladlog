import { useEffect, useMemo, useState } from "react";
import type { ReportSource } from "../derive/types";
import { bridge } from "../../bridge";
import {
  extractCandidateFindings,
  buildMatchContext,
  specToString,
  isHealerSpec,
} from "@gladlog/analysis";
import type { Finding } from "@gladlog/analysis";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import type { GladMatch } from "@gladlog/parser";
import { MatchHero } from "./MatchHero";
import { TimelineStrip } from "./TimelineStrip";
import { FindingsList } from "./FindingsList";
import { ExportButtons } from "./ExportButtons";

type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
};

type State = "idle" | "running" | "done" | "error";

export function StructuredAnalysisPanel({
  source,
  matchId,
  onSeekEvent,
}: {
  source: ReportSource;
  matchId: string;
  /** 证据链跳转:切到回放并定位到 t(秒,自 combat start)。 */
  onSeekEvent?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>("");
  const [activeEventIds, setActiveEventIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setState("idle");
    setError("");
    setActiveEventIds([]);
    void (async () => {
      const cached = (await bridge().analysis.getCached(
        matchId,
      )) as AnalysisResult | null;
      if (!cancelled && cached) {
        setResult(cached);
        setState("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  useEffect(() => {
    const offDone = bridge().analysis.onDone(
      (d: { matchId: string; result: unknown }) => {
        if (d.matchId !== matchId) return;
        setResult(d.result as AnalysisResult);
        setState("done");
        setError("");
      },
    );
    const offError = bridge().analysis.onError(
      (d: { matchId: string; message: string }) => {
        if (d.matchId !== matchId) return;
        setState("error");
        setError(d.message);
      },
    );
    return () => {
      offDone();
      offError();
    };
  }, [matchId]);

  const input = useMemo(() => {
    try {
      const legacy = toLegacyMatch({
        ...source,
        rawLines: [],
      } as unknown as GladMatch);
      const candidates = extractCandidateFindings(legacy);
      const players = Object.values(legacy.units).filter((u) => u.info);
      const healer = players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
      if (!healer) return null;

      const friends = players.filter((u) => u.reaction === healer.reaction);
      const enemies = players.filter((u) => u.reaction !== healer.reaction);

      const richContext = buildMatchContext(legacy, friends, enemies, {
        useTimelinePrompt: true,
      });
      const spec = specToString(healer.spec);

      return {
        matchId,
        candidates,
        richContext,
        spec,
      };
    } catch {
      return null;
    }
  }, [source, matchId]);

  // finding 的 eventIds → 引用事件里最早的 t + 涉及单位;同时点亮 strip 标记。
  const handleJump = (eventIds: string[]) => {
    if (!onSeekEvent || !input) return;
    const evs = input.candidates.filter((c) => eventIds.includes(c.id));
    if (evs.length === 0) return;
    const first = evs.reduce((a, b) => (a.t <= b.t ? a : b));
    setActiveEventIds(eventIds);
    onSeekEvent(first.t, [...new Set(evs.flatMap((e) => e.unitNames))]);
  };

  const handleAnalyze = async () => {
    if (!input) return;
    setError("");
    setState("running");
    await bridge().analysis.run(input);
  };

  const buttonText =
    state === "running"
      ? "分析中…"
      : state === "done"
        ? "重新分析"
        : "结构化分析";

  return (
    <div className="rpt-ai-panel">
      {error && <div className="rpt-ai-error">{error}</div>}

      {result && (
        <div className="rpt-ai-body">
          <MatchHero
            source={source}
            findingCount={result.findings.length}
            topSeverity={result.findings[0]?.severity}
          />

          <TimelineStrip
            candidates={input?.candidates ?? []}
            activeEventIds={activeEventIds}
            onSelect={(id) => setActiveEventIds([id])}
          />

          {result.hadNarration === false ? (
            <div>
              <p
                style={{
                  color: "var(--mute)",
                  fontSize: "12px",
                  fontStyle: "italic",
                  marginBottom: "12px",
                }}
              >
                Showing candidate events deterministically. No narration
                generated.
              </p>
              <FindingsList findings={[]} onSelect={setActiveEventIds} />
            </div>
          ) : (
            <FindingsList
              findings={result.findings}
              onSelect={setActiveEventIds}
              onJump={onSeekEvent ? handleJump : undefined}
            />
          )}

          <ExportButtons
            findings={result.findings}
            heroText={`${result.findings.length} findings`}
          />
        </div>
      )}

      <div className="rpt-ai-actions">
        <button
          onClick={handleAnalyze}
          disabled={!input || state === "running"}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
