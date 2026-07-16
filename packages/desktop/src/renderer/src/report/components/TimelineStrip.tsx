import type { CandidateEvent } from "@gladlog/analysis";
import { timelineMarks } from "../derive/timelineMarks";
import type { VulnBand } from "../derive/vulnWindows";

export function TimelineStrip({
  candidates,
  activeEventIds,
  onSelect,
  bands,
  onJump,
}: {
  candidates: CandidateEvent[];
  activeEventIds: string[];
  onSelect: (id: string) => void;
  /** KILL WINDOW/VULNERABLE 背景色带(相对秒,与标记同轴)。 */
  bands?: VulnBand[];
  /** 提供时:有选中标记则显示「回放此刻」,跳到最早选中标记的 t(秒)。 */
  onJump?: (tSeconds: number) => void;
}) {
  const { marks, maxT } = timelineMarks(candidates);
  if (marks.length === 0) return null;

  const active = marks
    .filter((m) => activeEventIds.includes(m.id))
    .sort((a, b) => a.t - b.t);

  return (
    <div className="rpt-strip-row">
      <div
        style={{
          flex: 1,
          height: "24px",
          position: "relative",
          background: "var(--bg-2, #1f2937)",
          borderRadius: "4px",
          margin: "12px 0",
          border: "1px solid var(--border, #374151)",
          overflow: "hidden",
        }}
      >
        {(bands ?? []).map((b, i) => {
          const left = (Math.min(b.fromS, maxT) / maxT) * 100;
          const width = Math.max(
            0.4,
            ((Math.min(b.toS, maxT) - Math.min(b.fromS, maxT)) / maxT) * 100,
          );
          return (
            <div
              key={`b${i}`}
              data-testid="strip-band"
              className={`rpt-strip-band rpt-strip-band-${b.kind}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 0,
                bottom: 0,
                cursor: onJump ? "pointer" : undefined,
              }}
              onClick={onJump ? () => onJump(b.fromS) : undefined}
              title={
                (b.kind === "burst"
                  ? `击杀尝试 on ${b.targetName}`
                  : `${b.targetName} 脆弱且未被惩罚`) +
                (onJump ? "(点击回放)" : "")
              }
            />
          );
        })}
        {marks.map((m) => {
          const isActive = activeEventIds.includes(m.id);
          return (
            <div
              key={m.id}
              data-testid="timeline-mark"
              data-mark-id={m.id}
              onClick={() => onSelect(m.id)}
              style={{
                position: "absolute",
                left: `${m.leftPct}%`,
                top: 0,
                bottom: 0,
                width: "4px",
                marginLeft: "-2px", // center the marker
                background: isActive
                  ? "var(--accent, #60a5fa)"
                  : "var(--border, #4b5563)",
                cursor: "pointer",
                zIndex: isActive ? 2 : 1,
                transition: "background 0.2s",
              }}
              title={`${m.type} at ${m.t}s`}
            />
          );
        })}
      </div>
      {onJump && active.length > 0 && (
        <button
          className="rpt-strip-jump"
          onClick={() => onJump(active[0]!.t)}
          title={`跳到回放 ${active[0]!.t}s`}
        >
          ▶ 回放此刻
        </button>
      )}
    </div>
  );
}
