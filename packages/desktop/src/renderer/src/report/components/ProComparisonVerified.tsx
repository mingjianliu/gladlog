import { useEffect, useMemo, useRef, useState } from "react";
import type { ReportSource } from "../derive/types";
import { cohortDims } from "../derive/cohortDims";
import { CohortDimsTable } from "./CohortDimsTable";
import { bridge } from "../../bridge";
import {
  computeDpsMetrics,
  computeHealerMetrics,
  enemyCompSignature,
  specToString,
  isHealerSpec,
  enemyCompArchetype,
} from "@gladlog/analysis";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import type { GladMatch } from "@gladlog/parser";
import datagenManifest from "@gladlog/analysis/src/data/datagen-manifest.json";

type CompareResult = {
  verifiedComparison: {
    dims: Array<{
      key: string;
      value: number | null;
      p10: number;
      p50: number;
      p90: number;
      percentile: number;
      verdict: string;
    }>;
    facts: Record<string, string>;
  };
  report: string | null;
  droppedReason: string | null;
  cellMeta: {
    enemyComp?: string | null;
    durationP50?: number | null;
    firstKillTop?: { spec: string; pct: number } | null;
    spec: string;
    bracket: string;
    archetype: string;
    buildGroup: string;
    sampleN: number;
    fellBackTo: string;
  } | null;
};
type State = "idle" | "running" | "done" | "error";

