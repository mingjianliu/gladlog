import { useEffect, useMemo, useState } from "react";
import { DevPanel } from "./components/DevPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsDashboard } from "./components/StatsDashboard";
import { ImportButton } from "./components/ImportButton";
import { MatchListRow } from "./components/MatchListRow";
import {
  applyFilter,
  EMPTY_FILTER,
  MatchListFilter,
  type ListFilter,
} from "./components/MatchListFilter";
import { MatchReport } from "./report/components/MatchReport";
import { ShuffleReport } from "./report/components/ShuffleReport";
import type { StoredMatchMeta } from "../../main/matchStore";
import { bridge } from "./bridge";

type AppView = "matches" | "stats" | "settings" | "dev";
const APP_VIEW_LABEL: Record<AppView, string> = {
  matches: "对局",
  stats: "战绩",
  settings: "设置",
  dev: "开发者",
};

export default function App({
  initialAppView = "matches",
}: {
  initialAppView?: AppView;
} = {}) {
  const [appView, setAppView] = useState<AppView>(initialAppView);
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<ListFilter>(EMPTY_FILTER);
  const [wowDir, setWowDir] = useState<string | null>(null);

  useEffect(() => {
    // 测试桩可能没有 settings 面
    try {
      void bridge()
        .settings.get()
        .then((s) => setWowDir(s.wowDirectory))
        .catch(() => {});
    } catch {
      /* noop */
    }
  }, []);
  const PAGE = 100;

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // 后台补载(backlog #12)是唯一的分页驱动:首屏一页立即渲染,之后空闲
    // 逐页拉满整个 meta 索引(meta 行极小,全量常驻可承受)。不与滚动加载
    // 并存 —— 双驱动会在 hasMore/游标上互相踩(agy 复核第 1 条)。
    void (async () => {
      const first = await bridge().matches.page({ limit: PAGE });
      if (cancelled) return;
      setMetas(first);
      setHasMore(first.length === PAGE);
      // 启动即呈现最近一场,免去空态点击
      setSelectedId((cur) => cur ?? first[0]?.id ?? null);
      let cursor = first[first.length - 1]?.startTime;
      let more = first.length === PAGE;
      while (more && !cancelled && cursor !== undefined) {
        await sleep(150); // 逐页让位于用户交互与其它 IPC
        if (cancelled) return;
        const older = await bridge().matches.page({
          before: cursor,
          limit: PAGE,
        });
        if (cancelled) return;
        setMetas((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = older.filter((m) => !seen.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        const next = older[older.length - 1]?.startTime;
        // 游标必须严格递减,否则终止(防异常数据把循环钉死在同一页)
        more = older.length === PAGE && next !== undefined && next < cursor;
        cursor = next;
        if (!more) setHasMore(false);
      }
    })();
    // 入库通知按时间排序插入:历史导入会涌入旧场次,裸 prepend 会破坏
    // 列表的新→旧排序(agy 复核第 2 条)。
    let unMatchStored: (() => void) | undefined;
    try {
      unMatchStored = bridge().logs.onMatchStored((m) =>
        setMetas((prev) =>
          prev.some((p) => p.id === m.id)
            ? prev
            : [...prev, m].sort((a, b) => b.startTime - a.startTime),
        ),
      );
    } catch {
      /* 测试桩无 logs 面 */
    }
    return () => {
      cancelled = true;
      unMatchStored?.();
    };
  }, []);

  useEffect(() => {
    if (selectedId) {
      void bridge().matches.get(selectedId).then(setDoc);
    } else {
      setDoc(null);
    }
  }, [selectedId]);

  // 评分涨跌(1e):同 bracket+角色 的相邻两场差值;首场/无评分 → null 不显示箭头
  const ratingDeltas = useMemo(() => {
    const map = new Map<string, number | null>();
    const last = new Map<string, number>();
    for (const m of [...metas].sort((a, b) => a.startTime - b.startTime)) {
      const personal = typeof m.playerRating === "number" && m.playerRating > 0;
      const r = personal ? m.playerRating! : (m.avgRating ?? null);
      if (r == null) {
        map.set(m.id, null);
        continue;
      }
      // 评分源同类相比:本人 CR 与队均 MMR 不混比(agy 复核)
      const key = `${m.bracket}|${m.playerName ?? ""}|${personal ? "cr" : "mmr"}`;
      const prev = last.get(key);
      map.set(m.id, prev != null ? r - prev : null);
      last.set(key, r);
    }
    return map;
  }, [metas]);

  // 日期分组(1e):今天/昨天/M月D日 + 当日小结「N 场 · W-L」
  const grouped = useMemo(() => {
    const list = applyFilter(metas, filter);
    const groups: Array<{
      key: string;
      label: string;
      summary: string;
      items: StoredMatchMeta[];
    }> = [];
    const today = new Date();
    const dayLabel = (d: Date): string => {
      const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
      const yesterday = new Date(today.getTime() - 86_400_000);
      if (sameDay(d, today)) return "今天";
      if (sameDay(d, yesterday)) return "昨天";
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    };
    for (const m of list) {
      const d = new Date(m.startTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const cur = groups[groups.length - 1];
      if (cur && cur.key === key) cur.items.push(m);
      else groups.push({ key, label: dayLabel(d), summary: "", items: [m] });
    }
    for (const g of groups) {
      const wins = g.items.filter((m) =>
        m.result.toLowerCase().startsWith("win"),
      ).length;
      g.summary = `${g.items.length} 场 · ${wins}-${g.items.length - wins}`;
    }
    return groups;
  }, [metas, filter]);

  return (
    <div className="app-container">
      <header className="app-topbar">
        <h1>gladlog</h1>
        <div className="rpt-view-tabs app-view-tabs">
          {(Object.keys(APP_VIEW_LABEL) as AppView[]).map((v) => (
            <button
              key={v}
              className={v === appView ? "active" : ""}
              onClick={() => setAppView(v)}
            >
              {APP_VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </header>
      {appView === "dev" ? (
        <DevPanel />
      ) : appView === "settings" ? (
        <SettingsPanel />
      ) : appView === "stats" ? (
        <StatsDashboard
          onCompClick={(specId) => {
            setFilter({ ...EMPTY_FILTER, specId });
            setAppView("matches");
          }}
          onOpenMatch={(matchId) => {
            setSelectedId(matchId);
            setAppView("matches");
          }}
        />
      ) : (
        <div className="app-layout">
          <aside className="app-sidebar">
            <MatchListFilter
              metas={metas}
              filter={filter}
              onChange={setFilter}
            />
            <ul data-testid="match-list" className="match-list">
              {grouped.flatMap((g) => [
                <li key={`g:${g.key}`} className="mlr-group">
                  <span>{g.label}</span>
                  <span className="mlr-group-sum">{g.summary}</span>
                </li>,
                ...g.items.map((m) => (
                  <li
                    key={m.id}
                    className={m.id === selectedId ? "sel" : ""}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <MatchListRow
                      meta={m}
                      ratingDelta={ratingDeltas.get(m.id)}
                    />
                  </li>
                )),
              ])}
              {hasMore && <li className="loading-more">后台补载中…</li>}
            </ul>
          </aside>
          <main className="app-main">
            {doc && doc.data ? (
              doc.kind === "shuffle" ? (
                <ShuffleReport
                  key={selectedId ?? undefined}
                  shuffle={doc.data}
                />
              ) : (
                <MatchReport
                  key={selectedId ?? undefined}
                  source={doc.data}
                  matchId={selectedId ?? undefined}
                />
              )
            ) : metas.length === 0 ? (
              <div className="onboard" data-testid="onboard">
                <h2>欢迎使用 gladlog</h2>
                {wowDir == null ? (
                  <>
                    <ol>
                      <li>选择 WoW 安装目录(自动定位战斗日志并开始监控)</li>
                      <li>打一场竞技场,或导入历史日志</li>
                      <li>回来看战报、回放和 AI 分析</li>
                    </ol>
                    <button
                      className="onboard-cta"
                      onClick={() =>
                        void bridge()
                          .app.selectDirectory()
                          .then((dir) => {
                            if (dir) setWowDir(dir);
                          })
                      }
                    >
                      选择 WoW 目录…
                    </button>{" "}
                    <ImportButton />
                    <p className="onboard-hint">
                      需要开启游戏内战斗记录(高级模式);AI 分析在「设置」里配 API
                      key,不配也能看战报与回放。
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      ✅ 正在监控 <code>{wowDir}</code> —— 打一场竞技场,战报会
                      自动出现在左侧。
                    </p>
                    <p>
                      <ImportButton />
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="empty-state">选择一场对局</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
