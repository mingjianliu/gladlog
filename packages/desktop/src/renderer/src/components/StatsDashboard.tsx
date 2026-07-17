import { useEffect, useMemo, useState } from "react";
import { zoneMetadata } from "@gladlog/analysis";

import type { StoredMatchMeta } from "../../../main/matchStore";
import { bridge } from "../bridge";
import { specName } from "../report/data/gameConstants";
import { SpecDot } from "./MatchListRow";
import {
  type DashPeriod,
  deriveDashboard,
  listCharacters,
  periodStart,
} from "./dashboard";

const PERIOD_LABEL: Record<DashPeriod, string> = {
  today: "今天",
  week: "7 天",
  all: "全部",
};

const SERIES_COLORS = ["#d9a842", "#60a5fa", "#34d399", "#f472b6"];

const winPct = (wins: number, games: number): string =>
  games > 0 ? `${Math.round((100 * wins) / games)}%` : "—";

const winCls = (wins: number, games: number): string =>
  games === 0 ? "" : wins * 2 >= games ? "dash-win" : "dash-loss";

function RatingCurve({
  series,
}: {
  series: ReturnType<typeof deriveDashboard>["ratingSeries"];
}) {
  const W = 760;
  const H = 160;
  const PAD = { l: 44, r: 10, t: 10, b: 16 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return <p className="dash-empty">评分数据不足(需要含评分的对局 ≥2 场)。</p>;
  }
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const r0 = Math.min(...all.map((p) => p.rating));
  const r1 = Math.max(...all.map((p) => p.rating));
  const pad = Math.max(20, (r1 - r0) * 0.1);
  const x = (t: number): number =>
    PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (r: number): number =>
    H -
    PAD.b -
    ((r - (r0 - pad)) / (r1 + pad - (r0 - pad))) * (H - PAD.t - PAD.b);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="dash-curve"
      data-testid="dash-curve"
    >
      {[r0, r1].map((r) => (
        <g key={r}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(r)}
            y2={y(r)}
            className="rpt-tl-grid"
          />
          <text x={4} y={y(r) + 4} className="rpt-tl-axis">
            {Math.round(r)}
          </text>
        </g>
      ))}
      {series.map((s, i) => (
        <g key={s.bracket}>
          <path
            fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={1.6}
            d={s.points
              .map(
                (p, j) =>
                  `${j === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.rating).toFixed(1)}`,
              )
              .join(" ")}
          />
          {s.points.map((p, j) => (
            <circle
              key={j}
              cx={x(p.t)}
              cy={y(p.rating)}
              r={2}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            >
              <title>{`${s.bracket} · ${Math.round(p.rating)} · ${new Date(p.t).toLocaleString()}`}</title>
            </circle>
          ))}
          <text
            x={x(s.points[s.points.length - 1]!.t) + 4}
            y={y(s.points[s.points.length - 1]!.rating)}
            className="dash-series-label"
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
          >
            {s.bracket}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * 战绩仪表盘(phase3 #1):全量 meta 索引聚合 —— 总览、评分曲线(按 bracket)、
 * 敌方 comp 胜率、地图胜率。comp 行点击 → 回对局列表预置该 spec 筛选。
 */
interface CategoryAgg {
  category: string;
  count: number;
  recurring: number;
  done: number;
  recent: Array<{ matchId: string; title: string; severity: string }>;
}

export function StatsDashboard({
  onCompClick,
  onOpenMatch,
}: {
  /** comp 行点击:带该 comp 首个 specId 回列表筛选。 */
  onCompClick?: (specId: number) => void;
  /** 「最常犯的问题」最近实例点击 → 打开该场。 */
  onOpenMatch?: (matchId: string) => void;
}) {
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [period, setPeriod] = useState<DashPeriod>("week");
  // 角色筛选(多角色玩家的战绩区分;undefined = 全部)
  const [character, setCharacter] = useState<string | undefined>(undefined);
  const [issues, setIssues] = useState<CategoryAgg[]>([]);

  useEffect(() => {
    void bridge()
      .matches.list()
      .then((all) => setMetas(all));
    try {
      void bridge()
        .analysis.aggregate()
        .then(setIssues)
        .catch(() => setIssues([]));
    } catch {
      setIssues([]);
    }
  }, []);

  const characters = useMemo(() => listCharacters(metas), [metas]);
  const dash = useMemo(
    () => deriveDashboard(metas, period, Date.now(), character),
    [metas, period, character],
  );

  return (
    <div className="dash" data-testid="stats-dashboard">
      <div className="dash-head">
        <span className="rpt-card-label">战绩</span>
        <div className="rpt-mode-seg">
          {(Object.keys(PERIOD_LABEL) as DashPeriod[]).map((p) => (
            <button
              key={p}
              className={p === period ? "active" : ""}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {characters.length >= 2 && (
        <div className="dash-chars" data-testid="dash-chars">
          <button
            className={character === undefined ? "active" : ""}
            onClick={() => setCharacter(undefined)}
          >
            全部角色
          </button>
          {characters.map((c) => (
            <button
              key={c.name}
              className={c.name === character ? "active" : ""}
              onClick={() => setCharacter(c.name)}
              title={`${c.games} 场`}
            >
              {c.name.split("-")[0]}
              <span className="dash-chars-n">{c.games}</span>
            </button>
          ))}
        </div>
      )}

      <div className="dash-overview">
        <div className="dash-stat">
          <span className="dash-stat-v">{dash.games}</span>
          <span className="dash-stat-k">场次</span>
        </div>
        <div className="dash-stat">
          <span className={`dash-stat-v ${winCls(dash.wins, dash.games)}`}>
            {winPct(dash.wins, dash.games)}
          </span>
          <span className="dash-stat-k">胜率</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-v">
            {dash.medianDurationS != null
              ? `${Math.floor(dash.medianDurationS / 60)}:${String(
                  Math.floor(dash.medianDurationS % 60),
                ).padStart(2, "0")}`
              : "—"}
          </span>
          <span className="dash-stat-k">时长中位</span>
        </div>
      </div>

      <div className="dash-card">
        <span className="rpt-card-label">
          评分曲线({character ? `${character.split("-")[0]} 本人` : "本人评分,旧数据回退队均"})
        </span>
        <RatingCurve series={dash.ratingSeries} />
      </div>

      {issues.length > 0 && (
        <div className="dash-card" data-testid="dash-issues">
          <span className="rpt-card-label">
            最常犯的问题(全部已分析对局)
          </span>
          {issues.slice(0, 3).map((c) => (
            <div key={c.category} className="dash-issue">
              <span className="dash-issue-head">
                <b>{c.category}</b> × {c.count}
                {c.recurring > 0 && (
                  <span className="dash-issue-rec">↻ 还在犯 {c.recurring}</span>
                )}
                {c.done > 0 && (
                  <span className="dash-issue-done">✓ 已跟进 {c.done}</span>
                )}
              </span>
              {c.recent[0] && (
                <button
                  className="dash-issue-recent"
                  onClick={
                    onOpenMatch
                      ? () => onOpenMatch(c.recent[0]!.matchId)
                      : undefined
                  }
                  title="打开该场"
                >
                  最近:{c.recent[0].title}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="dash-tables">
        <div className="dash-card">
          <span className="rpt-card-label">
            对阵敌方阵容
            {dash.legacyRows > 0 && (
              <span className="dash-note">
                (另有 {dash.legacyRows} 场旧数据无阵容 ——
                开发者视图可重建索引回填)
              </span>
            )}
          </span>
          <table className="rpt-stats">
            <tbody>
              {dash.comps.slice(0, 12).map((c) => (
                <tr
                  key={c.specIds.join("+")}
                  className={onCompClick ? "rpt-stats-expandable" : ""}
                  onClick={
                    onCompClick && c.specIds.length > 0
                      ? () => onCompClick(c.specIds[0]!)
                      : undefined
                  }
                  title={c.specIds.map((id) => specName(id)).join(" + ")}
                >
                  <td>
                    {c.specIds.map((id, i) => (
                      <SpecDot key={i} specId={id} classId={0} />
                    ))}
                  </td>
                  <td>{c.games} 场</td>
                  <td className={winCls(c.wins, c.games)}>
                    {winPct(c.wins, c.games)}
                  </td>
                </tr>
              ))}
              {dash.comps.length === 0 && (
                <tr>
                  <td className="dash-empty">无阵容数据。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="dash-card">
          <span className="rpt-card-label">分地图</span>
          <table className="rpt-stats">
            <tbody>
              {dash.zones.slice(0, 12).map((z) => (
                <tr key={z.zoneId}>
                  <td>{zoneMetadata[z.zoneId]?.name ?? `zone ${z.zoneId}`}</td>
                  <td>{z.games} 场</td>
                  <td className={winCls(z.wins, z.games)}>
                    {winPct(z.wins, z.games)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export { periodStart };
