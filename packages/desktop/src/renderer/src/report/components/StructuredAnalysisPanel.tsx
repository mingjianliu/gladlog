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
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { toLegacySafe } from "../derive/legacySource";
import { deriveVulnBands } from "../derive/vulnWindows";
import { MatchHero } from "./MatchHero";
import { TimelineStrip } from "./TimelineStrip";
import { FindingsList, findingKey } from "./FindingsList";
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
  // 教练回复语言(backlog #1):持久化在 settings,main 侧按它注入 system
  // prompt 并分键缓存;这里只需在切换后重查缓存。
  const [lang, setLang] = useState<"zh" | "en" | null>(null);
  const [flags, setFlags] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      void bridge()
        .analysis.getFlags(matchId)
        .then(setFlags)
        .catch(() => setFlags({}));
    } catch {
      setFlags({});
    }
  }, [matchId]);

  const handleFlag = (key: string, flag: "done" | "recurring" | null) => {
    try {
      void bridge()
        .analysis.setFlag(matchId, key, flag)
        .then(setFlags)
        .catch(() => {});
    } catch {
      /* 测试桩无该面 */
    }
  };

  useEffect(() => {
    // 测试桩/旧 fixture bridge 可能没有 settings 面 —— 静默回退默认中文
    try {
      void bridge()
        .settings.get()
        .then((s) =>
          setLang((s as { aiLanguage?: "zh" | "en" }).aiLanguage ?? "zh"),
        )
        .catch(() => setLang("zh"));
    } catch {
      setLang("zh");
    }
  }, []);

  const switchLang = async (next: "zh" | "en") => {
    if (next === lang || state === "running") return;
    setLang(next);
    try {
      await bridge().settings.save({ aiLanguage: next });
    } catch {
      /* 无 settings 面(测试桩)时仅本地切换 */
    }
  };

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
  }, [matchId, lang]);

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
      const legacy = toLegacySafe(source);
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

  const vulnBands = useMemo(() => deriveVulnBands(source), [source]);

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
            bands={vulnBands}
            onJump={
              onSeekEvent ? (tSeconds) => onSeekEvent(tSeconds, []) : undefined
            }
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
              flags={flags}
              onFlag={handleFlag}
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
        <div className="rpt-ai-lang" title="教练回复语言">
          {(["zh", "en"] as const).map((l) => (
            <button
              key={l}
              className={l === lang ? "active" : ""}
              disabled={state === "running"}
              onClick={() => void switchLang(l)}
            >
              {l === "zh" ? "中文" : "EN"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
