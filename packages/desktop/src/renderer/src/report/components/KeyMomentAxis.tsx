import type { CandidateEvent, Finding } from "@gladlog/analysis";
import { useMemo } from "react";

import { findingKey } from "../../../../shared/findingKey";
import type { KeyMoment } from "../derive/keyMoments";

const GAP_S = 30;
const mmss = (sec: number): string =>
  `${Math.floor(sec / 60)}:${Math.floor(sec % 60)
    .toString()
    .padStart(2, "0")}`;

const KIND_ICON: Record<KeyMoment["kind"], string> = {
  death: "✕",
  "burst-band": "▮",
  defensive: "🛡",
  dispel: "♱",
  cc: "◎",
};

type Entry =
  | { at: number; kind: "moment"; m: KeyMoment }
  | { at: number; kind: "finding"; f: Finding };

/** 关键时刻轴:静态叙事脊柱,系统事件与 finding 卡按时间交错,可点跳回放。 */
export function KeyMomentAxis({
  moments,
  findings,
  candidates,
  onSeek,
  onSelectEvidence,
  flags,
  onFlag,
}: {
  moments: KeyMoment[];
  findings: Finding[];
  candidates: CandidateEvent[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** finding 卡的证据高亮(与 FindingsList onSelect 同契约)。 */
  onSelectEvidence: (eventIds: string[]) => void;
  flags?: Record<string, string>;
  onFlag?: (key: string, flag: "done" | "recurring" | null) => void;
}) {
  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  );
  // 归并 + 排序(1g:单侧左轨,不再左右交错)
  const entries = useMemo(() => {
    const merged: Entry[] = [
      ...moments.map((m): Entry => ({ at: m.t, kind: "moment", m })),
      ...findings.flatMap((f): Entry[] => {
        const ts = (f.eventIds ?? [])
          .map((id) => byId.get(id)?.t)
          .filter((t): t is number => Number.isFinite(t));
        return ts.length ? [{ at: Math.min(...ts), kind: "finding", f }] : [];
      }),
    ].sort((a, b) => a.at - b.at);
    return merged.map((e) => {
      const key =
        e.kind === "finding"
          ? `f:${findingKey(e.f)}`
          : `m:${e.m.kind}:${e.m.t}:${e.m.title}:${e.m.unitNames.join(",")}`;
      return { ...e, key };
    });
  }, [moments, findings, byId]);

  // 节点圆描边色(1g):击杀窗口/爆发带 = 金,死亡按敌我,finding 按严重度
  const nodeColor = (e: (typeof entries)[number]): string => {
    if (e.kind === "finding")
      return e.f.severity === "high"
        ? "var(--loss)"
        : e.f.severity === "med"
          ? "var(--gold)"
          : "var(--mute)";
    if (e.m.kind === "burst-band") return "var(--gold)";
    if (e.m.kind === "death" || e.m.kind === "cc")
      return e.m.side === "friendly" ? "var(--loss)" : "var(--win)";
    return "var(--accent-line)";
  };

  return (
    <div className="rpt-axis" data-testid="key-moment-axis">
      {entries.map((e, i) => {
        const prev = entries[i - 1];
        const gap = prev && e.at - prev.at > GAP_S ? e.at - prev.at : null;
        return (
          <div key={e.key} className="rpt-axis-item">
            {gap !== null && (
              <div className="rpt-axis-gap" data-testid="axis-gap">
                ⏱ {Math.round(gap)}s 无关键事件 — 折叠
              </div>
            )}
            <span className="rpt-axis-t">{mmss(e.at)}</span>
            <div
              className={
                i === entries.length - 1
                  ? "rpt-axis-entry last"
                  : "rpt-axis-entry"
              }
            >
              <span
                className="rpt-axis-dot"
                style={{ borderColor: nodeColor(e) }}
              />
              {e.kind === "moment" ? (
                <button
                  className={`rpt-axis-node k-${e.m.kind} s-${e.m.side}`}
                  data-testid="axis-node"
                  title={onSeek ? `跳到 ${mmss(e.m.jumpT)} 的回放` : undefined}
                  onClick={
                    onSeek ? () => onSeek(e.m.jumpT, e.m.unitNames) : undefined
                  }
                >
                  <span className="rpt-axis-icon">{KIND_ICON[e.m.kind]}</span>
                  <span className="rpt-axis-title">{e.m.title}</span>
                  {e.m.kind === "burst-band" && e.m.toT != null && (
                    <span className="rpt-axis-detail">
                      {mmss(e.at)}–{mmss(e.m.toT)}
                    </span>
                  )}
                  {e.m.detail && (
                    <span className="rpt-axis-detail">{e.m.detail}</span>
                  )}
                </button>
              ) : (
                <div
                  className={`rpt-finding rpt-finding-${e.f.severity} rpt-axis-finding`}
                  data-testid="axis-node"
                >
                  <div className="rpt-finding-head">
                    <span className="rpt-finding-sev">
                      {e.f.severity} · {e.f.category}
                    </span>
                    <span className="rpt-finding-title">{e.f.title}</span>
                  </div>
                  <p className="rpt-finding-body">{e.f.explanation}</p>
                  <div className="rpt-finding-ev">
                    <button onClick={() => onSelectEvidence(e.f.eventIds)}>
                      Evidence
                    </button>
                    {/* 每条证据的发生时刻 chip(FindingsList 同款,可各自点跳) */}
                    {(e.f.eventIds ?? [])
                      .map((id) => byId.get(id))
                      .filter(
                        (c): c is CandidateEvent => !!c && Number.isFinite(c.t),
                      )
                      .sort((a, b) => a.t - b.t)
                      .map((c) => (
                        <button
                          key={c.id}
                          className="rpt-finding-evt"
                          title={
                            onSeek ? `跳到 ${mmss(c.t)} 的回放` : mmss(c.t)
                          }
                          onClick={
                            onSeek ? () => onSeek(c.t, c.unitNames) : undefined
                          }
                        >
                          ⏱ {mmss(c.t)}
                        </button>
                      ))}
                    {onSeek && (
                      <button
                        className="rpt-finding-jump"
                        onClick={() => {
                          const evs = (e.f.eventIds ?? [])
                            .map((id) => byId.get(id))
                            .filter((c): c is CandidateEvent => !!c);
                          onSeek(e.at, [
                            ...new Set(evs.flatMap((c) => c.unitNames)),
                          ]);
                        }}
                      >
                        ▶ 回放此刻
                      </button>
                    )}
                    {onFlag &&
                      (() => {
                        const key = findingKey(e.f);
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
                              className={
                                cur === "recurring" ? "active rec" : ""
                              }
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
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
