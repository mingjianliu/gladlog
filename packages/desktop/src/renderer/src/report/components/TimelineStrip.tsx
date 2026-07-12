import type { CandidateEvent } from "@gladlog/analysis";

export function TimelineStrip({
  candidates,
  activeEventIds,
  onSelect,
}: {
  candidates: CandidateEvent[];
  activeEventIds: string[];
  onSelect: (id: string) => void;
}) {
  if (candidates.length === 0) return null;

  // Since duration is not passed, derive from max T
  const maxT = Math.max(1, ...candidates.map((c) => c.t));

  return (
    <div
      style={{
        height: "24px",
        position: "relative",
        background: "var(--bg-2, #1f2937)",
        borderRadius: "4px",
        margin: "12px 0",
        border: "1px solid var(--border, #374151)"
      }}
    >
      {candidates.map((c) => {
        const isActive = activeEventIds.includes(c.id);
        const left = `${(c.t / maxT) * 100}%`;
        return (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              position: "absolute",
              left,
              top: 0,
              bottom: 0,
              width: "4px",
              marginLeft: "-2px", // center the marker
              background: isActive
                ? "var(--accent, #60a5fa)"
                : "var(--border, #4b5563)",
              cursor: "pointer",
              zIndex: isActive ? 2 : 1,
              transition: "background 0.2s"
            }}
            title={`${c.type} at ${c.t}s`}
          />
        );
      })}
    </div>
  );
}
