import type { CandidateEvent, Finding } from "@gladlog/analysis";
import { fmtTime } from "@gladlog/analysis";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { findingKey } from "../../../../shared/findingKey";
import {
  candidateShortLabel,
  categoryLabel,
  severityLabel,
} from "../derive/findingDisplay";
import type { KeyMoment } from "../derive/keyMoments";
import { ChipIcon } from "./SpellInline";

const GAP_S = 30;
/** Adjacent minors of the same kind within ≤5s collapse into one burst row. */
const CLUSTER_GAP_S = 5;
/** Long-match valve: above this total entry count, minor runs collapse into a
 * "+N minor moments" row by default. */
const VALVE_MAX_ENTRIES = 40;


/** Unified text glyphs (no emoji: 🛡♱ render inconsistently across
 * platforms). */
const KIND_ICON: Record<KeyMoment["kind"], string> = {
  death: "✕",
  "burst-band": "▮",
  defensive: "◆",
  dispel: "✛",
  cc: "◎",
  "heal-gap": "∅",
  position: "⇄",
};

const KIND_ZH: Record<KeyMoment["kind"], string> = {
  death: "死亡",
  "burst-band": "爆发",
  defensive: "防御",
  dispel: "驱散",
  cc: "控制",
  "heal-gap": "空窗",
  position: "走位",
};

type Entry =
  | { at: number; kind: "moment"; m: KeyMoment }
  | { at: number; kind: "cluster"; mkind: KeyMoment["kind"]; ms: KeyMoment[] }
  | { at: number; kind: "finding"; f: Finding };
type KeyedEntry = Entry & { key: string };
type Row =
  KeyedEntry | { at: number; kind: "more"; key: string; items: KeyedEntry[] };

const isMinorRow = (e: KeyedEntry): boolean =>
  e.kind === "cluster" || (e.kind === "moment" && e.m.weight === "minor");

/** Key-moment axis: the static narrative spine, interleaving system events and
 * finding cards by time, each clickable to jump into the replay.
 * P0-2: death/burst-band + finding cards are major (full pills); defensive /
 * dispel / CC are minor small-text rows with same-kind bursts collapsed; long
 * matches additionally fold behind the "+N minor moments" valve. */
