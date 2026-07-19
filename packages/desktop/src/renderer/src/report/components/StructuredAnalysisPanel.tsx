import type { Finding } from "@gladlog/analysis";
import {
  buildMatchContext,
  extractCandidateFindings,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { useEffect, useMemo, useRef, useState } from "react";

import { bridge } from "../../bridge";
import {
  buildDeepDivePack,
  DEEP_DIVE_MAX,
  hasCoachableSignal,
  SEVERITY_RANK,
  type DeepDivePack,
} from "@gladlog/analysis";
import { deriveKeyMoments } from "../derive/keyMoments";
import { toLegacySafe } from "../derive/legacySource";
import type { ReportSource } from "../derive/types";
import { ExportButtons } from "./ExportButtons";
import { FindingsList } from "./FindingsList";
import { KeyMomentAxis } from "./KeyMomentAxis";

type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
  fallbackReason?: "no-candidates" | "no-client" | "bad-json";
  deepened?: boolean;
};

/** 0 finding 的中文解释(按回退原因/审计丢弃区分,不再用统一英文提示)。 */
function zeroFindingText(r: AnalysisResult): string {
  if (r.dropped > 0)
    return `模型输出了 ${r.dropped} 条,但全部未通过审计(裸数字/编造事件/因果断言)被丢弃 —— 可点「重新分析」再试。`;
  switch (r.fallbackReason) {
    case "no-candidates":
      return "本场无可指摘事件(无人阵亡、资源使用无明显问题)—— 这是好事,不硬编教练意见。";
    case "no-client":
      return "未配置 AI(设置里填 API key 或本地 CLI 后端),仅展示确定性事件。";
    case "bad-json":
      return "模型返回格式异常,已回退为确定性展示 —— 可点「重新分析」再试。";
    default:
      return "未生成解说(旧版本缓存),点「重新分析」重新生成。";
  }
}

type State = "idle" | "running" | "done" | "error";

export function StructuredAnalysisPanel({
  source,
  matchId,
  onSeekEvent,
  onRunAll,
}: {
  source: ReportSource;
  matchId: string;
  /** 证据链跳转:切到回放并定位到 t(秒,自 combat start)。 */
  onSeekEvent?: (tSeconds: number, unitNames: string[]) => void;
  /** 合并按钮(用户反馈):主按钮同时触发 cohort 对比。 */
  onRunAll?: () => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  // result 归属的 matchId:切场瞬间 result 仍是旧场数据,深挖触发必须核对
  // 归属,否则会把 A 场 findings 写进 B 场缓存(agy 复核 #1)
  const resultForRef = useRef<string | null>(null);
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
    resultForRef.current = null;
    setState("idle");
    setError("");
    setActiveEventIds([]);
    void (async () => {
      const cached = (await bridge().analysis.getCached(
        matchId,
      )) as AnalysisResult | null;
      if (!cancelled && cached) {
        resultForRef.current = matchId;
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
        resultForRef.current = matchId;
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
        ownerName: owner.name,
      };
    } catch {
      return null;
    }
  }, [source, matchId]);

  const keyMoments = useMemo(() => deriveKeyMoments(source), [source]);

  // 深挖轮(自动追问):初轮结果落地后,为高严重度 finding 构建确定性证据包
  // 并触发第二轮。deepened 标志防重;包为空时也调用一次以落标志。
  useEffect(() => {
    if (!result || !input) return;
    if (resultForRef.current !== matchId) return; // 切场瞬间的旧 result
    if (!result.hadNarration || result.deepened) return;
    if (result.findings.length === 0) return;
    try {
      const legacy = toLegacySafe(source);
      const packs: DeepDivePack[] = [];
      const ranked = result.findings
        .map((f, i) => ({ f, i }))
        .sort(
          (a, b) =>
            (SEVERITY_RANK[a.f.severity] ?? 9) -
              (SEVERITY_RANK[b.f.severity] ?? 9) || a.i - b.i,
        );
      for (const { f, i } of ranked) {
        if (packs.length >= DEEP_DIVE_MAX) break;
        const pack = buildDeepDivePack(
          legacy,
          f,
          i,
          input.candidates,
          input.ownerName,
        );
        // 可教信号门(修 1):干净窗口不深挖,避免硬编套话
        if (pack && hasCoachableSignal(pack.items)) packs.push(pack);
      }
      void bridge()
        .analysis.deepen({
          matchId,
          findings: result.findings,
          packs,
          spec: input.spec,
          ownerName: input.ownerName,
        })
        .catch(() => {});
    } catch {
      /* 测试桩无该面 / 构包失败:保持初轮 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, matchId]);

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
    onRunAll?.(); // 一键同跑 cohort 对比
    await bridge().analysis.run(input);
  };

  const buttonText =
    state === "running" ? "分析中…" : state === "done" ? "重新分析" : "AI 分析";

  return (
    <div className="rpt-ai-panel">
      {/* 操作区置顶(1g):主按钮 + 语言段控 + 状态文字 + 右端导出 */}
      <div className="rpt-ai-actions rpt-ai-actions-top">
        <button
          className="rpt-ai-primary"
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
        {result && (
          <span className="rpt-ai-status">
            已缓存 · {result.findings.length} 条 findings
            {result.findings[0]?.severity
              ? ` · 最高严重度 ${result.findings[0].severity}`
              : ""}
          </span>
        )}
        {result && (
          <span className="rpt-ai-export">
            <ExportButtons
              findings={result.findings}
              heroText={`${result.findings.length} findings`}
            />
          </span>
        )}
      </div>
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
                data-testid="zero-finding-reason"
                style={{
                  color: "var(--mute)",
                  fontSize: "12px",
                  marginBottom: "12px",
                }}
              >
                {zeroFindingText(result)}
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
                    onJumpT={onSeekEvent}
                    candidates={input?.candidates ?? []}
                    flags={flags}
                    onFlag={handleFlag}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}

      {state === "running" && preview && (
        <pre className="rpt-ai-preview" data-testid="ai-preview">
          {preview}
        </pre>
      )}
    </div>
  );
}
