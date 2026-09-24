import type { CandidateEvent, Finding } from "@gladlog/analysis";
import { fmtTime } from "@gladlog/analysis";
import type { ReactNode } from "react";
import { useState } from "react";

import { findingKey } from "../../../../shared/findingKey";
import {
  candidateShortLabel,
  categoryLabel,
  severityLabel,
} from "../derive/findingDisplay";
import { ChipIcon } from "./SpellInline";
export { findingKey };


export function FindingsList({
  findings,
  onSelect,
  onJump,
  onJumpT,
  onInspect,
  candidates,
  flags,
  onFlag,
  lang = "zh",
  habitOf,
  rich,
}: {
  findings: Finding[];
  onSelect: (eventIds: string[]) => void;
  /** Jump to the replay: seek to the earliest event this finding cites. */
  onJump?: (eventIds: string[]) => void;
  /** Direct jump from a deep-dive chip (relative seconds + units). */
  onJumpT?: (tSeconds: number, unitNames: string[]) => void;
  /** B2 provenance: switch to the events view with a preset filter of
   *  "this timestamp ± window + this unit". */
  onInspect?: (tSeconds: number, unitNames: string[]) => void;
  /** Candidate event pool: the evidence chips show when each piece of evidence
   *  happened, and each can be clicked to jump there. */
  candidates?: CandidateEvent[];
  /** Follow-up flags (phase3 #3a): key = findingKey(f). */
  flags?: Record<string, string>;
  onFlag?: (key: string, flag: "done" | "recurring" | null) => void;
  /** Localizes severity (stays English in EN reply mode); category is passed
   *  through untouched — it is an aggregation key and must not be mapped. */
  lang?: "zh" | "en";
  /** Cross-match habit badge (spec §4): returns the badge text or null. The
   * text is interpolated from deterministic stats (habitBadgeText) and never
   * goes through the model. */
  habitOf?: (f: Finding) => string | null;
  /** Rich rendering of the AI body text (#15 inline icons); plain text when
   *  omitted. */
  rich?: (text?: string | null) => ReactNode;
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
                {severityLabel(f.severity, lang)} ·{" "}
                {categoryLabel(f.category, lang)}
              </span>
              <span className="rpt-finding-title">
                {rich ? rich(f.title) : f.title}
              </span>
              {(() => {
                const habit = habitOf?.(f);
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
            <p
              className={
                clampable && !expanded
                  ? "rpt-finding-body clamp"
                  : "rpt-finding-body"
              }
            >
              {rich ? rich(f.explanation) : f.explanation}
            </p>
            {f.deepDive && (
              <div className="rpt-finding-deep" data-testid="finding-deepdive">
                <span className="rpt-finding-deep-tag">深挖</span>
                <p className="rpt-finding-deep-text">
                  {rich ? rich(f.deepDive.text) : f.deepDive.text}
                </p>
                <span className="rpt-finding-deep-chips">
                  {f.deepDive.chips.map((c, ci) => (
                    <button
                      key={ci}
                      className="rpt-finding-evt"
                      title={c.label}
                      onClick={
                        onJump ? () => onJumpT?.(c.t, c.unitNames) : undefined
                      }
                    >
                      <ChipIcon spellId={c.spellId} />⏱ {fmtTime(c.t)} {c.label}
                    </button>
                  ))}
                </span>
              </div>
            )}
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
                {/* When each piece of evidence happened: each one jumps to
                    that moment in the replay */}
                {(candidates ?? [])
                  .filter(
                    (c) => f.eventIds.includes(c.id) && Number.isFinite(c.t),
                  )
                  .sort((a, b) => a.t - b.t)
                  .map((c) => (
                    <button
                      key={c.id}
                      className="rpt-finding-evt"
                      title={
                        // When there is a spell, put its name in the tooltip:
                        // the icon alone carries no meaning
                        (c.spell ? `${c.spell} · ` : "") +
                        (onJump ? `跳到 ${fmtTime(c.t)} 的回放` : fmtTime(c.t))
                      }
                      onClick={onJump ? () => onJump([c.id]) : undefined}
                    >
                      <ChipIcon spellId={c.spellId} />⏱ {fmtTime(c.t)}{" "}
                      {candidateShortLabel(c)}
                    </button>
                  ))}
                {onJump && (
                  <button
                    className="rpt-finding-jump"
                    onClick={() => onJump(f.eventIds)}
                  >
                    ▶ 回放此刻
                  </button>
                )}
                {onInspect &&
                  (() => {
                    // B2 provenance: anchor on this finding's earliest
                    // evidence event
                    const first = (candidates ?? [])
                      .filter(
                        (c) =>
                          f.eventIds.includes(c.id) && Number.isFinite(c.t),
                      )
                      .sort((a, b) => a.t - b.t)[0];
                    if (!first) return null;
                    return (
                      <button
                        className="rpt-finding-jump"
                        title="在事件视图里查看该时刻的原始事件"
                        onClick={() => onInspect(first.t, first.unitNames)}
                      >
                        ⛏ 原始事件
                      </button>
                    );
                  })()}
              </div>
            )}
            {/* Follow-up flags sit outside the evidence guard: a finding with
                no eventIds can still be flagged (agy review) */}
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
                        onFlag(key, cur === "recurring" ? null : "recurring")
                      }
                    >
                      ↻ 还在犯
                    </button>
                  </span>
                );
              })()}
          </div>
        );
      })}
    </div>
  );
}
