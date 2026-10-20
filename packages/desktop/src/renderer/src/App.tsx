import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StoredMatchMeta } from "../../main/matchStore";
import { startAutoAnalyzeListener } from "./batch/autoAnalyze";
import { bridge } from "./bridge";
import { BatchAnalyzeBar } from "./components/BatchAnalyzeBar";
import { deriveRatingDeltas } from "./components/dashboard";
import { DevPanel } from "./components/DevPanel";
import { ImportButton } from "./components/ImportButton";
import {
  applyFilter,
  EMPTY_FILTER,
  type ListFilter,
  MatchListFilter,
} from "./components/MatchListFilter";
import { MatchListRow } from "./components/MatchListRow";
import { SettingsPanel } from "./components/SettingsPanel";
import { SidebarSplitter } from "./components/SidebarSplitter";
import { StatsDashboard } from "./components/StatsDashboard";
import { UpdateBanner } from "./components/UpdateBanner";
import { MatchReport } from "./report/components/MatchReport";
import { ShuffleReport } from "./report/components/ShuffleReport";
import { useSidebarWidth } from "./sidebarWidth";
import { applyUiZoom } from "./uiZoom";

type AppView = "matches" | "stats" | "settings" | "dev";
const APP_VIEW_LABEL: Record<AppView, string> = {
  matches: "对局",
  stats: "战绩",
  settings: "设置",
  dev: "开发者",
};

