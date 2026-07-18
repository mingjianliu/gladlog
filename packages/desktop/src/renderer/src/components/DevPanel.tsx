import { useEffect, useState } from "react";
import type { DiagnosticEntry, LogsStatusSnapshot } from "../../../preload/api";
import type { StoredMatchMeta } from "../../../main/matchStore";
import { bridge } from "../bridge";

export function DevPanel() {
  const [status, setStatus] = useState<LogsStatusSnapshot | null>(null);
  const [matches, setMatches] = useState<StoredMatchMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown | null>(null);
  const [diags, setDiags] = useState<DiagnosticEntry[]>([]);
  const [wowDir, setWowDir] = useState<string | null>(null);
  const [aiBackend, setAiBackend] = useState<"anthropic" | "claudeCli" | "agy">(
    "anthropic",
  );
  const [aiCalls, setAiCalls] = useState<
    Array<{
      kind: "analysis" | "compare";
      matchId: string;
      at: number;
      model: string;
      prompt: string;
      raw: string;
    }>
  >([]);
  const refreshAiCalls = () => {
    try {
      void bridge()
        .debug.aiCalls()
        .then(setAiCalls)
        .catch(() => setAiCalls([]));
    } catch {
      /* 测试桩无该面 */
    }
  };

  useEffect(() => {
    void bridge().logs.getStatus().then(setStatus);
    void bridge().matches.list().then(setMatches);
    void bridge()
      .settings.get()
      .then((s) => {
        setWowDir(s.wowDirectory);
        setAiBackend(s.aiBackend);
      });
    const un1 = bridge().logs.onStatusChanged(setStatus);
    const un2 = bridge().logs.onMatchStored((m) =>
      setMatches((prev) => [m, ...prev]),
    );
    const un3 = bridge().logs.onDiagnostic((d) =>
      setDiags((prev) => [d, ...prev].slice(0, 100)),
    );
    return () => {
      un1();
      un2();
      un3();
    };
  }, []);

  useEffect(() => {
    if (selected) void bridge().matches.get(selected).then(setDetail);
    else setDetail(null);
  }, [selected]);

  const pickDir = async () => {
    const dir = await bridge().app.selectDirectory();
    if (dir) setWowDir(dir);
  };

  const fmt = (t: number) => new Date(t).toLocaleString();

  return (
    <div className="grid">
      <section className="panel">
        <h2>监控状态</h2>
        <p>
          WoW 目录:{wowDir ?? "未设置"}{" "}
          <button onClick={() => void pickDir()}>选择目录…</button>
        </p>
        <p>
          <button
            onClick={() =>
              void bridge()
                .matches.rebuildIndex()
                .then((r) =>
                  alert(`索引已重建:更新 ${r.updated},失败 ${r.failed}`),
                )
            }
          >
            重建对局索引(回填富行字段)
          </button>
        </p>
        <p>
          AI 后端(调试):{" "}
          <select
            value={aiBackend}
            onChange={(e) => {
              const v = e.target.value as "anthropic" | "claudeCli" | "agy";
              setAiBackend(v);
              void bridge().settings.save({ aiBackend: v });
            }}
          >
            <option value="anthropic">Anthropic API</option>
            <option value="claudeCli">Claude CLI(本地)</option>
            <option value="agy">agy / Gemini(本地)</option>
          </select>
        </p>
        <p>
          {status
            ? status.watching
              ? `✅ watching ${status.logsDir}`
              : `⛔ 未监控(${status.logsDir || "无目录"})`
            : "worker 未启动"}
        </p>
        <ul>
          {status?.files.map((f) => (
            <li key={f.fileKey}>
              {f.fileKey} — {f.offset}/{f.size}B{" "}
              {f.quarantined ? "🧪 quarantined" : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>对局({matches.length})</h2>
        <ul className="matches">
          {matches.map((m) => (
            <li
              key={m.id}
              className={m.id === selected ? "sel" : ""}
              onClick={() => setSelected(m.id)}
            >
              [{m.kind}] {m.bracket} · zone {m.zoneId} · {fmt(m.startTime)} ·{" "}
              {m.result}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel detail">
        <h2>详情</h2>
        <pre>{detail ? JSON.stringify(detail, null, 2) : "选择一场对局"}</pre>
      </section>
      <section className="panel" data-testid="ai-debug">
        <h2>
          AI 调用调试({aiCalls.length}){" "}
          <button onClick={refreshAiCalls}>刷新</button>
        </h2>
        {aiCalls.length === 0 && (
          <p className="rpt-dim">
            无记录 —— 跑一次 AI 分析/对比后点「刷新」。仅保留最近 10 次,存内存不落盘。
          </p>
        )}
        {aiCalls.map((c, i) => (
          <details key={i} className="dev-aicall">
            <summary>
              [{c.kind}] {c.matchId} · {new Date(c.at).toLocaleTimeString()} ·{" "}
              {c.model} · prompt {c.prompt.length} 字 / 返回 {c.raw.length} 字
            </summary>
            <h3>Prompt</h3>
            <pre>{c.prompt}</pre>
            <h3>返回文本</h3>
            <pre>{c.raw}</pre>
          </details>
        ))}
      </section>
      <section className="panel">
        <h2>诊断({diags.length})</h2>
        <ul>
          {diags.map((d, i) => (
            <li key={i}>
              {new Date(d.at).toLocaleTimeString()} [{d.code}] {d.fileKey ?? ""}{" "}
              {d.detail ?? ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
