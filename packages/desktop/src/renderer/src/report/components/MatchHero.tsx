import type { ReportSource } from "../derive/types";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import type { GladMatch } from "@gladlog/parser";
import { specToString, isHealerSpec } from "@gladlog/analysis";

export function MatchHero({
  source,
  findingCount,
  topSeverity,
}: {
  source: ReportSource;
  findingCount: number;
  topSeverity?: string;
}) {
  let spec = "Unknown";
  let bracket = "unknown";
  let result = "Unknown";
  let duration = "0s";

  try {
    const legacy = toLegacyMatch({ ...source, rawLines: [] } as unknown as GladMatch);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const healer = players.find(
      (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly
    );
    if (healer) {
      spec = specToString(healer.spec);
      const isWin = legacy.winningTeamId === healer.info?.teamId;
      result = isWin ? "Win" : "Loss";
    }
    bracket = legacy.startInfo?.bracket ?? "unknown";
    const sec = Math.round(((legacy.endTime ?? 0) - (legacy.startTime ?? 0)) / 1000);
    if (sec > 0) {
      duration = sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
    }
  } catch {
    // Ignore, render fallbacks
  }

  return (
    <div className="rpt-ai-body" style={{ marginBottom: "16px" }}>
      <p
        style={{
          color: "var(--ink-2)",
          fontSize: "12px",
          marginBottom: "6px",
          textTransform: "uppercase",
          letterSpacing: "0.5px"
        }}
      >
        {spec} · {bracket} · {result} · {duration}
      </p>
      <h3 style={{ margin: 0, fontSize: "18px" }}>
        {findingCount} findings{topSeverity ? ` · ${topSeverity}` : ""}
      </h3>
    </div>
  );
}
