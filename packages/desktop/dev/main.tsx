import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import realMatch from "../test/fixtures/real-match-sample.json";
import synthMatch from "../test/fixtures/report-match.json";
import "../src/renderer/src/styles.css";
import "./harness.css";
import { resolveScene, type SceneName } from "./scenes";
import App from "../src/renderer/src/App";
import { installFixtureBridge } from "../src/renderer/src/fixtureBridge";
import { installAppShellFixture } from "./fixtures/appShell";

const off = () => () => {};

// 让 AI 视图有内容可看的假分析/对比结果(bridge mock)。
const sampleAnalysis = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "被集火秒杀",
      explanation:
        "0:41 敌方双 DPS 进攻 CD 对齐,你在没有减伤/位移的情况下于 1.4s 内掉血 82% 后阵亡。此前 3s 你贴在开阔地带、离掩体 12 码。",
    },
    {
      eventIds: ["e2"],
      severity: "med",
      category: "cooldowns",
      title: "防御 CD 留手",
      explanation:
        "整场保留了一个大防御 CD 未用即阵亡——在上一段承伤窗口(0:33–0:39)本应交出以打断集火节奏。",
    },
    {
      eventIds: ["e3"],
      severity: "low",
      category: "positioning",
      title: "站位偏开阔",
      explanation: "多数时间停留在中场开阔区,较少利用立柱拉视线。",
    },
  ],
  dropped: 0,
  hadNarration: true,
};

const sampleCompare = {
  verifiedComparison: {
    dims: [
      {
        key: "offensiveIndex",
        value: 0.31,
        p10: 0.2,
        p50: 0.49,
        p90: 0.7,
        percentile: 28,
        verdict: "bottom quartile of your cohort",
      },
      {
        key: "defensiveUsage",
        value: 0.44,
        p10: 0.3,
        p50: 0.55,
        p90: 0.82,
        percentile: 35,
        verdict: "below median",
      },
    ],
    facts: {},
  },
  report:
    "相对同 spec/comp 分档,你的进攻输出与防御 CD 利用都偏低;优先补上被集火时的减伤时机。",
  droppedReason: null,
  cellMeta: {
    spec: "Retribution Paladin",
    bracket: "3v3",
    archetype: "melee-cleave",
    buildGroup: "offensive",
    sampleN: 128,
    fellBackTo: "archetype×buildGroup",
  },
};

(window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
  analysis: {
    getCached: async () => sampleAnalysis,
    run: () => {},
    cancel: () => {},
    onDone: off,
    onError: off,
  },
  compare: {
    getCached: async () => sampleCompare,
    run: () => {},
    cancel: () => {},
    onDelta: off,
    onDone: off,
    onError: off,
  },
};

const BASE_FIXTURES: Record<string, StoredMatch> = {
  "real · 真实 3v3(纳格兰,裁剪匿名)": realMatch as unknown as StoredMatch,
  "synthetic · 合成小样": synthMatch as unknown as StoredMatch,
};
// 完整真实局:dev/local/full-match.json(gitignored,仅本机)。存在则运行时加载。
const LOCAL_KEY = "real · 完整真实局(本地 dev/local)";

// 场景模式(?scene=…):渲染单一确定状态,给视觉回归截图用。
// data-scene-ready 是 Playwright 的就绪信号 —— 挂上即表示该场景已渲染。
const SCENE_VIEW: Record<
  "report-battle" | "report-replay" | "report-ai" | "report-synth",
  { fixture: StoredMatch; initialView: "report" | "replay" | "ai" }
> = {
  "report-battle": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "report",
  },
  "report-replay": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "replay",
  },
  "report-ai": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "ai",
  },
  "report-synth": {
    fixture: synthMatch as unknown as StoredMatch,
    initialView: "report",
  },
};

const APP_SHELL_VIEW = {
  dashboard: "stats",
  settings: "settings",
  matchlist: "matches",
} as const;

function AppShellScene({ name }: { name: SceneName }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    installAppShellFixture();
    setReady(true);
  }, []);
  if (!ready) return null;
  return (
    <div className="scene-root scene-appshell" data-scene-ready={name}>
      <App
        initialAppView={APP_SHELL_VIEW[name as keyof typeof APP_SHELL_VIEW]}
      />
    </div>
  );
}

function Scene({ name }: { name: SceneName }) {
  if (name in APP_SHELL_VIEW) return <AppShellScene name={name} />;
  const cfg = SCENE_VIEW[name as keyof typeof SCENE_VIEW];
  return (
    <div className="scene-root" data-scene-ready={name}>
      <MatchReport
        source={cfg.fixture}
        matchId={name}
        initialView={cfg.initialView}
      />
    </div>
  );
}

function Harness() {
  const [local, setLocal] = useState<StoredMatch | null>(null);
  // 压测样本池(dev/local/stress-*.json,gitignored;由 make-report-fixture.mjs
  // --keep-names 从野生日志生成)。清单存在才加载;选中时才拉文件(最大 200MB+)。
  const [stressIndex, setStressIndex] = useState<
    Array<{ file: string; label: string }>
  >([]);
  const [stressLoaded, setStressLoaded] = useState<Record<string, StoredMatch>>(
    {},
  );
  useEffect(() => {
    let cancelled = false;
    fetch("./local/full-match.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setLocal(j as StoredMatch);
      })
      .catch(() => {});
    fetch("./local/stress-index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && Array.isArray(j)) setStressIndex(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fixtures: Record<string, StoredMatch> = {
    ...(local ? { [LOCAL_KEY]: local } : {}),
    ...BASE_FIXTURES,
    ...stressLoaded,
  };
  for (const s of stressIndex) {
    if (!(s.label in fixtures)) {
      fixtures[s.label] = null as unknown as StoredMatch; // 占位:选中时按需加载
    }
  }
  const keys = Object.keys(fixtures);
  const [which, setWhich] = useState(keys[0]!);
  // 本地完整局加载完成后自动切过去
  useEffect(() => {
    if (local) setWhich(LOCAL_KEY);
  }, [local]);

  // 选中未加载的压测样本 → 按需 fetch(大文件只在需要时进内存)
  useEffect(() => {
    const entry = stressIndex.find((s) => s.label === which);
    if (!entry || stressLoaded[which]) return;
    let cancelled = false;
    fetch(`./local/${entry.file}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j)
          setStressLoaded((prev) => ({ ...prev, [which]: j as StoredMatch }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [which, stressIndex, stressLoaded]);

  const current = fixtures[which] ?? fixtures[keys[0]!]!;
  return (
    <>
      <div className="harness-bar">
        <strong>gladlog UI 试验台</strong>
        <label>
          fixture
          <select value={which} onChange={(e) => setWhich(e.target.value)}>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="harness-hint">纯浏览器渲染 · HMR · 免 Electron</span>
      </div>
      <div className="harness-body">
        {current ? (
          <MatchReport key={which} source={current} matchId={which} />
        ) : (
          <div style={{ padding: 24 }}>加载压测样本中…(大文件请稍候)</div>
        )}
      </div>
    </>
  );
}

const scene = resolveScene(window.location.search);

// 场景模式统一用 fixtureBridge 的完整 mock(比本文件顶部那份精简 mock 多了
// getState/getFlags/notebook,AI 视图才会真的渲染出 finding 卡片而不是停在
// 空闲态)。必须在 render 之前同步装好 —— 面板挂载时的 effect 立刻就要读它。
if (scene) installFixtureBridge();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {scene ? <Scene name={scene} /> : <Harness />}
  </React.StrictMode>,
);
