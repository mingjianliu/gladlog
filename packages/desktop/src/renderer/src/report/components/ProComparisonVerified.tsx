import { useEffect, useMemo, useState } from "react";
import type { ReportSource } from "../derive/types";
import { bridge } from "../../bridge";
import {
  computeHealerMetrics,
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
}: {
  source: ReportSource;
  matchId: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string>("");

  // Show any cached (version-matched) result on mount.
  useEffect(() => {
    void (async () => {
      const cached = (await bridge().compare.getCached(
        matchId,
      )) as CompareResult | null;
      if (cached) {
        setResult(cached);
        setState("done");
      }
    })();
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
      const healer = players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
      if (!healer) return null;
      const enemies = players.filter((u) => u.reaction !== healer.reaction);
      const metrics = computeHealerMetrics(legacy, healer.name);
      const talents = (healer.info?.talents ?? [])
        .map((t: { id1: number }) => t.id1)
        .filter(Boolean);
      return {
        matchId,
        healerMetrics: metrics as unknown as Record<string, number | null>,
        spec: specToString(healer.spec),
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
          <h3>vs your cohort</h3>
          <p
            style={{
              color: "var(--ink-2)",
              fontSize: "12px",
              marginBottom: "12px",
            }}
          >
            {result.cellMeta.spec} · {result.cellMeta.bracket} ·{" "}
            {result.cellMeta.archetype} · {result.cellMeta.buildGroup} build ·
            N=
            {result.cellMeta.sampleN}
          </p>
          {result.verifiedComparison.dims.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              {result.verifiedComparison.dims.map((dim) => (
                <div
                  key={dim.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                  }}
                >
                  <span>{dim.key}</span>
                  <span>
                    {dim.value !== null ? dim.value : "N/A"} ({dim.percentile}
                    th)
                  </span>
                </div>
              ))}
            </div>
          )}
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
                Showing measured numbers only
              </p>
              {result.droppedReason && (
                <p style={{ color: "var(--mute)", fontSize: "11px" }}>
                  Reason: {result.droppedReason}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {result && !result.cellMeta && (
        <div className="rpt-ai-body">
          <p style={{ color: "var(--ink-2)", fontSize: "12px" }}>
            Not enough cohort data for this build and comp yet.
          </p>
        </div>
      )}
      <div className="rpt-ai-actions">
        <button
          onClick={handleCompare}
          disabled={!input || state === "running"}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
