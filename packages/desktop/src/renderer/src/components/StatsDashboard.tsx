import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime, zoneMetadata } from "@gladlog/analysis";
import { interpolate } from "@gladlog/analysis/src/compare/claimChecker";
import { distillFacts } from "@gladlog/analysis/src/learning/distillRules";
import { habitBadgeText } from "@gladlog/analysis/src/learning/matchRules";
import {
  PATTERN_WINDOW_MATCHES,
  PATTERN_MIN_HITS,
  TREND_BUCKET_MATCHES,
} from "@gladlog/analysis/src/learning/patternScan";
import type {
  LearnedRule,
  RulesDoc,
} from "@gladlog/analysis/src/learning/types";

import type { StoredMatchMeta } from "../../../main/matchStore";
import type { LearningState } from "../../../main/learning";
import { bridge } from "../bridge";
import { specName } from "../report/data/gameConstants";
import { categoryLabel } from "../report/derive/findingDisplay";
import { MatchListRow, SpecDot } from "./MatchListRow";
import {
  type DashPeriod,
  deriveCurrentRating,
  deriveDashboard,
  deriveRatingDeltas,
  listCharacters,
  periodStart,
  RATE_MIN_N_ROW,
  RATE_MIN_N_TOTAL,
  rateDisplay,
} from "./dashboard";
import { shortUnitName } from "../report/derive/teamSide";

const PERIOD_LABEL: Record<DashPeriod, string> = {
  today: "今天",
  week: "7 天",
  all: "全部",
};

const SERIES_COLORS = ["#d9a842", "#60a5fa", "#34d399", "#f472b6"];

/** Series colors (1h): 3v3 = accent, Solo Shuffle = win, everything else falls
 * through to the old palette. */
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

/** Single-pass [min, max]. `Math.min(...values)` pushes every element onto the
 * call stack and overflows on a long rating history; this walks the array
 * instead. Empty input yields [Infinity, -Infinity], the same as the spread
 * form (callers guard on length anyway). */
const minMax = (values: number[]): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
};

/** Win-rate bar color bands (shared by the comp and per-zone cards):
 * >=55 green, <=45 red, grey in between. */
const rateBarColor = (pct: number): string =>
  pct >= 55 ? "var(--win)" : pct <= 45 ? "var(--loss)" : "#9397ab";

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
  const [t0, t1] = minMax(all.map((p) => p.t));
  const [r0, r1] = minMax(all.map((p) => p.rating));
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
      {/* Three y-axis levels + x-axis date ticks (1h) */}
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
            {/* Endpoint dot + current-rating label */}
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

/** 44px rating sparkline (1e): lives in the KPI tower's "current rating" card
 * and opens the full RatingCurve on click.
 * The curve svg is stretched with preserveAspectRatio=none (pure trend
 * indication), so the first/last value labels (spec 3.5-4②) are absolutely
 * positioned in the HTML layer — inside an svg <text> they would be distorted
 * along with it. */
function RatingSparkline({
  points,
  color,
}: {
  points: { t: number; rating: number }[];
  color: string;
}) {
  if (points.length < 2) return null;
  const W = 240;
  const H = 44;
  const P = 3;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const [r0, r1] = minMax(points.map((p) => p.rating));
  const x = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (r: number) =>
    H - P - ((r - r0) / Math.max(1, r1 - r0)) * (H - 2 * P);
  // Label vertical position tracks its endpoint's y (as a percentage), clamped
  // to [14%, 86%] so it cannot escape the box
  const topPct = (r: number) =>
    Math.min(86, Math.max(14, (y(r) / H) * 100)).toFixed(0);
  const first = points[0]!.rating;
  const lastR = points[points.length - 1]!.rating;
  return (
    <span className="dash-spark-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="dash-spark"
        data-testid="dash-sparkline"
        aria-hidden="true"
      >
        <path
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          d={points
            .map(
              (pt, i) =>
                `${i === 0 ? "M" : "L"}${x(pt.t).toFixed(1)},${y(pt.rating).toFixed(1)}`,
            )
            .join(" ")}
        />
        <circle
          cx={x(t1)}
          cy={y(points[points.length - 1]!.rating)}
          r={2.5}
          fill={color}
        />
      </svg>
      <span
        className="dash-spark-lab"
        style={{ left: 2, top: `${topPct(first)}%` }}
      >
        {Math.round(first)}
      </span>
      <span
        className="dash-spark-lab"
        style={{ right: 2, top: `${topPct(lastR)}%`, color }}
      >
        {Math.round(lastR)}
      </span>
    </span>
  );
}

