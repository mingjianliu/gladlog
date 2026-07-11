import { useEffect, useState } from "react";
import { DevPanel } from "./components/DevPanel";
import { MatchReport } from "./report/components/MatchReport";
import { ShuffleReport } from "./report/components/ShuffleReport";
import type { StoredMatchMeta } from "../../main/matchStore";
import { bridge } from "./bridge";

export default function App() {
  const [showDev, setShowDev] = useState(false);
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<any | null>(null);

  useEffect(() => {
    void bridge()
      .matches.list()
      .then((list) => {
        setMetas(list);
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

  useEffect(() => {
    if (selectedId) {
      void bridge().matches.get(selectedId).then(setDoc);
    } else {
      setDoc(null);
    }
  }, [selectedId]);

  const fmt = (t: number) => new Date(t).toLocaleString();

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
            <ul>
              {metas.map((m) => (
                <li
                  key={m.id}
                  className={m.id === selectedId ? "sel" : ""}
                  onClick={() => setSelectedId(m.id)}
                >
                  <span className={`badge badge-${m.kind}`}>[{m.kind}]</span>{" "}
                  {m.bracket} · {fmt(m.startTime)} · {m.result}
                </li>
              ))}
            </ul>
          </aside>
          <main className="app-main">
            {doc && doc.data ? (
              doc.kind === "shuffle" ? (
                <ShuffleReport shuffle={doc.data} />
              ) : (
                <MatchReport source={doc.data} />
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
