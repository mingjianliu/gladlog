import type { Finding } from "@gladlog/analysis";
import { useState } from "react";

import { findingKey } from "../../../../shared/findingKey";
export { findingKey };

export function FindingsList({
  findings,
  onSelect,
  onJump,
  flags,
  onFlag,
}: {
  findings: Finding[];
  onSelect: (eventIds: string[]) => void;
  /** 跳到回放:定位到该 finding 引用的最早事件时刻。 */
  onJump?: (eventIds: string[]) => void;
  /** 跟进标记(phase3 #3a):key = findingKey(f)。 */
  flags?: Record<string, string>;
  onFlag?: (key: string, flag: "done" | "recurring" | null) => void;
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});

  if (findings.length === 0) {
    return (
      <div className="rpt-ai-body">
        <p className="rpt-ai-none">No findings for this match.</p>
      </div>
    );
  }

  return (
    <div className="rpt-findings">
      {findings.map((f, i) => {
        const clampable = f.explanation.length > 90;
        const expanded = !!open[i];
        return (
          <div key={i} className={`rpt-finding rpt-finding-${f.severity}`}>
            <div className="rpt-finding-head">
              <span className="rpt-finding-sev">
                {f.severity} · {f.category}
              </span>
              <span className="rpt-finding-title">{f.title}</span>
            </div>
            <p
              className={
                clampable && !expanded
                  ? "rpt-finding-body clamp"
                  : "rpt-finding-body"
              }
            >
              {f.explanation}
            </p>
            {clampable && (
              <button
                className="rpt-finding-toggle"
                onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
              >
                {expanded ? "收起 ▴" : "展开全文 ▾"}
              </button>
            )}
            {f.eventIds && f.eventIds.length > 0 && (
              <div className="rpt-finding-ev">
                <button onClick={() => onSelect(f.eventIds)}>Evidence</button>
                {onJump && (
                  <button
                    className="rpt-finding-jump"
                    onClick={() => onJump(f.eventIds)}
                  >
                    ▶ 回放此刻
                  </button>
                )}
                {onFlag &&
                  (() => {
                    const key = findingKey(f);
                    const cur = flags?.[key];
                    return (
                      <span className="rpt-finding-flags">
                        <button
                          className={cur === "done" ? "active" : ""}
                          title="标记为已改进"
                          onClick={() =>
                            onFlag(key, cur === "done" ? null : "done")
                          }
                        >
                          ✓ 已跟进
                        </button>
                        <button
                          className={cur === "recurring" ? "active rec" : ""}
                          title="标记为还在犯"
                          onClick={() =>
                            onFlag(
                              key,
                              cur === "recurring" ? null : "recurring",
                            )
                          }
                        >
                          ↻ 还在犯
                        </button>
                      </span>
                    );
                  })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
