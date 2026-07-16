import { useEffect, useRef, useState } from "react";
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

export default function App() {
  const [appView, setAppView] = useState<AppView>("matches");
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
  const loadingRef = useRef(false);
  const PAGE = 100;

  useEffect(() => {
    void bridge()
      .matches.page({ limit: PAGE })
      .then((list) => {
        setMetas(list);
        setHasMore(list.length === PAGE);
        // 启动即呈现最近一场,免去空态点击
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      });
    const unMatchStored = bridge().logs.onMatchStored((m) =>
      setMetas((prev) => [m, ...prev]),
    );
    return () => {
      unMatchStored();
    };
  }, []);

  const loadOlder = () => {
    if (loadingRef.current || !hasMore) return;
    const oldest = metas[metas.length - 1];
    if (!oldest) return;
    loadingRef.current = true;
    void bridge()
      .matches.page({ before: oldest.startTime, limit: PAGE })
      .then((older) => {
        setMetas((prev) => [...prev, ...older]);
        setHasMore(older.length === PAGE);
      })
      .finally(() => {
        loadingRef.current = false;
      });
  };

  const onScroll = (e: React.UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadOlder();
  };

  useEffect(() => {
    if (selectedId) {
      void bridge().matches.get(selectedId).then(setDoc);
    } else {
      setDoc(null);
    }
  }, [selectedId]);

  return (
    <div className="app-container">
      <header className="app-topbar">
        <h1>gladlog</h1>
        <div className="rpt-mode-seg">
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
            <ul
              data-testid="match-list"
              className="match-list"
              onScroll={onScroll}
            >
              {applyFilter(metas, filter).map((m) => (
                <li
                  key={m.id}
                  className={m.id === selectedId ? "sel" : ""}
                  onClick={() => setSelectedId(m.id)}
                >
                  <MatchListRow meta={m} />
                </li>
              ))}
              {hasMore && <li className="loading-more">加载更早…</li>}
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
                      <li>
                        选择 WoW 安装目录(自动定位战斗日志并开始监控)
                      </li>
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
                      需要开启游戏内战斗记录(高级模式);AI 分析在「设置」里配
                      API key,不配也能看战报与回放。
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