export function KeyMomentAxis({
  moments,
  findings,
  candidates,
  onSeek,
  onSelectEvidence,
  flags,
  onFlag,
  lang = "zh",
  habitOf,
  rich,
}: {
  moments: KeyMoment[];
  findings: Finding[];
  candidates: CandidateEvent[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** Evidence highlighting for finding cards (same contract as FindingsList's
   * onSelect). */
  onSelectEvidence: (eventIds: string[]) => void;
  flags?: Record<string, string>;
  onFlag?: (key: string, flag: "done" | "recurring" | null) => void;
  /** Localizes severity (stays English in EN reply mode); category is left as
   * is (it is an aggregation key — do not map it). */
  lang?: "zh" | "en";
  /** Cross-match habit badge (spec §4): returns the badge text or null. The
   * text is interpolated from deterministic stats (habitBadgeText) and never
   * goes through the model. */
  habitOf?: (f: Finding) => string | null;
  /** Rich rendering of AI body text (#15 inline icons); plain text by
   * default. */
  rich?: (text?: string | null) => ReactNode;
}) {
  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  );
  // Merge + sort + collapse same-kind minor bursts (1g: single left rail, no
  // more left/right interleaving)
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

    // Adjacent same-kind minors within ≤5s → one burst row
    const clustered: Entry[] = [];
    let i = 0;
    while (i < merged.length) {
      const e = merged[i]!;
      if (e.kind === "moment" && e.m.weight === "minor") {
        const run = [e.m];
        let j = i + 1;
        while (j < merged.length) {
          const n = merged[j]!;
          if (
            n.kind !== "moment" ||
            n.m.weight !== "minor" ||
            n.m.kind !== e.m.kind ||
            // Same kind but different side (being CC'd vs landing CC) has
            // opposite polarity — never merge those
            n.m.side !== e.m.side ||
            n.at - merged[j - 1]!.at > CLUSTER_GAP_S
          )
            break;
          run.push(n.m);
          j++;
        }
        if (run.length >= 2) {
          clustered.push({
            at: e.at,
            kind: "cluster",
            mkind: e.m.kind,
            ms: run,
          });
          i = j;
          continue;
        }
      }
      clustered.push(e);
      i++;
    }

    return clustered.map((e): KeyedEntry => {
      const key =
        e.kind === "finding"
          ? `f:${findingKey(e.f)}`
          : e.kind === "cluster"
            ? `c:${e.mkind}:${e.at}:${e.ms.length}`
            : `m:${e.m.kind}:${e.m.t}:${e.m.title}:${e.m.unitNames.join(",")}`;
      return { ...e, key };
    });
  }, [moments, findings, byId]);

  // Long-match valve: >40 total entries → each run of consecutive minors
  // collapses into a "+N minor moments" row, expandable on click
  const [openSegs, setOpenSegs] = useState<Set<string>>(new Set());
  const rows = useMemo((): Row[] => {
    if (entries.length <= VALVE_MAX_ENTRIES) return entries;
    const out: Row[] = [];
    let i = 0;
    while (i < entries.length) {
      const e = entries[i]!;
      if (isMinorRow(e)) {
        let j = i;
        while (j < entries.length && isMinorRow(entries[j]!)) j++;
        const items = entries.slice(i, j);
        out.push({ at: e.at, kind: "more", key: `seg:${e.key}`, items });
        i = j;
        continue;
      }
      out.push(e);
      i++;
    }
    return out;
  }, [entries]);

  // Node ring color (1g): kill window / burst band = gold, deaths by
  // friend-or-foe, findings by severity
  const nodeColor = (e: Row): string => {
    if (e.kind === "more") return "var(--hairline)";
    if (e.kind === "finding")
      return e.f.severity === "high"
        ? "var(--loss)"
        : e.f.severity === "med"
          ? "var(--gold)"
          : "var(--mute)";
    if (e.kind === "cluster") return "var(--accent-line)";
    if (e.m.kind === "burst-band") return "var(--gold)";
    if (e.m.kind === "death" || e.m.kind === "cc")
      return e.m.side === "friendly" ? "var(--loss)" : "var(--win)";
    if (e.m.kind === "heal-gap") return "var(--loss)";
    return "var(--accent-line)";
  };

  const minorNode = (m: KeyMoment, key: string) => (
    <button
      key={key}
      className={`rpt-axis-node-minor k-${m.kind} s-${m.side}`}
      data-testid="axis-node-minor"
      title={onSeek ? `跳到 ${fmtTime(m.jumpT)} 的回放` : undefined}
      onClick={onSeek ? () => onSeek(m.jumpT, m.unitNames) : undefined}
    >
      <span className="rpt-axis-icon">{KIND_ICON[m.kind]}</span>
      <span className="rpt-axis-title">{m.title}</span>
      {m.detail && <span className="rpt-axis-detail">{m.detail}</span>}
    </button>
  );

  const clusterNode = (e: Extract<Entry, { kind: "cluster" }>, key: string) => {
    const titles = e.ms.map((m) => m.title);
    return (
      <button
        key={key}
        className="rpt-axis-node-minor rpt-axis-cluster"
        data-testid="axis-node-minor"
        title={titles.join(" · ")}
        onClick={
          onSeek ? () => onSeek(e.ms[0]!.jumpT, e.ms[0]!.unitNames) : undefined
        }
      >
        <span className="rpt-axis-icon">{KIND_ICON[e.mkind]}</span>
        <span className="rpt-axis-title">
          {KIND_ZH[e.mkind]} ×{e.ms.length}:{titles.slice(0, 2).join(" · ")}
          {titles.length > 2 ? " …" : ""}
        </span>
      </button>
    );
  };

  const renderEntry = (e: KeyedEntry) => {
    if (e.kind === "cluster") return clusterNode(e, e.key);
    if (e.kind === "moment" && e.m.weight === "minor")
      return minorNode(e.m, e.key);
    if (e.kind === "moment")
      return (
        <button
          key={e.key}
          className={`rpt-axis-node k-${e.m.kind} s-${e.m.side}`}
          data-testid="axis-node"
          title={onSeek ? `跳到 ${fmtTime(e.m.jumpT)} 的回放` : undefined}
          onClick={onSeek ? () => onSeek(e.m.jumpT, e.m.unitNames) : undefined}
        >
          <span className="rpt-axis-icon">{KIND_ICON[e.m.kind]}</span>
          <span className="rpt-axis-title">{e.m.title}</span>
          {e.m.kind === "burst-band" && e.m.toT != null && (
            <span className="rpt-axis-detail">
              {fmtTime(e.at)}–{fmtTime(e.m.toT)}
            </span>
          )}
          {e.m.detail && <span className="rpt-axis-detail">{e.m.detail}</span>}
        </button>
      );
    return (
      <div
        key={e.key}
        className={`rpt-finding rpt-finding-${e.f.severity} rpt-axis-finding`}
        data-testid="axis-node"
      >
        <div className="rpt-finding-head">
          <span className="rpt-finding-sev">
            {severityLabel(e.f.severity, lang)} ·{" "}
            {categoryLabel(e.f.category, lang)}
          </span>
          <span className="rpt-finding-title">
            {rich ? rich(e.f.title) : e.f.title}
          </span>
          {(() => {
            const habit = habitOf?.(e.f);
            return habit ? (
              <span
                className="rpt-finding-habit"
                title="跨对局稳定模式(确定性统计,非 AI 判断)"
              >
                {habit}
              </span>
            ) : null;
          })()}
        </div>
        <p className="rpt-finding-body">
          {rich ? rich(e.f.explanation) : e.f.explanation}
        </p>
        {e.f.deepDive && (
          <div className="rpt-finding-deep" data-testid="finding-deepdive">
            <span className="rpt-finding-deep-tag">深挖</span>
            <p className="rpt-finding-deep-text">
              {rich ? rich(e.f.deepDive.text) : e.f.deepDive.text}
            </p>
            <span className="rpt-finding-deep-chips">
              {e.f.deepDive.chips.map((c, ci) => (
                <button
                  key={ci}
                  className="rpt-finding-evt"
                  title={c.label}
                  onClick={onSeek ? () => onSeek(c.t, c.unitNames) : undefined}
                >
                  <ChipIcon spellId={c.spellId} />⏱ {fmtTime(c.t)} {c.label}
                </button>
              ))}
            </span>
          </div>
        )}
        <div className="rpt-finding-ev">
          <button onClick={() => onSelectEvidence(e.f.eventIds)}>
            Evidence
          </button>
          {/* One chip per evidence item with its timestamp + short label (same
              as FindingsList; each one is individually clickable to jump) */}
          {(e.f.eventIds ?? [])
            .map((id) => byId.get(id))
            .filter((c): c is CandidateEvent => !!c && Number.isFinite(c.t))
            .sort((a, b) => a.t - b.t)
            .map((c) => (
              <button
                key={c.id}
                className="rpt-finding-evt"
                title={
                  (c.spell ? `${c.spell} · ` : "") +
                  (onSeek ? `跳到 ${fmtTime(c.t)} 的回放` : fmtTime(c.t))
                }
                onClick={onSeek ? () => onSeek(c.t, c.unitNames) : undefined}
              >
                ⏱ {fmtTime(c.t)} {candidateShortLabel(c)}
              </button>
            ))}
          {onSeek && (
            <button
              className="rpt-finding-jump"
              onClick={() => {
                const evs = (e.f.eventIds ?? [])
                  .map((id) => byId.get(id))
                  .filter((c): c is CandidateEvent => !!c);
                onSeek(e.at, [...new Set(evs.flatMap((c) => c.unitNames))]);
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
                    onClick={() => onFlag(key, cur === "done" ? null : "done")}
                  >
                    ✓ 已跟进
                  </button>
                  <button
                    className={cur === "recurring" ? "active rec" : ""}
                    title="标记为还在犯"
                    onClick={() =>
                      onFlag(key, cur === "recurring" ? null : "recurring")
                    }
                  >
                    ↻ 还在犯
                  </button>
                </span>
              );
            })()}
        </div>
      </div>
    );
  };

  return (
    <div className="rpt-axis" data-testid="key-moment-axis">
      {rows.map((e, i) => {
        const prev = rows[i - 1];
        const gap = prev && e.at - prev.at > GAP_S ? e.at - prev.at : null;
        const expanded = e.kind === "more" && openSegs.has(e.key);
        return (
          <div key={e.key} className="rpt-axis-item">
            {gap !== null && (
              <div className="rpt-axis-gap" data-testid="axis-gap">
                ⏱ {Math.round(gap)}s 无关键事件 — 折叠
              </div>
            )}
            <span className="rpt-axis-t">{fmtTime(e.at)}</span>
            <div
              className={
                i === rows.length - 1 ? "rpt-axis-entry last" : "rpt-axis-entry"
              }
            >
              <span
                className="rpt-axis-dot"
                style={{ borderColor: nodeColor(e) }}
              />
              {e.kind === "more" ? (
                expanded ? (
                  <span className="rpt-axis-seg">
                    {e.items.map((it) => renderEntry(it))}
                    <button
                      className="rpt-axis-more"
                      data-testid="axis-collapse"
                      onClick={() =>
                        setOpenSegs((cur) => {
                          const next = new Set(cur);
                          next.delete(e.key);
                          return next;
                        })
                      }
                    >
                      − 收起次要时刻
                    </button>
                  </span>
                ) : (
                  <button
                    className="rpt-axis-more"
                    data-testid="axis-more"
                    onClick={() =>
                      setOpenSegs((cur) => new Set(cur).add(e.key))
                    }
                  >
                    +
                    {e.items.reduce(
                      (s, it) => s + (it.kind === "cluster" ? it.ms.length : 1),
                      0,
                    )}{" "}
                    次要时刻
                  </button>
                )
              ) : (
                renderEntry(e)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
