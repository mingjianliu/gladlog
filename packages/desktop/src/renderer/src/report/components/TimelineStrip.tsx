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
  // Only point-in-time events belong on a time axis. Whole-round observations
  // (e.g. cd-waste, which has no `t` fact and t=0) would otherwise plot a
  // misleading marker at the far left labeled "…at 0s".
  const points = candidates.filter((c) => c.facts.t !== undefined);
  if (points.length === 0) return null;

  // Since duration is not passed, derive from max T
  const maxT = Math.max(1, ...points.map((c) => c.t));

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
      {points.map((c) => {
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
              transition: "background 0.2s",
            }}
            title={`${c.type} at ${c.t}s`}
          />
        );
      })}
    </div>
  );
}
