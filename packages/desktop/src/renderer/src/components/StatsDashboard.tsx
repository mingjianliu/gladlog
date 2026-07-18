import { useEffect, useMemo, useState } from "react";
import { zoneMetadata } from "@gladlog/analysis";

import type { StoredMatchMeta } from "../../../main/matchStore";
import { bridge } from "../bridge";
import { specName } from "../report/data/gameConstants";
import { SpecDot } from "./MatchListRow";
import {
  type DashPeriod,
  deriveCurrentRating,
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

/** 系列色(1h):3v3 = accent、Solo Shuffle = win,其余顺延旧色板。 */
const seriesColor = (bracket: string, i: number): string =>
  bracket === "3v3"
    ? "var(--accent)"
    : /shuffle/i.test(bracket)
      ? "var(--win)"
      : SERIES_COLORS[i % SERIES_COLORS.length]!;

const fmtMD = (t: number): string => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

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
      {/* y 轴三档 + x 轴日期刻度(1h) */}
      {[r0, (r0 + r1) / 2, r1].map((r) => (
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
      {[t0, (t0 + t1) / 2, t1].map((t, i) => (
        <text
          key={i}
          x={x(t)}
          y={H - 2}
          className="rpt-tl-axis"
          textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
        >
          {fmtMD(t)}
        </text>
      ))}
      {series.map((s, i) => {
        const color = seriesColor(s.bracket, i);
        const last = s.points[s.points.length - 1]!;
        return (
          <g key={s.bracket}>
            <path
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              d={s.points
                .map(
                  (p, j) =>
                    `${j === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.rating).toFixed(1)}`,
                )
                .join(" ")}
            />
            {s.points.map((p, j) => (
              <circle key={j} cx={x(p.t)} cy={y(p.rating)} r={2} fill={color}>
                <title>{`${s.bracket} · ${Math.round(p.rating)} · ${new Date(p.t).toLocaleString()}`}</title>
              </circle>
            ))}
            {/* 端点圆 + 当前分标注 */}
            <circle cx={x(last.t)} cy={y(last.rating)} r={3.5} fill={color} />
            <text
              x={x(last.t) + 5}
              y={y(last.rating) + 3.5}
              className="dash-series-label"
              fill={color}
            >
              {Math.round(last.rating)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 战绩仪表盘(phase3 #1):全量 meta 索引聚合 —— 总览、评分曲线(按 bracket)、
 * 敌方 comp 胜率、地图胜率。comp 行点击 → 回对局列表预置该 spec 筛选。
 */
interface NotebookEntry {
  matchId: string;
  flagKey: string;
  flag: string | null;
  title: string;
  explanation: string;
  severity: string;
  startTime: number;
  zoneId?: string;
  result?: string;
  bracket?: string;
}
interface NotebookGroup {
  category: string;
  count: number;
  recurring: number;
  done: number;
  entries: NotebookEntry[];
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
  const [notebook, setNotebook] = useState<NotebookGroup[]>([]);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const refresh = () => {
      void bridge()
        .matches.list()
        .then((all) => setMetas(all))
        .catch(() => {});
      // 错题本一并重取:入库常伴随分析缓存变化
      try {
        void bridge()
          .analysis.notebook()
          .then(setNotebook)
          .catch(() => setNotebook([]));
      } catch {
        setNotebook([]);
      }
    };
    refresh();
    // 战绩随入库动态更新(backlog #12):watcher 补历史/实时入库时不再停留在
    // mount 时的快照。防抖合并批量入库(历史导入一次涌入几百场)。
    let timer: ReturnType<typeof setTimeout> | null = null;
    let un: (() => void) | undefined;
    try {
      un = bridge().logs.onMatchStored(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, 500);
      });
    } catch {
      /* 测试桩无 logs 面 */
    }
    return () => {
      if (timer) clearTimeout(timer);
      un?.();
    };
  }, []);

  const flagEntry = (e: NotebookEntry, flag: "done" | "recurring") => {
    const next = e.flag === flag ? null : flag;
    // 稳定键匹配(matchId+flagKey = 后端 setFlag 的键语义):引用相等会在
    // IPC 未决期间的刷新/连点后失配,UI 与落盘状态脱钩(agy 复核 #1)
    const isTarget = (x: NotebookEntry) =>
      x.matchId === e.matchId && x.flagKey === e.flagKey;
    try {
      void bridge()
        .analysis.setFlag(e.matchId, e.flagKey, next)
        .then(() =>
          setNotebook((groups) =>
            groups.map((g) => ({
              ...g,
              recurring: g.entries.filter((x) =>
                isTarget(x) ? next === "recurring" : x.flag === "recurring",
              ).length,
              done: g.entries.filter((x) =>
                isTarget(x) ? next === "done" : x.flag === "done",
              ).length,
              entries: g.entries.map((x) =>
                isTarget(x) ? { ...x, flag: next } : x,
              ),
            })),
          ),
        )
        .catch(() => {});
    } catch {
      /* 测试桩无该面 */
    }
  };

  const characters = useMemo(() => listCharacters(metas), [metas]);
  const dash = useMemo(
    () => deriveDashboard(metas, period, Date.now(), character),
    [metas, period, character],
  );
  const cur = useMemo(
    () =>
      deriveCurrentRating(metas, periodStart(period, Date.now()), character),
    [metas, period, character],
  );

  return (
    <div className="dash" data-testid="stats-dashboard">
      {/* 标题行(1h):战绩 + 角色 chips + 右端时间段控 */}
      <div className="dash-head">
        <span className="dash-title">战绩</span>
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
        <div className="rpt-mode-seg dash-period">
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

      {/* 总览数字带(1h):全页唯一饱和色块 */}
      <div className="dash-band" data-testid="dash-band">
        <div className="dash-band-cell">
          <span className="dash-band-v">{dash.games}</span>
          <span className="dash-band-k">场次</span>
        </div>
        <div className="dash-band-cell">
          <span
            className="dash-band-v"
            style={
              dash.games > 0 && dash.wins * 2 >= dash.games
                ? { color: "#a8e6c4" }
                : undefined
            }
          >
            {winPct(dash.wins, dash.games)}
            <span className="dash-band-sub">
              {" "}
              · {dash.wins}-{dash.games - dash.wins}
            </span>
          </span>
          <span className="dash-band-k">胜率</span>
        </div>
        <div className="dash-band-cell">
          <span className="dash-band-v">
            {cur ? (
              <>
                {cur.rating}
                {cur.delta != null && cur.delta !== 0 && (
                  <span className="dash-band-sub">
                    {" "}
                    {cur.delta > 0 ? "↑" : "↓"}
                    {Math.abs(cur.delta)}
                  </span>
                )}
              </>
            ) : (
              "—"
            )}
          </span>
          <span className="dash-band-k">
            当前评分{cur ? `(${cur.bracket})` : ""}
          </span>
        </div>
        <div className="dash-band-cell">
          <span className="dash-band-v">
            {dash.medianDurationS != null
              ? `${Math.floor(dash.medianDurationS / 60)}:${String(
                  Math.floor(dash.medianDurationS % 60),
                ).padStart(2, "0")}`
              : "—"}
          </span>
          <span className="dash-band-k">时长中位</span>
        </div>
      </div>

      <div className="dash-card">
        <span className="dash-card-head">
          <span className="rpt-card-label">
            评分曲线(
            {character
              ? `${character.split("-")[0]} 本人`
              : "本人评分,旧数据回退队均"}
            )
          </span>
          <span className="dash-legend">
            {dash.ratingSeries.map((s, i) => (
              <span key={s.bracket} className="dash-legend-item">
                <span
                  className="dash-legend-line"
                  style={{ background: seriesColor(s.bracket, i) }}
                />
                {s.bracket}
              </span>
            ))}
          </span>
        </span>
        <RatingCurve series={dash.ratingSeries} />
      </div>

      {notebook.length > 0 && (
        <div className="dash-card" data-testid="dash-notebook">
          <span className="rpt-card-label">
            错题本 —— 最常犯的问题(全部已分析对局)
          </span>
          {notebook.map((g) => {
            const open = !!openCats[g.category];
            return (
              <div key={g.category} className="dash-nb-group">
                <button
                  className="dash-nb-head"
                  onClick={() =>
                    setOpenCats((o) => ({ ...o, [g.category]: !o[g.category] }))
                  }
                >
                  <span className="dash-nb-caret">{open ? "▼" : "▸"}</span>
                  <span className="dash-nb-cat">{g.category}</span>
                  <span className="dash-nb-count">×{g.count}</span>
                  {g.recurring > 0 && (
                    <span className="dash-issue-rec">↻ {g.recurring}</span>
                  )}
                  {g.done > 0 && (
                    <span className="dash-issue-done">✓ {g.done}</span>
                  )}
                </button>
                {open &&
                  g.entries.map((e, i) => (
                    <div
                      key={`${e.matchId}:${e.flagKey}:${i}`}
                      className="dash-nb-entry"
                    >
                      <span className="dash-nb-when">
                        {new Date(e.startTime).getMonth() + 1}/
                        {new Date(e.startTime).getDate()}
                      </span>
                      <span className="dash-nb-meta">
                        {e.zoneId
                          ? (zoneMetadata[e.zoneId]?.name ?? e.bracket ?? "")
                          : (e.bracket ?? "")}
                        {e.result
                          ? ` · ${e.result.toLowerCase() === "win" ? "胜" : "负"}`
                          : ""}
                      </span>
                      <span
                        className={`dash-nb-sev rpt-finding-${e.severity}`}
                      >
                        <span className="rpt-finding-sev">{e.severity}</span>
                      </span>
                      <span className="dash-nb-title" title={e.explanation}>
                        {e.title}
                      </span>
                      <span className="dash-nb-actions">
                        <button
                          className={e.flag === "done" ? "active" : ""}
                          title="标记为已改进"
                          onClick={() => flagEntry(e, "done")}
                        >
                          ✓
                        </button>
                        <button
                          className={e.flag === "recurring" ? "active rec" : ""}
                          title="标记为还在犯"
                          onClick={() => flagEntry(e, "recurring")}
                        >
                          ↻
                        </button>
                        {onOpenMatch && (
                          <button
                            className="dash-issue-recent"
                            onClick={() => onOpenMatch(e.matchId)}
                          >
                            打开该场 →
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="dash-tables">
        <div className="dash-card">
          <span className="rpt-card-label">对阵敌方阵容</span>
          <div className="dash-comps">
            {dash.comps.slice(0, 12).map((c) => {
              const pct = c.games > 0 ? (100 * c.wins) / c.games : 0;
              const barColor =
                pct >= 55
                  ? "var(--win)"
                  : pct <= 45
                    ? "var(--loss)"
                    : "#9397ab";
              return (
                <div
                  key={c.specIds.join("+")}
                  className={
                    onCompClick ? "dash-comp dash-comp-click" : "dash-comp"
                  }
                  onClick={
                    onCompClick && c.specIds.length > 0
                      ? () => onCompClick(c.specIds[0]!)
                      : undefined
                  }
                  title={c.specIds.map((id) => specName(id)).join(" + ")}
                >
                  <span className="dash-comp-specs">
                    {c.specIds.map((id, i) => (
                      <SpecDot key={i} specId={id} classId={0} />
                    ))}
                  </span>
                  <span className="dash-comp-track">
                    <span
                      className="dash-comp-bar"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </span>
                  <span className="dash-comp-num" style={{ color: barColor }}>
                    {winPct(c.wins, c.games)}
                    <span className="dash-comp-games"> · {c.games}场</span>
                  </span>
                </div>
              );
            })}
            {dash.comps.length === 0 && (
              <div className="dash-empty">无阵容数据。</div>
            )}
          </div>
          <div className="dash-comp-foot">
            点击行回列表筛选该阵容
            {dash.legacyRows > 0 &&
              ` · 另有 ${dash.legacyRows} 场旧数据无阵容(开发者视图可重建索引回填)`}
          </div>
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
