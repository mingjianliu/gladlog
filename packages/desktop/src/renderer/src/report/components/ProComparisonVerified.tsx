import { useEffect, useState } from "react";

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

export function ProComparisonVerified({ match }: { match: any }) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCached = async () => {
      try {
        if ((window as any).gladlog?.compare?.getCached) {
          const cached = await (window as any).gladlog.compare.getCached(match.id);
          setResult(cached);
        }
      } finally {
        setLoading(false);
      }
    };
    void fetchCached();
  }, [match.id]);

  if (loading) {
    return (
      <div className="rpt-ai-panel">
        <div className="rpt-ai-body">Loading comparison...</div>
      </div>
    );
  }

  if (!result) {
    return null;
  }

  if (!result.cellMeta) {
    return (
      <div className="rpt-ai-panel">
        <div className="rpt-ai-body">
          <p>Not enough cohort data for this build and comp yet.</p>
        </div>
      </div>
    );
  }

  const { spec, bracket, archetype, buildGroup, sampleN } = result.cellMeta;

  return (
    <div className="rpt-ai-panel">
      <div className="rpt-ai-body">
        <h3>vs your cohort</h3>
        <p style={{ color: "var(--ink-2)", fontSize: "12px", marginBottom: "12px" }}>
          {spec} · {bracket} · {archetype} · {buildGroup} build · N={sampleN}
        </p>

        {result.verifiedComparison.dims.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            {result.verifiedComparison.dims.map((dim) => (
              <div key={dim.key} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span>{dim.key}</span>
                <span>
                  {dim.value !== null ? dim.value : "N/A"} ({dim.percentile}th)
                </span>
              </div>
            ))}
          </div>
        )}

        {result.report !== null ? (
          <p style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}>{result.report}</p>
        ) : (
          <div>
            <p style={{ color: "var(--mute)", fontSize: "12px", fontStyle: "italic" }}>
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
    </div>
  );
}
