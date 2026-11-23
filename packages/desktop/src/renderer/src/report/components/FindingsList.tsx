import type { CandidateEvent, Finding } from "@gladlog/analysis";
import { fmtTime } from "@gladlog/analysis";
import type { ReactNode } from "react";
import { useState } from "react";

import { findingKey } from "../../../../shared/findingKey";
import { makeT } from "../../../../shared/i18n";
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
  const t = makeT(lang);

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
                    title={t("report.finding.habitTitle")}
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
                <span className="rpt-finding-deep-tag">
                  {t("report.finding.deepTag")}
                </span>
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
                {t(
                  expanded
                    ? "report.finding.collapse"
                    : "report.finding.expand",
                )}
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
                        (onJump
                          ? t("report.finding.jumpTo", { t: fmtTime(c.t) })
                          : fmtTime(c.t))
                      }
                      onClick={onJump ? () => onJump([c.id]) : undefined}
                    >
                      <ChipIcon spellId={c.spellId} />⏱ {fmtTime(c.t)}{" "}
                      {candidateShortLabel(c, lang)}
                    </button>
                  ))}
                {onJump && (
                  <button
                    className="rpt-finding-jump"
                    onClick={() => onJump(f.eventIds)}
                  >
                    {t("report.finding.replayHere")}
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
                        title={t("report.finding.inspectTitle")}
                        onClick={() => onInspect(first.t, first.unitNames)}
                      >
                        {t("report.finding.inspect")}
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
                      title={t("report.finding.markDone")}
                      onClick={() =>
                        onFlag(key, cur === "done" ? null : "done")
                      }
                    >
                      {t("report.finding.done")}
                    </button>
                    <button
                      className={cur === "recurring" ? "active rec" : ""}
                      title={t("report.finding.markRecurring")}
                      onClick={() =>
                        onFlag(key, cur === "recurring" ? null : "recurring")
                      }
                    >
                      {t("report.finding.recurring")}
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
