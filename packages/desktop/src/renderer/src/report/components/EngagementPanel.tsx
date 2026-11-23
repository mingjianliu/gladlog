import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

import { useT } from "../../i18n/LangProvider";
import type { AuraUptime } from "../derive/auraUptime";
import type { CastControlSummary } from "../derive/castControl";
import type { CcBreakDash, CcBreakRow } from "../derive/ccBreakDash";
import type { CCChainRow } from "../derive/ccChainDash";
import type { DispelDash } from "../derive/dispelDash";
import type { KickDashRow } from "../derive/kickDash";
import type { TimeRange } from "../derive/timeRange";
import { AuraUptimeCard } from "./AuraUptimeCard";
import { CCChainPanel } from "./CCChainPanel";
import { DispelDashboard } from "./DispelDashboard";
import { KickDashboard } from "./KickDashboard";

type Tab = "kick" | "dispel" | "aura" | "cc" | "break";

/** "Label N" when the count is positive, else the bare label. */
const withCount = (label: string, n: number): string =>
  n > 0 ? `${label} ${n}` : label;

/** CC-break row list (shared by self-inflicted and enemy-mistake sections; same
 * row shape as DispelDashboard.InstanceList). */
function CcBreakList({
  items,
  onSeek,
}: {
  items: CcBreakRow[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const { t } = useT();
  return (
    <div className="rpt-stats-detail-group">
      {items.map((i, k) => (
        <span key={k} className="rpt-stats-detail-item">
          <span className="rpt-stats-detail-t">{fmtTime(i.tS)}</span> {i.label}
          {onSeek && (
            <button
              className="rpt-stats-detail-jump"
              title={t("report.common.replayHere")}
              onClick={() => onSeek(Math.max(0, i.tS - 3), [i.unitName])}
            >
              ▶
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Engagement panel (UI redesign 1a): the four low-density cards — kick, dispel,
 * aura, CC chain — are merged into a single tabbed card, replacing the previous
 * stack where each took a full row. The content components are reused as-is
 * (judgment predicates untouched); the shell is flattened by the CSS
 * `.rpt-engage` (the nested .rpt-ledger loses its border and its own title row
 * is hidden — the tab is the title). Empty tabs share one "no records this
 * round" message instead of each card inventing its own empty-state copy.
 */
export function EngagementPanel({
  kickRows,
  castControl = null,
  dispelDash,
  auraUptime,
  ccRows,
  ccBreak,
  onSeek,
  range,
  tab: tabProp,
  onTab,
  roundish = false,
}: {
  kickRows: KickDashRow[];
  /** The recorder's own cast control (kick tab); null = unknown / not loaded. */
  castControl?: CastControlSummary | null;
  dispelDash: DispelDash;
  auraUptime: AuraUptime;
  ccRows: CCChainRow[];
  /** CC-break statistics (2026-08-02); omitted → the tab is not shown (keeps
   * old callers/tests working). */
  ccBreak?: CcBreakDash;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  range?: TimeRange | null;
  /** Controlled tab (owned by MatchReport so it survives view switches);
   * omitted → held internally (tests). */
  tab?: Tab;
  onTab?: (t: Tab) => void;
  /** Shuffle round → the empty state says "this round"; a normal match says
   * "this match" (agy review #8). */
  roundish?: boolean;
}) {
  const { t } = useT();
  const [tabLocal, setTabLocal] = useState<Tab>("kick");
  const tab = tabProp ?? tabLocal;
  const setTab = onTab ?? setTabLocal;

  const kickN = kickRows.reduce((a, r) => a + r.total, 0);
  // Deliberate friendly dispels — same number as the KPI chip, one source.
  const dispelN = dispelDash.totals.friendlyDeliberate;
  const dispelHasAnything =
    dispelDash.rows.length +
      dispelDash.missedPurges.length +
      dispelDash.missedCleanses.length >
    0;
  const ccN = ccRows.length;
  const breakN = ccBreak ? ccBreak.friendly.length + ccBreak.enemy.length : 0;
  const breakHasAnything = !!ccBreak && breakN + ccBreak.rootBreakCount > 0;

  const TABS: { key: Tab; label: string }[] = [
    { key: "kick", label: withCount(t("report.engage.tab.kick"), kickN) },
    {
      key: "dispel",
      label: withCount(t("report.engage.tab.dispel"), dispelN),
    },
    { key: "aura", label: t("report.engage.tab.aura") },
    { key: "cc", label: withCount(t("report.engage.tab.cc"), ccN) },
    ...(ccBreak
      ? [
          {
            key: "break" as Tab,
            label: withCount(t("report.engage.tab.break"), breakN),
          },
        ]
      : []),
  ];

  const empty = (
    <p className="rpt-engage-empty">
      {t(
        roundish
          ? "report.common.thisRoundNoRecords"
          : "report.common.thisMatchNoRecords",
      )}
    </p>
  );

  return (
    <div className="rpt-engage" data-testid="engagement-panel">
      {/* Plain buttons, same as Meters' mode segmented control — deliberately
          no ARIA tab roles: ShuffleReport's round pills are the page's only
          tablist, so don't pollute getAllByRole counts */}
      <div className="rpt-mode-seg rpt-engage-tabs">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            data-testid={`engage-tab-${tb.key}`}
            className={tab === tb.key ? "active" : ""}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div className="rpt-engage-body">
        {tab === "kick" &&
          (kickRows.length > 0 || castControl ? (
            <KickDashboard
              rows={kickRows}
              castControl={castControl}
              onSeek={onSeek}
            />
          ) : (
            empty
          ))}
        {tab === "dispel" &&
          (dispelHasAnything ? (
            <DispelDashboard dash={dispelDash} onSeek={onSeek} />
          ) : (
            empty
          ))}
        {tab === "aura" &&
          (auraUptime.groups.length > 0 ? (
            <AuraUptimeCard data={auraUptime} range={range} />
          ) : (
            empty
          ))}
        {tab === "cc" &&
          (ccRows.length > 0 ? (
            <CCChainPanel rows={ccRows} onSeek={onSeek} />
          ) : (
            empty
          ))}
        {tab === "break" &&
          ccBreak &&
          (breakHasAnything ? (
            <div data-testid="ccbreak-panel">
              {ccBreak.friendly.length > 0 && (
                <>
                  <p className="rpt-ccbreak-head rpt-ccbreak-bad">
                    {t("report.engage.friendlyBreaks", {
                      n: ccBreak.friendly.length,
                    })}
                  </p>
                  <CcBreakList items={ccBreak.friendly} onSeek={onSeek} />
                </>
              )}
              {ccBreak.enemy.length > 0 && (
                <>
                  <p className="rpt-ccbreak-head rpt-ccbreak-good">
                    {t("report.engage.enemyBreaks", {
                      n: ccBreak.enemy.length,
                    })}
                  </p>
                  <CcBreakList items={ccBreak.enemy} onSeek={onSeek} />
                </>
              )}
              {ccBreak.rootBreakCount > 0 && (
                <p className="rpt-ccbreak-foot">
                  {t("report.engage.rootBreaks", {
                    n: ccBreak.rootBreakCount,
                  })}
                </p>
              )}
            </div>
          ) : (
            empty
          ))}
      </div>
    </div>
  );
}
