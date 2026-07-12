import type { Finding } from "@gladlog/analysis";

export function FindingsList({
  findings,
  onSelect,
}: {
  findings: Finding[];
  onSelect: (eventIds: string[]) => void;
}) {
  if (findings.length === 0) {
    return (
      <div className="rpt-ai-body">
        <p style={{ color: "var(--mute)", fontStyle: "italic" }}>
          No findings for this match.
        </p>
      </div>
    );
  }

  return (
    <div className="rpt-ai-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {findings.map((f, i) => {
        const color =
          f.severity === "high"
            ? "var(--bad, #f87171)"
            : f.severity === "med"
              ? "var(--warn, #fbbf24)"
              : "var(--mute, #9ca3af)";

        return (
          <div
            key={i}
            className={`rpt-severity-${f.severity}`}
            style={{
              borderLeft: `4px solid ${color}`,
              paddingLeft: "12px",
            }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  color,
                  fontWeight: "bold",
                }}
              >
                {f.severity} · {f.category}
              </span>
              <span style={{ fontSize: "14px", fontWeight: "bold" }}>{f.title}</span>
            </div>
            <p style={{ margin: "4px 0", fontSize: "13px", lineHeight: 1.5 }}>
              {f.explanation}
            </p>
            {f.eventIds && f.eventIds.length > 0 && (
              <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                {f.eventIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => onSelect(f.eventIds)}
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      background: "var(--bg-2, #1f2937)",
                      border: "1px solid var(--border, #374151)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      color: "var(--ink-2, #d1d5db)"
                    }}
                  >
                    Evidence
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