export function ProComparisonVerified({
  source,
  matchId,
  runSignal,
  hideActions,
}: {
  source: ReportSource;
  matchId: string;
  /** 合并按钮:nonce 变化时触发对比(与 AI 分析一键同跑)。 */
  runSignal?: number;
  /** 合并按钮模式下隐藏本面板自己的操作行。 */
  hideActions?: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string>("");
  const [lang, setLang] = useState<"en" | "zh">("zh");

  useEffect(() => {
    // 教练回复语言同时决定面板/表格文案语言;bridge 面可能缺(fixture 桩)
    void (async () => {
      try {
        const s = await bridge().settings.get();
        if (s?.aiLanguage === "en" || s?.aiLanguage === "zh")
          setLang(s.aiLanguage);
      } catch {
        /* 默认 zh */
      }
    })();
  }, []);

  // Show any cached (version-matched) result on mount. Reset state on matchId
  // change (the panel is not remounted per match) and guard against a late
  // resolve from a previous match overwriting the current one.
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setState("idle");
    setError("");
    void (async () => {
      const cached = (await bridge().compare.getCached(
        matchId,
      )) as CompareResult | null;
      if (!cancelled && cached) {
        setResult(cached);
        setState("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // Subscribe to the (verified) done + error events. We deliberately do NOT
  // display onDelta text: streamed deltas are interpolated but not yet
  // claim-checked, so only the final claimChecked result is rendered.
  useEffect(() => {
    const offDelta = bridge().compare.onDelta((d) => {
      if (d.matchId === matchId) setState("running");
    });
    const offDone = bridge().compare.onDone(
      (d: { matchId: string; result: unknown }) => {
        if (d.matchId !== matchId) return;
        setResult(d.result as CompareResult);
        setState("done");
        setError("");
      },
    );
    const offError = bridge().compare.onError((d) => {
      if (d.matchId !== matchId) return;
      setState("error");
      setError(d.message);
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, [matchId]);

  // Derive the compare input from the parsed match: the Friendly healer's
  // metrics, spec, talents, and the enemy-comp archetype. Defensive: any
  // shape mismatch yields null (button disabled) rather than crashing.
  const input = useMemo(() => {
    try {
      const legacy = toLegacyMatch({
        ...source,
        rawLines: [],
      } as unknown as GladMatch);
      const players = Object.values(legacy.units).filter((u) => u.info);
      // owner = 日志记录者(与 AI 面板同语义);DPS 记录者走 DPS 指标组
      // (pro-comparison P1),找不到时回退友方治疗(旧行为)。
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
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const metrics = isHealerSpec(owner.spec)
        ? computeHealerMetrics(legacy, owner.name)
        : computeDpsMetrics(legacy, owner.name);
      const talents = (owner.info?.talents ?? [])
        .map((t: { id1: number }) => t.id1)
        .filter(Boolean);
      return {
        matchId,
        healerMetrics: metrics as unknown as Record<string, number | null>,
        enemyComp: enemyCompSignature(enemies.map((e) => specToString(e.spec))),
        spec: specToString(owner.spec),
        talents,
        bracket: legacy.startInfo?.bracket ?? "unknown",
        archetype: enemyCompArchetype(enemies),
        wowBuild: (datagenManifest as { build?: string }).build ?? "0.0.0.0",
      };
    } catch {
      return null;
    }
  }, [source, matchId]);

  const handleCompare = async () => {
    if (!input) return;
    setError("");
    setState("running");
    await bridge().compare.run(input);
  };

  // 合并按钮(用户反馈):AI 分析主按钮的 nonce 变化 → 同步触发对比
  const lastSignal = useRef(runSignal ?? 0);
  useEffect(() => {
    if (runSignal == null || runSignal === lastSignal.current) return;
    lastSignal.current = runSignal;
    void handleCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal]);

  const buttonText =
    state === "running"
      ? "对比中…"
      : state === "done"
        ? "重新对比"
        : "vs 高分群体";

  return (
    <div className="rpt-ai-panel">
      {error && <div className="rpt-ai-error">{error}</div>}
      {result && result.cellMeta && (
        <div className="rpt-ai-body">
          <h3>{lang === "zh" ? "vs 同水平高手" : "vs your cohort"}</h3>
          <p
            style={{
              color: "var(--ink-2)",
              fontSize: "12px",
              marginBottom: "12px",
            }}
          >
            {result.cellMeta.enemyComp
              ? `对阵同阵容(${result.cellMeta.enemyComp})的高手场 · `
              : ""}
            {result.cellMeta.spec} · {result.cellMeta.bracket} ·{" "}
            {result.cellMeta.archetype} · {result.cellMeta.buildGroup} build ·
            N=
            {result.cellMeta.sampleN}
            {result.cellMeta.enemyComp &&
              result.cellMeta.durationP50 != null && (
                <>
                  {" · 时长中位 "}
                  {Math.floor(result.cellMeta.durationP50 / 60)}:
                  {String(result.cellMeta.durationP50 % 60).padStart(2, "0")}
                  {result.cellMeta.firstKillTop
                    ? ` · ${result.cellMeta.firstKillTop.pct}% 先杀 ${result.cellMeta.firstKillTop.spec}`
                    : ""}
                </>
              )}
          </p>
          <CohortDimsTable
            lang={lang}
            rows={cohortDims(result.verifiedComparison.dims, lang)}
          />
          {result.report !== null ? (
            <p style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}>
              {result.report}
            </p>
          ) : (
            <div>
              <p
                style={{
                  color: "var(--mute)",
                  fontSize: "12px",
                  fontStyle: "italic",
                }}
              >
                {lang === "zh"
                  ? "仅展示实测数据(AI 解说未生成)"
                  : "Showing measured numbers only"}
              </p>
              {result.droppedReason && (
                <p style={{ color: "var(--mute)", fontSize: "11px" }}>
                  {lang === "zh" ? "原因:" : "Reason: "}
                  {result.droppedReason}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {result && !result.cellMeta && (
        <div className="rpt-ai-body">
          <p style={{ color: "var(--ink-2)", fontSize: "12px" }}>
            {lang === "zh"
              ? "该专精/阵容的高手参照样本还不够,暂无法对比。"
              : "Not enough cohort data for this build and comp yet."}
          </p>
        </div>
      )}
      {!hideActions && (
        <div className="rpt-ai-actions">
          <button
            onClick={handleCompare}
            disabled={!input || state === "running"}
          >
            {buttonText}
          </button>
        </div>
      )}
    </div>
  );
}