/**
 * Record dashboard (phase3 #1 → 1e redesign): two columns, KPI tower on the
 * left (270px) and coaching cards on the right. The full-width rating-curve
 * card is gone; the curve now lives in a modal opened from the "current rating"
 * sparkline. The mistakes notebook and long-term patterns are merged into a
 * single "what to practise this week" card. Clicking a comp row returns to the
 * match list with that spec's filter preset.
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
  onZoneClick,
  onOpenMatch,
}: {
  /** Comp row click: return to the list filtered by that comp's first specId. */
  onCompClick?: (specId: number) => void;
  /** Per-zone row click: return to the list filtered by that zoneId (spec 2-3). */
  onZoneClick?: (zoneId: string) => void;
  /** Clicking a recent instance under "most frequent mistakes" opens that match. */
  onOpenMatch?: (matchId: string) => void;
}) {
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [period, setPeriod] = useState<DashPeriod>("week");
  // Character filter (separates records for multi-character players;
  // undefined = all)
  const [character, setCharacter] = useState<string | undefined>(undefined);
  const [notebook, setNotebook] = useState<NotebookGroup[]>([]);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [rulesDoc, setRulesDoc] = useState<RulesDoc | null>(null);
  const [learnState, setLearnState] = useState<LearningState | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [learnError, setLearnError] = useState<string | null>(null);
  // Full rating-curve modal (1e): opened from the sparkline
  const [curveOpen, setCurveOpen] = useState(false);
  // Index rebuild (round 2, P0): the empty-comp state and legacy-row hints
  // rebuild in place instead of sending the user to the developer view.
  // Every match in the library goes through the worker, so hundreds of matches
  // take real time — there is no progress channel, only running/done states.
  // The concurrency guard lives in main (matchStore.rebuildIndex is
  // single-flight): switching pages unmounts and loses the running state here,
  // so clicking again only joins the in-flight run and never starts a second
  // loop.
  const [rebuild, setRebuild] = useState<{
    running: boolean;
    msg: string | null;
  }>({ running: false, msg: null });
  // Unmount guard: a rebuild takes minutes, so the component may be long gone
  // by the time it resolves (agy review #1)
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const runRebuild = () => {
    if (rebuild.running) return;
    setRebuild({ running: true, msg: null });
    void (async () => {
      try {
        const r = await bridge().matches.rebuildIndex();
        // A rebuild rewrites metaExtras/roundStats: refetch the list right
        // away so the comp/win-rate cards refresh in place
        const all = await bridge().matches.list();
        if (!aliveRef.current) return;
        setMetas(all);
        setRebuild({
          running: false,
          msg: `已重建:更新 ${r.updated} 场${r.failed > 0 ? `,失败 ${r.failed}` : ""}`,
        });
      } catch {
        if (aliveRef.current)
          setRebuild({ running: false, msg: "重建失败 —— 可在开发者视图重试" });
      }
    })();
  };
  const reloadLearning = () => {
    try {
      const api = (
        bridge() as unknown as {
          learning?: {
            getRules(): Promise<RulesDoc | null>;
            getState(): Promise<LearningState>;
          };
        }
      ).learning;
      if (!api) return;
      void api
        .getRules()
        .then(setRulesDoc)
        .catch(() => {});
      void api
        .getState()
        .then(setLearnState)
        .catch(() => {});
    } catch {
      /* the test stub does not expose this surface */
    }
  };

  useEffect(() => {
    reloadLearning();
    try {
      const api = (
        bridge() as unknown as {
          learning?: {
            onDone(cb: (d: { distillError?: string }) => void): () => void;
            onProgress(
              cb: (p: { scanned: number; total: number }) => void,
            ): () => void;
            onError(cb: (d: { message: string }) => void): () => void;
          };
        }
      ).learning;
      if (!api) return undefined;
      const offDone = api.onDone?.((d) => {
        setDistillError(d.distillError ?? null);
        setLearnError(null);
        reloadLearning();
      });
      const offProgress = api.onProgress?.((p) => {
        setLearnState((s) =>
          s
            ? { ...s, backfill: { running: true, ...p } }
            : {
                backfill: { running: true, ...p },
                consolidating: false,
                ledgerMatches: 0,
                badLines: 0,
                lastConsolidatedAt: null,
              },
        );
      });
      const offError = api.onError?.((d) => {
        setLearnError(d.message);
      });
      return () => {
        offDone?.();
        offProgress?.();
        offError?.();
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      void bridge()
        .matches.list()
        .then((all) => setMetas(all))
        .catch(() => {});
      // Refetch the mistakes notebook too: ingestion usually comes with
      // analysis-cache changes
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
    // Records update live with ingestion (backlog #12): no longer stuck on the
    // snapshot taken at mount while the watcher backfills history or ingests in
    // real time. Debounced to coalesce bulk ingestion (a history import floods
    // in hundreds of matches at once).
    let timer: ReturnType<typeof setTimeout> | null = null;
    let un: (() => void) | undefined;
    try {
      un = bridge().logs.onMatchStored(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, 500);
      });
    } catch {
      /* the test stub has no logs surface */
    }
    return () => {
      if (timer) clearTimeout(timer);
      un?.();
    };
  }, []);

  const flagEntry = (e: NotebookEntry, flag: "done" | "recurring") => {
    const next = e.flag === flag ? null : flag;
    // Match on the stable key (matchId+flagKey = the backend setFlag key
    // semantics): reference equality breaks after a refresh or a double click
    // while the IPC is pending, decoupling the UI from persisted state
    // (agy review #1)
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
      /* the test stub does not expose this surface */
    }
  };

  const characters = useMemo(() => listCharacters(metas), [metas]);
  // Rating deltas on the recent-matches card: the same algorithm as the App's
  // match list (single-sourced in dashboard.ts)
  const ratingDeltas = useMemo(() => deriveRatingDeltas(metas), [metas]);
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
      {/* Title row (1h): record + character chips + period control on the right */}
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
                {shortUnitName(c.name)}
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

      {/* 1e two columns: KPI tower (270px) on the left + coaching card column
          on the right; the full-width curve card is gone */}
      <div className="dash-grid">
        <div className="dash-kpi-col" data-testid="dash-band">
          <div className="dash-kpi-card">
            <span className="dash-kpi-v">{dash.games}</span>
            <span className="dash-kpi-k">场次</span>
          </div>
          {(() => {
            // Small-N honesty (UI review #8): below RATE_MIN_N_TOTAL the
            // counts are the big numeral and the percentage is demoted.
            const r = rateDisplay(
              dash.rateWins,
              dash.rateGames,
              RATE_MIN_N_TOTAL,
            );
            return (
              <div className="dash-kpi-card" data-testid="dash-kpi-rate">
                <span
                  className="dash-kpi-v"
                  style={
                    !r.belowFloor &&
                    dash.rateGames > 0 &&
                    dash.rateWins * 2 >= dash.rateGames
                      ? { color: "#a8e6c4" }
                      : undefined
                  }
                >
                  {r.primary}
                </span>
                <span className="dash-kpi-k">
                  胜率{r.secondary ? ` · ${r.secondary}` : ""}
                  {dash.rateGames !== dash.games ? "(按回合)" : ""}
                  {r.belowFloor && dash.rateGames > 0
                    ? ` · 样本 <${RATE_MIN_N_TOTAL}`
                    : ""}
                </span>
              </div>
            );
          })()}
          <div className="dash-kpi-card">
            <span className="dash-kpi-v">
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
            <span className="dash-kpi-k">
              当前评分{cur ? `(${cur.bracket})` : ""}
            </span>
            {cur &&
              (() => {
                const idx = dash.ratingSeries.findIndex(
                  (sr) => sr.bracket === cur.bracket,
                );
                const pts = idx >= 0 ? dash.ratingSeries[idx]!.points : [];
                return pts.length >= 2 ? (
                  <button
                    type="button"
                    className="dash-spark-btn"
                    title="点开评分曲线大图"
                    aria-label="展开评分曲线大图"
                    onClick={() => setCurveOpen(true)}
                  >
                    <RatingSparkline
                      points={pts}
                      color={seriesColor(cur.bracket, Math.max(0, idx))}
                    />
                  </button>
                ) : null;
              })()}
          </div>
          <div className="dash-kpi-card">
            <span className="dash-kpi-v">
              {dash.medianDurationS != null
                ? fmtTime(dash.medianDurationS)
                : "—"}
            </span>
            <span className="dash-kpi-k">时长中位</span>
          </div>
        </div>
        <div className="dash-main-col">
          {(notebook.length > 0 || rulesDoc || learnState) && (
            <div className="dash-card" data-testid="dash-practice">
              <span className="dash-card-head">
                <span className="rpt-card-label">
                  这周该练什么 —— 错题本 + 长期规律(1e 合卡)
                </span>
                {(rulesDoc || learnState) && (
                  <>
                    <button
                      className="dash-learning-run"
                      disabled={learnState?.consolidating}
                      onClick={() => {
                        try {
                          void (
                            bridge() as unknown as {
                              learning?: { consolidate(): Promise<void> };
                            }
                          ).learning?.consolidate();
                        } catch {
                          /* noop */
                        }
                      }}
                    >
                      {learnState?.consolidating ? "整合中…" : "重新整合"}
                    </button>
                  </>
                )}
              </span>
              {/* "Sorted by impact": the two sources share no common unit
              (notebook = frequency, patterns = trend state), so the ordering is
              structural — cross-match stable patterns first (high impact),
              notebook entries by frequency behind them; no synthetic score is
              invented. */}
              {(rulesDoc || learnState) && (
                <div data-testid="dash-learning">
                  <p className="dash-learning-meta">
                    {learnState?.backfill?.running
                      ? `回填历史分析中… ${learnState.backfill.scanned}/${learnState.backfill.total}`
                      : `台账 ${learnState?.ledgerMatches ?? 0} 场` +
                        (learnState?.lastConsolidatedAt
                          ? ` · 上次整合 ${new Date(learnState.lastConsolidatedAt).toLocaleString()}`
                          : " · 尚未整合")}
                    {learnState && learnState.badLines > 0
                      ? ` · ${learnState.badLines} 坏行已跳过`
                      : ""}
                    {distillError
                      ? ` · AI 提炼失败(仅缺文本):${distillError}`
                      : ""}
                    {learnError ? ` · 整合失败:${learnError}` : ""}
                  </p>
                  {(rulesDoc?.rules ?? []).map((r: LearnedRule) => {
                    const facts = distillFacts(r.stats);
                    const desc = r.description.zh ?? r.description.en;
                    const adv = r.advice.zh ?? r.advice.en;
                    const max = Math.max(1, ...r.stats.trend);
                    return (
                      <div key={r.ruleId} className="dash-learning-rule">
                        <span
                          className={`dash-learning-status ${r.status}`}
                          title={
                            r.status === "improved"
                              ? "近期已明显减少 —— 进步证据,继续保持"
                              : "仍在活跃发生"
                          }
                        >
                          {r.status === "improved" ? "已改进" : "活跃"}
                        </span>
                        <span className="dash-learning-cat">
                          {categoryLabel(r.category, "zh")}
                          {r.eventTypes.length > 0
                            ? ` · ${r.eventTypes.join("+")}`
                            : ""}
                          {r.condition?.enemySpec
                            ? `(对位 spec ${r.condition.enemySpec})`
                            : r.condition?.zoneId
                              ? `(地图 ${r.condition.zoneId})`
                              : ""}
                        </span>
                        <span className="dash-learning-count">
                          {habitBadgeText(r, "zh")}
                        </span>
                        <span
                          className="dash-learning-trend"
                          title={`每 ${TREND_BUCKET_MATCHES} 场命中数,旧→新`}
                        >
                          {r.stats.trend.map((h, i) => (
                            <i
                              key={i}
                              style={{ height: `${4 + (h / max) * 12}px` }}
                              className={h > 0 ? "hit" : ""}
                            />
                          ))}
                        </span>
                        <p className="dash-learning-desc">
                          {desc
                            ? interpolate(desc, facts)
                            : "(描述待下次整合生成)"}
                        </p>
                        {adv && (
                          <p className="dash-learning-advice">
                            💡 {interpolate(adv, facts)}
                          </p>
                        )}
                        <span className="dash-learning-evidence">
                          {r.evidence.map((id) => (
                            <button key={id} onClick={() => onOpenMatch?.(id)}>
                              查看战例
                            </button>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                  {(rulesDoc?.rules ?? []).length === 0 &&
                    !learnState?.backfill?.running && (
                      <p className="dash-learning-empty">
                        还没有稳定模式 —— 分析的对局多了(同类问题近{" "}
                        {PATTERN_WINDOW_MATCHES} 场出现 {PATTERN_MIN_HITS}{" "}
                        次以上)会自动出现在这里。
                      </p>
                    )}
                </div>
              )}
              {notebook.length > 0 && (
                <div data-testid="dash-notebook">
                  {notebook.map((g) => {
                    const open = !!openCats[g.category];
                    return (
                      <div key={g.category} className="dash-nb-group">
                        <button
                          className="dash-nb-head"
                          onClick={() =>
                            setOpenCats((o) => ({
                              ...o,
                              [g.category]: !o[g.category],
                            }))
                          }
                        >
                          <span className="dash-nb-caret">
                            {open ? "▼" : "▸"}
                          </span>
                          {/* Display goes through the Chinese vocabulary
                              (enum slugs and legacy free-form words are both
                              normalized); the aggregation key is untouched */}
                          <span className="dash-nb-cat">
                            {categoryLabel(g.category, "zh")}
                          </span>
                          <span className="dash-nb-count">×{g.count}</span>
                          {g.recurring > 0 && (
                            <span className="dash-issue-rec">
                              ↻ {g.recurring}
                            </span>
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
                                  ? (zoneMetadata[e.zoneId]?.name ??
                                    e.bracket ??
                                    "")
                                  : (e.bracket ?? "")}
                                {e.result
                                  ? ` · ${e.result.toLowerCase() === "win" ? "胜" : "负"}`
                                  : ""}
                              </span>
                              <span
                                className={`dash-nb-sev rpt-finding-${e.severity}`}
                              >
                                <span className="rpt-finding-sev">
                                  {e.severity}
                                </span>
                              </span>
                              <span
                                className="dash-nb-title"
                                title={e.explanation}
                              >
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
                                  className={
                                    e.flag === "recurring" ? "active rec" : ""
                                  }
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
            </div>
          )}

          <div className="dash-tables">
            <div className="dash-card">
              <span className="rpt-card-label">对阵敌方阵容</span>
              <div className="dash-comps">
                {dash.comps.slice(0, 12).map((c) => {
                  const pct = c.games > 0 ? (100 * c.wins) / c.games : 0;
                  const r = rateDisplay(c.wins, c.games, RATE_MIN_N_ROW);
                  // Below the row floor the bar stays neutral — a 1-0 row
                  // must not read as a green 100%.
                  const barColor = r.belowFloor ? "#9397ab" : rateBarColor(pct);
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
                      <span
                        className="dash-comp-num"
                        style={{ color: barColor }}
                      >
                        {r.primary}
                        <span className="dash-comp-games"> · {c.games}场</span>
                      </span>
                    </div>
                  );
                })}
                {dash.comps.length === 0 && (
                  <div className="dash-empty">
                    {dash.games > 0 ? (
                      <>
                        无阵容数据 —— 旧对局还没建阵容索引。
                        <button
                          className="rpt-btn dash-rebuild"
                          data-testid="dash-rebuild"
                          disabled={rebuild.running}
                          onClick={runRebuild}
                        >
                          {rebuild.running
                            ? "重建中…(全库逐场解析,可能要几分钟)"
                            : "重建索引回填"}
                        </button>
                      </>
                    ) : (
                      "无阵容数据。"
                    )}
                  </div>
                )}
              </div>
              <div className="dash-comp-foot">
                {dash.comps.length > 0 && "点击行回列表筛选该阵容"}
                {dash.legacyRows > 0 && dash.comps.length > 0 && (
                  <>
                    {` · 另有 ${dash.legacyRows} 场旧数据无阵容 `}
                    <button
                      className="dash-rebuild-inline"
                      data-testid="dash-rebuild"
                      disabled={rebuild.running}
                      onClick={runRebuild}
                    >
                      {rebuild.running ? "重建中…" : "重建索引回填"}
                    </button>
                  </>
                )}
                {rebuild.msg && (
                  <span className="dash-rebuild-msg">{rebuild.msg}</span>
                )}
              </div>
            </div>

            <div className="dash-card">
              <span className="rpt-card-label">分地图</span>
              {/* Row layout (spec 2-3, decided by the user): name + win-rate
                  bar + n%·x matches; clicking returns to the list with the zone
                  filter — same row structure and color bands as the comp card */}
              <div className="dash-comps" data-testid="dash-zones">
                {dash.zones.slice(0, 12).map((z) => {
                  const pct = z.games > 0 ? (100 * z.wins) / z.games : 0;
                  const r = rateDisplay(z.wins, z.games, RATE_MIN_N_ROW);
                  const barColor = r.belowFloor ? "#9397ab" : rateBarColor(pct);
                  const name =
                    zoneMetadata[z.zoneId]?.name ?? `zone ${z.zoneId}`;
                  return (
                    <div
                      key={z.zoneId}
                      className={
                        onZoneClick ? "dash-comp dash-comp-click" : "dash-comp"
                      }
                      onClick={
                        onZoneClick ? () => onZoneClick(z.zoneId) : undefined
                      }
                      title={name}
                    >
                      <span className="dash-zone-name">{name}</span>
                      <span className="dash-comp-track">
                        <span
                          className="dash-comp-bar"
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                      </span>
                      <span
                        className="dash-comp-num"
                        style={{ color: barColor }}
                      >
                        {r.primary}
                        <span className="dash-comp-games"> · {z.games}场</span>
                      </span>
                    </div>
                  );
                })}
                {dash.zones.length === 0 && (
                  <div className="dash-empty">无地图数据。</div>
                )}
              </div>
              {dash.zones.length > 0 && onZoneClick && (
                <div className="dash-comp-foot">点击行回列表筛选该地图</div>
              )}
            </div>
          </div>

          {/* Recent matches (round 2, P0): the main filler for the big empty
              right column at 4K. Reuses the match list's rich MatchListRow;
              clicking goes straight to the report. */}
          {dash.recent.length > 0 && (
            <div className="dash-card" data-testid="dash-recent">
              <span className="rpt-card-label">最近对局</span>
              <div className="dash-recent-list">
                {/* div role=button rather than <button>: MatchListRow is a
                    block-level div and a button may only contain phrasing
                    content, so neither axe nor HTML validation would pass
                    (agy review #3) */}
                {dash.recent.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    className="dash-recent-row"
                    title="打开战报"
                    onClick={onOpenMatch ? () => onOpenMatch(m.id) : undefined}
                    onKeyDown={
                      onOpenMatch
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenMatch(m.id);
                            }
                          }
                        : undefined
                    }
                  >
                    <MatchListRow
                      meta={m}
                      ratingDelta={ratingDeltas.get(m.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full rating-curve modal (1e): opened from the sparkline; closed by
          clicking the backdrop or the ✕ */}
      {curveOpen && (
        <div
          className="dash-modal-backdrop"
          onClick={() => setCurveOpen(false)}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-label="评分曲线"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="dash-card-head">
              <span className="rpt-card-label">
                评分曲线(
                {character
                  ? `${shortUnitName(character)} 本人`
                  : "本人评分,旧数据回退队均"}
                )
              </span>
              <span className="dash-legend">
                {dash.ratingSeries.map((sr, i) => (
                  <span key={sr.bracket} className="dash-legend-item">
                    <span
                      className="dash-legend-line"
                      style={{ background: seriesColor(sr.bracket, i) }}
                    />
                    {sr.bracket}
                  </span>
                ))}
              </span>
              <button
                type="button"
                className="dash-modal-close"
                aria-label="关闭"
                onClick={() => setCurveOpen(false)}
              >
                ✕
              </button>
            </span>
            <RatingCurve series={dash.ratingSeries} />
          </div>
        </div>
      )}
    </div>
  );
}

export { periodStart };