export default function App({
  initialAppView = "matches",
  initialDevZone,
}: {
  initialAppView?: AppView;
  /** For visual-regression scenes: jump straight to one zone of the dev page. */
  initialDevZone?: "watch" | "inspect" | "ai" | "diag";
} = {}) {
  const [appView, setAppView] = useState<AppView>(initialAppView);
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<ListFilter>(EMPTY_FILTER);
  // Batch-selection checkmarks (meta ids; a shuffle id selects the whole
  // lobby). Lives here because both the batch bar (launch/clear) and every
  // list row (toggle) read it.
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [wowDir, setWowDir] = useState<string | null>(null);

  useEffect(() => {
    // The test stub may not have a settings surface
    try {
      void bridge()
        .settings.get()
        .then((s) => {
          setWowDir(s.wowDirectory);
          // UI scale: applied from App's mount rather than from main.tsx on
          // purpose — main.tsx also mounts the offscreen ExportReportPage
          // window, and zooming that one would bake the user's screen scale
          // into every exported image instead of only into what they look at.
          applyUiZoom(s.uiZoom);
        })
        .catch(() => {});
    } catch {
      /* noop */
    }
  }, []);

  const [recWarn, setRecWarn] = useState(false);

  useEffect(() => {
    // The recorder thinks it's armed but isn't actually connected to OBS —— the
    // exact combination that previously meant "no video, and nobody finds out
    // until after the match". The test stub may not have a recorder surface.
    const apply = (s: {
      enabled: boolean;
      connected: boolean;
      recording: boolean;
    }) => setRecWarn(s.enabled && !s.connected && !s.recording);
    try {
      const api = bridge().recorder;
      if (!api?.getStatus) return;
      void api.getStatus().then(apply);
      return api.onStatus?.(apply);
    } catch {
      /* the test stub may not have a recorder surface */
    }
  }, []);

  useEffect(() => {
    // Auto-analyze new matches (2026-08-01): subscribe on mount, unsubscribe on
    // unmount. When the stub lacks a logs surface, the bridge().logs.onMatchStored
    // call inside startAutoAnalyzeListener throws outright (same try/catch
    // precedent as the settings stub for wowDir above).
    try {
      return startAutoAnalyzeListener();
    } catch {
      return undefined;
    }
  }, []);
  const PAGE = 100;

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Background backfill (backlog #12) is the only pagination driver: the first
    // page renders immediately, then idle time pulls the whole meta index page by
    // page (meta rows are tiny, so keeping them all resident is affordable). It
    // does not coexist with scroll-triggered loading — two drivers trip over each
    // other on hasMore and the cursor (agy review, item 1).
    void (async () => {
      const first = await bridge().matches.page({ limit: PAGE });
      if (cancelled) return;
      setMetas(first);
      setHasMore(first.length === PAGE);
      // Show the most recent match right at startup, sparing a click out of the empty state
      setSelectedId((cur) => cur ?? first[0]?.id ?? null);
      let cursor = first[first.length - 1]?.startTime;
      let more = first.length === PAGE;
      while (more && !cancelled && cursor !== undefined) {
        await sleep(150); // yield between pages to user interaction and other IPC
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
        // The cursor must strictly decrease, otherwise stop (so bad data cannot
        // pin the loop to the same page forever)
        more = older.length === PAGE && next !== undefined && next < cursor;
        cursor = next;
        if (!more) setHasMore(false);
      }
    })();
    // Insert stored-match notifications in time order: a history import floods in
    // old matches, and a bare prepend would break the list's newest→oldest
    // ordering (agy review, item 2).
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
      /* the test stub has no logs surface */
    }
    return () => {
      cancelled = true;
      unMatchStored?.();
    };
  }, []);

  const [isLoading, setIsLoading] = useState(false);

  // perf-1: prefer the lazy per-round open (only round 0 parsed for a shuffle
  // with a ready sidecar); feature-detected so fixture/test bridge stubs that
  // only provide get() keep working unchanged.
  const { width: sidebarWidth, setWidth: setSidebarWidth } = useSidebarWidth();
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    if (selectedId) {
      setDoc(null);
      setIsLoading(true);
      const m = bridge().matches as {
        get(id: string): Promise<unknown | null>;
        getLazy?(id: string): Promise<unknown | null>;
      };
      void (m.getLazy ? m.getLazy(selectedId) : m.get(selectedId)).then((d) => {
        if (selectedIdRef.current !== selectedId) return; // 已切走
        setDoc(d);
        setIsLoading(false);
      });
    } else {
      setDoc(null);
      setIsLoading(false);
    }
  }, [selectedId]);

  // perf-2 hover warm-up: main ensures the per-round sidecar + OS page cache
  // are ready before the click. Dedup per id (mouseenter refires on every
  // row pass); fixture stubs may lack the surface.
  const prefetched = useRef<Set<string>>(new Set());
  const prefetchMatch = useCallback((id: string) => {
    if (prefetched.current.has(id)) return;
    prefetched.current.add(id);
    try {
      void (
        bridge().matches as { prefetch?: (id: string) => Promise<void> }
      ).prefetch?.(id);
    } catch {
      /* noop */
    }
  }, []);

  // A lazily-opened shuffle's unloaded round: fetch its bytes, splice the
  // parsed round into a fresh doc object (loaded rounds keep their identity —
  // the derive memo caches key off the round object). getRound coming back
  // null (stale sidecar) falls back to a whole-doc re-open.
  const loadRound = useCallback((roundIndex: number) => {
    const id = selectedIdRef.current;
    if (!id) return;
    const m = bridge().matches as {
      get(id: string): Promise<unknown | null>;
      getRound?(id: string, i: number): Promise<unknown | null>;
    };
    if (!m.getRound) return;
    void m.getRound(id, roundIndex).then(async (round) => {
      if (round == null) {
        const full = await m.get(id);
        if (selectedIdRef.current === id && full) setDoc(full);
        return;
      }
      if (selectedIdRef.current !== id) return;
      setDoc((prev: any) => {
        const rounds = prev?.data?.rounds;
        if (!Array.isArray(rounds) || rounds[roundIndex] != null) return prev;
        const next = rounds.slice();
        next[roundIndex] = round;
        return { ...prev, data: { ...prev.data, rounds: next } };
      });
    });
  }, []);

  // Rating deltas (1e): the algorithm lives in dashboard.ts's deriveRatingDeltas
  // (single-source, shared with the stats page's "recent matches" card)
  const ratingDeltas = useMemo(() => deriveRatingDeltas(metas), [metas]);

  // Date grouping (1e): today / yesterday / month-day, plus a per-day summary of
  // "N matches · W-L"
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
        <UpdateBanner />
      </header>
      {recWarn && (
        <div className="app-rec-warn">录像未连接:这一场不会被录下</div>
      )}
      {appView === "dev" ? (
        <DevPanel initialZone={initialDevZone} />
      ) : appView === "settings" ? (
        <SettingsPanel />
      ) : appView === "stats" ? (
        <StatsDashboard
          onCompClick={(specId) => {
            setFilter({ ...EMPTY_FILTER, specIds: [specId] });
            setAppView("matches");
          }}
          onZoneClick={(zoneId) => {
            setFilter({ ...EMPTY_FILTER, zoneId });
            setAppView("matches");
          }}
          onOpenMatch={(matchId) => {
            setSelectedId(matchId);
            setAppView("matches");
          }}
        />
      ) : (
        <div
          className="app-layout"
          ref={layoutRef}
          style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        >
          <aside className="app-sidebar">
            <BatchAnalyzeBar
              metas={metas}
              selected={batchSelected}
              onClearSelected={() => setBatchSelected(new Set())}
            />
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
                    onMouseEnter={() => prefetchMatch(m.id)}
                  >
                    <MatchListRow
                      meta={m}
                      ratingDelta={ratingDeltas.get(m.id)}
                      checked={batchSelected.has(m.id)}
                      onToggleCheck={() =>
                        setBatchSelected((cur) => {
                          const next = new Set(cur);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })
                      }
                    />
                  </li>
                )),
              ])}
              {hasMore && <li className="loading-more">后台补载中…</li>}
            </ul>
          </aside>
          {/* 第三条栅格轨必须有真实 DOM 元素:.app-layout 是
              `var(--sidebar-w) 6px 1fr`,少了这个元素,栅格自动布局会把
              .app-main 放进那条 6px 轨,整个界面塌成 6px 宽。 */}
          <SidebarSplitter
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            layoutRef={layoutRef}
          />
          <main className="app-main">
            {isLoading ? (
              <div className="empty-state">加载中...</div>
            ) : doc && doc.data ? (
              doc.kind === "shuffle" ? (
                <ShuffleReport
                  key={selectedId ?? undefined}
                  shuffle={doc.data}
                  videoMatchId={selectedId ?? undefined}
                  ratingDelta={selectedId ? ratingDeltas.get(selectedId) : null}
                  roundStats={
                    metas.find((m) => m.id === selectedId)?.roundStats
                  }
                  onNeedRound={loadRound}
                />
              ) : (
                <MatchReport
                  key={selectedId ?? undefined}
                  source={doc.data}
                  matchId={selectedId ?? undefined}
                  ratingDelta={selectedId ? ratingDeltas.get(selectedId) : null}
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
