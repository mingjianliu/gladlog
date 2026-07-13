import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import realMatch from "../test/fixtures/real-match-sample.json";
import synthMatch from "../test/fixtures/report-match.json";
import "../src/renderer/src/styles.css";
import "./harness.css";

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

const FIXTURES: Record<string, StoredMatch> = {
  "real · 真实 3v3(纳格兰)": realMatch as unknown as StoredMatch,
  "synthetic · 合成小样": synthMatch as unknown as StoredMatch,
};

function Harness() {
  const keys = Object.keys(FIXTURES);
  const [which, setWhich] = useState(keys[0]!);
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
        <MatchReport key={which} source={FIXTURES[which]!} matchId={which} />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
