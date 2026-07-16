import { useEffect, useRef, useState } from "react";
import { DevPanel } from "./components/DevPanel";
import { MatchListRow } from "./components/MatchListRow";
import { MatchReport } from "./report/components/MatchReport";
import { ShuffleReport } from "./report/components/ShuffleReport";
import type { StoredMatchMeta } from "../../main/matchStore";
import { bridge } from "./bridge";

export default function App() {
  const [showDev, setShowDev] = useState(false);
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(true);
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
        <button onClick={() => setShowDev((prev) => !prev)}>开发者视图</button>
      </header>
      {showDev ? (
        <DevPanel />
      ) : (
        <div className="app-layout">
          <aside className="app-sidebar">
            <ul
              data-testid="match-list"
              className="match-list"
              onScroll={onScroll}
            >
              {metas.map((m) => (
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
            ) : (
              <div className="empty-state">选择一场对局</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
