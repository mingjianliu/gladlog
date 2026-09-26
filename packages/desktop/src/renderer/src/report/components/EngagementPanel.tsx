import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

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


/** CC-break row list (shared by self-inflicted and enemy-mistake sections; same
 * row shape as DispelDashboard.InstanceList). */
function CcBreakList({
  items,
  onSeek,
}: {
  items: CcBreakRow[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  return (
    <div className="rpt-stats-detail-group">
      {items.map((i, k) => (
        <span key={k} className="rpt-stats-detail-item">
          <span className="rpt-stats-detail-t">{fmtTime(i.tS)}</span>{" "}
          {i.label}
          {onSeek && (
            <button
              className="rpt-stats-detail-jump"
              title="回放此刻"
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
    { key: "kick", label: kickN > 0 ? `打断 ${kickN}` : "打断" },
    { key: "dispel", label: dispelN > 0 ? `驱散 ${dispelN}` : "驱散" },
    { key: "aura", label: "光环" },
    { key: "cc", label: ccN > 0 ? `CC链 ${ccN}` : "CC链" },
    ...(ccBreak
      ? [
          {
            key: "break" as Tab,
            label: breakN > 0 ? `破控 ${breakN}` : "破控",
          },
        ]
      : []),
  ];

  const empty = (
    <p className="rpt-engage-empty">{roundish ? "本轮" : "本场"}无记录。</p>
  );

  return (
    <div className="rpt-engage" data-testid="engagement-panel">
      {/* Plain buttons, same as Meters' mode segmented control — deliberately
          no ARIA tab roles: ShuffleReport's round pills are the page's only
          tablist, so don't pollute getAllByRole counts */}
      <div className="rpt-mode-seg rpt-engage-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`engage-tab-${t.key}`}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
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
                    资敌打破 —— 己方伤害打断了挂在敌人身上的控制(
                    {ccBreak.friendly.length})
                  </p>
                  <CcBreakList items={ccBreak.friendly} onSeek={onSeek} />
                </>
              )}
              {ccBreak.enemy.length > 0 && (
                <>
                  <p className="rpt-ccbreak-head rpt-ccbreak-good">
                    敌方自误 —— 对面自己打断了给我方上的控制(
                    {ccBreak.enemy.length},正面信号)
                  </p>
                  <CcBreakList items={ccBreak.enemy} onSeek={onSeek} />
                </>
              )}
              {ccBreak.rootBreakCount > 0 && (
                <p className="rpt-ccbreak-foot">
                  另有定身(root)被打破 {ccBreak.rootBreakCount} 次 ——
                  定身常被刻意打破换位置,单列不计教学。
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
