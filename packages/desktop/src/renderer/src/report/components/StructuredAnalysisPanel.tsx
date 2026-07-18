import type { Finding } from "@gladlog/analysis";
import {
  buildMatchContext,
  extractCandidateFindings,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { useEffect, useMemo, useState } from "react";

import { bridge } from "../../bridge";
import { deriveKeyMoments } from "../derive/keyMoments";
import { toLegacySafe } from "../derive/legacySource";
import type { ReportSource } from "../derive/types";
import { ExportButtons } from "./ExportButtons";
import { FindingsList } from "./FindingsList";
import { KeyMomentAxis } from "./KeyMomentAxis";
import { MatchHero } from "./MatchHero";

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
  const [, setActiveEventIds] = useState<string[]>([]);
  // 教练回复语言(backlog #1):持久化在 settings,main 侧按它注入 system
  // prompt 并分键缓存;这里只需在切换后重查缓存。
  const [lang, setLang] = useState<"zh" | "en" | null>(null);
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState("");
  // 本场目标(D3 闭环):跨场标记「还在犯」的 top 分类,作为本场观察目标。
  const [goals, setGoals] = useState<
    Array<{ category: string; recurring: number; lastTitle?: string }>
  >([]);

  useEffect(() => {
    try {
      const p = bridge().analysis.aggregate?.();
      if (!p) return;
      void p
        .then((cats) =>
          setGoals(
            (cats ?? [])
              .filter((c) => c.recurring > 0)
              .sort((a, b) => b.recurring - a.recurring)
              .slice(0, 3)
              .map((c) => ({
                category: c.category,
                recurring: c.recurring,
                lastTitle: c.recent?.[0]?.title,
              })),
          ),
        )
        .catch(() => {});
    } catch {
      /* 测试桩无该面 */
    }
  }, [matchId]);

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
    const offDelta = bridge().analysis.onDelta?.(
      (d: { matchId: string; text: string }) => {
        if (d.matchId !== matchId) return;
        setPreview((p) => (p + d.text).slice(-600));
      },
    );
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
      offDelta?.();
      offDone();
      offError();
    };
  }, [matchId]);

  const input = useMemo(() => {
    try {
      const legacy = toLegacySafe(source);
      const players = Object.values(legacy.units).filter((u) => u.info);
      // owner = 日志记录者(playerId);找不到时回退友方治疗(旧行为)。
      // DPS 记录者从此走 DPS 视角(D2)—— 治疗记录者行为不变。
      const owner =
        players.find(
          (u) =>
            u.id === legacy.playerId &&
            u.reaction === CombatUnitReaction.Friendly,
        ) ??
        players.find(
          (u) =>
            isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
        );
      if (!owner) return null;

      const candidates = extractCandidateFindings(legacy, owner.id);
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);

      const richContext = buildMatchContext(legacy, friends, enemies, {
        useTimelinePrompt: true,
        owner,
      });
      const spec = specToString(owner.spec);

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

  const keyMoments = useMemo(() => deriveKeyMoments(source), [source]);

  // 分流谓词与 buildFindingsPrompt 的 whole-round 判定同源:
  // facts.t 缺席 = 整场观察(cd-waste 等),不进时间轴。
  const splitFindings = useMemo(() => {
    const timedIds = new Set(
      (input?.candidates ?? [])
        .filter((c) => c.facts.t !== undefined)
        .map((c) => c.id),
    );
    const timed = (result?.findings ?? []).filter((f) =>
      f.eventIds?.some((id) => timedIds.has(id)),
    );
    const wholeRound = (result?.findings ?? []).filter(
      (f) => !timed.includes(f),
    );
    return { timed, wholeRound };
  }, [input, result]);

  // finding 的 eventIds → 引用事件里最早的 t + 涉及单位。
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
    setPreview("");
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
      {goals.length > 0 && (
        <div className="rpt-ai-goals" data-testid="ai-goals">
          <span className="rpt-ai-goals-title">
            本场目标 —— 你标记过「还在犯」的问题:
          </span>
          {goals.map((g) => (
            <span key={g.category} className="rpt-ai-goal">
              ↻{g.recurring} {g.category}
              {g.lastTitle ? `(上次:${g.lastTitle})` : ""}
            </span>
          ))}
        </div>
      )}
      {error && <div className="rpt-ai-error">{error}</div>}

      {result && (
        <div className="rpt-ai-body">
          <MatchHero
            source={source}
            findingCount={result.findings.length}
            topSeverity={result.findings[0]?.severity}
          />

          {result.hadNarration === false ? (
            <div>
              <KeyMomentAxis
                moments={keyMoments}
                findings={[]}
                candidates={input?.candidates ?? []}
                onSeek={onSeekEvent}
                onSelectEvidence={setActiveEventIds}
              />
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
            <>
              <KeyMomentAxis
                moments={keyMoments}
                findings={splitFindings.timed}
                candidates={input?.candidates ?? []}
                onSeek={onSeekEvent}
                onSelectEvidence={setActiveEventIds}
                flags={flags}
                onFlag={handleFlag}
              />
              {splitFindings.wholeRound.length > 0 && (
                <>
                  <h4 className="rpt-axis-wholeround-label">整场观察</h4>
                  <FindingsList
                    findings={splitFindings.wholeRound}
                    onSelect={setActiveEventIds}
                    onJump={onSeekEvent ? handleJump : undefined}
                    candidates={input?.candidates ?? []}
                    flags={flags}
                    onFlag={handleFlag}
                  />
                </>
              )}
            </>
          )}

          <ExportButtons
            findings={result.findings}
            heroText={`${result.findings.length} findings`}
          />
        </div>
      )}

      {state === "running" && preview && (
        <pre className="rpt-ai-preview" data-testid="ai-preview">
          {preview}
        </pre>
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
