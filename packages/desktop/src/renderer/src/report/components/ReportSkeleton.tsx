import type { ReactNode } from "react";

import { TEAM_SIDE_LABEL } from "../derive/teamSide";
import { ReportHeader, type ReportHeaderFacts } from "./ReportHeader";
import { TeamDot } from "./TeamDot";
import { TIMELINE_VIEW } from "./Timeline";

/**
 * The report's loading state (T93): the page's own frames with the ink
 * missing. Every placeholder here is the real section's container (same
 * class, so the same border, padding and width) holding its real static
 * labels and quiet bars where the numbers will be; nothing is invented, and a
 * section that fills in replaces a box of the same shape. Two users:
 *
 *  - ReportShell: painted on the click, from what the list row already knows
 *    (result, bracket, map, duration, team sizes), while the match is read.
 *  - MatchReport's staged fill: each section shows its placeholder until its
 *    derive has run.
 *
 * Motion is one thing only - the sweep under the tab row (.rpt-fill-line) -
 * and it stands still under prefers-reduced-motion; the status text carries
 * the same information.
 */

/** A quiet bar. `w` is a CSS width (a number is px). */
export function SkelBar({
  w,
  h = 9,
  className,
}: {
  w: number | string;
  h?: number;
  className?: string;
}) {
  return (
    <span
      className={className ? `rpt-skel-bar ${className}` : "rpt-skel-bar"}
      style={{ width: w, height: h }}
    />
  );
}

/** Tab row status: what the page is waiting for, plus the sweep line. */
export function FillStatus({ label }: { label: string }) {
  return (
    <>
      <span className="rpt-fill-status" role="status" aria-live="polite">
        {label}
      </span>
      <span className="rpt-fill-line" aria-hidden="true" />
    </>
  );
}

/** Match-arc line: one text line of the real height. */
export function SkelArcLine() {
  return (
    <div className="rpt-arc-line rpt-skel" aria-hidden="true">
      <SkelBar w={132} />
      <SkelBar w={148} className="rpt-skel-gap" />
      <SkelBar w={120} className="rpt-skel-gap" />
    </div>
  );
}

