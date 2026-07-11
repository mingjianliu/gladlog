import { useEffect, useMemo, useState } from "react";
import type { ReportSource } from "../derive/types";
import { bridge } from "../../bridge";
import { buildMatchContext } from "@gladlog/analysis";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import type { GladMatch } from "@gladlog/parser";

type State = "idle" | "streaming" | "done" | "error";

export function AIAnalysisPanel({
  source,
  matchId,
}: {
  source: ReportSource;
  matchId: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Check API key and cached content on mount
  useEffect(() => {
    const initPanel = async () => {
      // Check for API key
      const settings = await bridge().settings.get();
      const hasKey = !!settings.anthropicApiKey;
      setHasApiKey(hasKey);

      // Check for cached content
      if (hasKey) {
        const cached = await bridge().ai.getCached(matchId);
        if (cached) {
          setContent(cached.content);
          setState("done");
        }
      }
    };

    void initPanel();
  }, [matchId]);

  // Subscribe to AI events
  useEffect(() => {
    const unsubscribeDelta = bridge().ai.onDelta((d) => {
      if (d.matchId !== matchId) return;
      setState("streaming");
      setContent((prev) => prev + d.text);
      setError("");
    });

    const unsubscribeDone = bridge().ai.onDone((d) => {
      if (d.matchId !== matchId) return;
      setState("done");
      setContent(d.content);
      setError("");
    });

    const unsubscribeError = bridge().ai.onError((d) => {
      if (d.matchId !== matchId) return;
      setState("error");
      setError(d.message);
    });

    return () => {
      unsubscribeDelta();
      unsubscribeDone();
      unsubscribeError();
    };
  }, [matchId]);

  // Build context for analysis
  const analysisContext = useMemo(() => {
    // Convert StoredMatch/StoredShuffleRound to GladMatch-like shape
    const sourceWithEmptyRawLines = {
      ...source,
      rawLines: [],
    } as unknown as GladMatch;
    const legacy = toLegacyMatch(sourceWithEmptyRawLines);

    // Extract friends and enemies
    const friends = Object.values(legacy.units).filter(
      (u) => u.info && u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = Object.values(legacy.units).filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );

    // timeline 变体为产线默认(A/B 2026-07-11 三轮收编:确定性覆盖碾压 + 4 维盲评 CI-improved,accuracy 回归已消除)
    return buildMatchContext(legacy, friends, enemies, {
      useTimelinePrompt: true,
    });
  }, [source]);

  const handleAnalyze = async () => {
    if (state === "streaming") {
      // Cancel ongoing analysis
      await bridge().ai.cancel();
      setState("idle");
      setContent("");
      setError("");
      return;
    }

    // Start analysis
    setContent("");
    setError("");
    setState("streaming");
    await bridge().ai.analyze(matchId, analysisContext);
  };

  if (!hasApiKey) {
    return (
      <div className="rpt-ai-panel">
        <div className="rpt-ai-body">
          <p style={{ color: "var(--ink-2)", fontSize: "12px" }}>
            AI 分析需要 Anthropic API key。
            <br />
            <span style={{ color: "var(--mute)", fontSize: "11px" }}>
              请在设置或开发者视图中填入以启用此功能。
            </span>
          </p>
        </div>
        <div className="rpt-ai-actions">
          <button disabled>分析</button>
        </div>
      </div>
    );
  }

  const buttonText =
    state === "streaming" ? "分析中…" : state === "done" ? "重新分析" : "分析";
  const buttonDisabled = state === "streaming";

  return (
    <div className="rpt-ai-panel">
      {error && <div className="rpt-ai-error">{error}</div>}
      {content && (
        <div className="rpt-ai-body">
          <pre>{content}</pre>
        </div>
      )}
      <div className="rpt-ai-actions">
        <button onClick={handleAnalyze} disabled={buttonDisabled}>
          {buttonText}
        </button>
        {state === "streaming" && (
          <button onClick={() => bridge().ai.cancel()}>取消</button>
        )}
      </div>
    </div>
  );
}
