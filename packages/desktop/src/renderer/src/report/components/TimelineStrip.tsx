import type { CandidateEvent } from "@gladlog/analysis";
import { timelineMarks } from "../derive/timelineMarks";

export function TimelineStrip({
  candidates,
  activeEventIds,
  onSelect,
}: {
  candidates: CandidateEvent[];
  activeEventIds: string[];
  onSelect: (id: string) => void;
}) {
  const { marks } = timelineMarks(candidates);
  if (marks.length === 0) return null;

  return (
    <div
      style={{
        height: "24px",
        position: "relative",
        background: "var(--bg-2, #1f2937)",
        borderRadius: "4px",
        margin: "12px 0",
        border: "1px solid var(--border, #374151)",
      }}
    >
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
  );
}