/** KPI chips: the chips that always exist, with their real labels. */
export function SkelKpiRow() {
  return (
    <div className="rpt-kpi-row rpt-skel" aria-hidden="true">
      {["失误", "打断", "驱散"].map((k) => (
        <span className="rpt-kpi" key={k}>
          <span className="rpt-kpi-k">{k}</span>
          <span className="rpt-kpi-v">
            <SkelBar w={k === "失误" ? 38 : 10} />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Time-window toolbar: the label is static, the control is not there yet. */
export function SkelToolbar() {
  return (
    <div className="rpt-toolbar-row rpt-skel" aria-hidden="true">
      <div className="rpt-trb">
        <span className="rpt-card-label">时间窗</span>
        <SkelBar w={58} h={24} className="rpt-skel-ctl" />
      </div>
    </div>
  );
}

/** The chart card: the real viewBox (so the real height at any width) with
 * the HP grid and its axis labels - those do not depend on the match. */
export function SkelChart() {
  const { W, H, PAD } = TIMELINE_VIEW;
  const y = (p: number) => H - PAD.b - p * (H - PAD.t - PAD.b);
  return (
    <div className="rpt-timeline-wrap rpt-skel" aria-hidden="true">
      <div className="rpt-tl-head">
        <span className="rpt-card-label">曲线</span>
        <SkelBar w={64} h={24} className="rpt-skel-ctl" />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rpt-timeline">
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(p)}
              y2={y(p)}
              className="rpt-tl-grid"
            />
            <text x={4} y={y(p) + 4} className="rpt-tl-axis">
              {`${Math.round(p * 100)}%`}
            </text>
          </g>
        ))}
      </svg>
      <div className="rpt-tl-legend rpt-skel-legend">
        {[56, 64, 52, 60, 58, 54].map((w, i) => (
          <SkelBar key={i} w={w} />
        ))}
      </div>
    </div>
  );
}

/** Kill-window list: one row. */
export function SkelWindows() {
  return (
    <div className="rpt-windows rpt-skel rpt-skel-windows" aria-hidden="true">
      <SkelBar w="38%" />
    </div>
  );
}

/** Leaderboard card: real head and team headings, one row per player. */
export function SkelMeters({ teamSizes }: { teamSizes: readonly number[] }) {
  const widths = [86, 72, 34, 80, 46, 30];
  let n = 0;
  return (
    <div className="rpt-meters-card rpt-skel" aria-hidden="true">
      <div className="rpt-meters-head">
        <span className="rpt-card-label">榜单模式</span>
        <SkelBar w={196} h={28} className="rpt-skel-ctl" />
      </div>
      <div className="rpt-meters">
        {teamSizes.flatMap((size, t) => [
          <div className="rpt-team-head" key={`h${t}`}>
            <TeamDot side={t === 0 ? "friendly" : "enemy"} />
            {TEAM_SIDE_LABEL[t === 0 ? "friendly" : "enemy"]}
          </div>,
          ...Array.from({ length: size }, (_, i) => {
            const w = widths[n++ % widths.length]!;
            return (
              <div className="rpt-meter-row" key={`r${t}-${i}`}>
                <span className="rpt-skel-name">
                  <span className="rpt-meter-ident rpt-skel-ident" />
                  <SkelBar w={54} />
                </span>
                <span className="rpt-meter-body">
                  <span className="rpt-meter-bar-track">
                    <SkelBar w={`${w}%`} h={14} className="rpt-skel-fill" />
                  </span>
                  <span className="rpt-meter-value rpt-skel-value">
                    <SkelBar w={34} />
                  </span>
                </span>
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

/** Engagement card: the five tabs are static; the table is not. */
export function SkelEngage() {
  return (
    <div className="rpt-engage rpt-skel" aria-hidden="true">
      <div className="rpt-mode-seg rpt-engage-tabs rpt-skel-seg">
        {["打断", "驱散", "光环", "CC链", "破控"].map((t, i) => (
          <span key={t} className={i === 0 ? "active" : ""}>
            {t}
          </span>
        ))}
      </div>
      <div className="rpt-engage-body rpt-skel-rows">
        <SkelBar w="100%" h={1} className="rpt-skel-rule" />
        <SkelBar w="62%" />
        <SkelBar w="54%" />
        <SkelBar w="58%" />
      </div>
    </div>
  );
}

/** A ledger-style card (burst ledger, mistake list): real title, n lines. */
export function SkelLedger({
  title,
  lines = 2,
  testId,
}: {
  title: string;
  lines?: number;
  testId?: string;
}) {
  const widths = ["72%", "46%", "64%", "38%"];
  return (
    <div
      className="rpt-ledger rpt-skel"
      aria-hidden="true"
      data-testid={testId}
    >
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">{title}</span>
      </div>
      <div className="rpt-skel-rows">
        {Array.from({ length: lines }, (_, i) => (
          <SkelBar key={i} w={widths[i % widths.length]!} />
        ))}
      </div>
    </div>
  );
}

/** Death-recap slot: the real empty frame, without its hint. */
export function SkelRecap() {
  return (
    <div className="rpt-recap-col" aria-hidden="true">
      <div className="rpt-recap-placeholder rpt-skel rpt-skel-recap">
        <SkelBar w={160} />
      </div>
    </div>
  );
}

/** Team sizes for the leaderboard placeholder: the row's rosters when it has
 * them, else the bracket ("2v2"), else 3v3 (solo shuffle). */
export function skeletonTeamSizes(
  teams: ReadonlyArray<ReadonlyArray<unknown>> | undefined,
  bracket: string,
): number[] {
  if (teams && teams.length === 2 && teams.every((t) => t.length > 0))
    return teams.map((t) => t.length);
  const m = /(\d)v(\d)/i.exec(bracket);
  return m ? [Number(m[1]), Number(m[2])] : [3, 3];
}

/** The whole report-view body as placeholders, in the real grid. */
export function ReportBodySkeleton({
  teamSizes,
}: {
  teamSizes: readonly number[];
}) {
  return (
    <div className="rpt-body" data-testid="rpt-body-skeleton">
      <SkelKpiRow />
      <div className="rpt-report-grid">
        <div className="rpt-col-main">
          <div>
            <SkelToolbar />
            <SkelChart />
            <SkelWindows />
          </div>
          <div className="rpt-body-cols">
            <SkelMeters teamSizes={teamSizes} />
            <SkelEngage />
          </div>
          <SkelLedger title="爆发账本" lines={3} />
        </div>
        <div className="rpt-col-side">
          <div className="rpt-mode-seg rpt-side-seg rpt-skel-seg">
            <span className="active">回顾</span>
            <span>问教练</span>
          </div>
          {/* No mistake-list placeholder under the recap: the recap's height
              is not known until its derive has run, and nothing is drawn
              below a box that will still grow. */}
          <div className="rpt-side-pane">
            <SkelRecap />
          </div>
        </div>
      </div>
    </div>
  );
}

const TAB_LABELS = ["战报", "回放", "事件", "AI 分析"];

/**
 * The report shell: what the page shows from the click until the match is in.
 * Everything in it is a fact the list row already had. Deliberately not
 * `.rpt-match`: tests and probes wait on that class for "the report is up",
 * and a frame with disabled tabs is not it.
 */
export function ReportShell({
  facts,
  roundLabel,
  ratingDelta = null,
  teamSizes,
  status = "读取对局…",
  children,
}: {
  facts: ReportHeaderFacts;
  roundLabel?: string;
  ratingDelta?: number | null;
  teamSizes: readonly number[];
  status?: string;
  /** Rendered above the shell (the shuffle's pill strip). */
  children?: ReactNode;
}) {
  return (
    <>
      {children}
      <div
        className="rpt-shell"
        data-fill="shell"
        data-testid="rpt-shell"
        aria-busy="true"
      >
        <div className="rpt-head-row rpt-head-row-busy">
          <div className="rpt-view-tabs rpt-head-tabs">
            {TAB_LABELS.map((t, i) => (
              <button key={t} className={i === 0 ? "active" : ""} disabled>
                {t}
              </button>
            ))}
          </div>
          <FillStatus label={status} />
        </div>
        <ReportHeader
          source={facts}
          roundLabel={roundLabel}
          ratingDelta={ratingDelta}
        />
        <SkelArcLine />
        <ReportBodySkeleton teamSizes={teamSizes} />
      </div>
    </>
  );
}
