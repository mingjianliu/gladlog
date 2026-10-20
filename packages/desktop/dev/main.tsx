/* eslint-disable simple-import-sort/imports -- the stylesheets load after the components, as in the app (the sorter would hoist side-effect imports and change the CSS cascade) */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { ShuffleReport } from "../src/renderer/src/report/components/ShuffleReport";
import type {
  StoredMatch,
  StoredShuffle,
} from "../src/renderer/src/report/derive/types";
import realMatch from "../test/fixtures/real-match-sample.json";
import synthMatch from "../test/fixtures/report-match.json";
import "../src/renderer/src/styles.css";
import "./harness.css";
import { ensureAnalysisData } from "@gladlog/analysis";
import { resolveScene, type SceneName } from "./scenes";
import App from "../src/renderer/src/App";
import { installFixtureBridge } from "../src/renderer/src/fixtureBridge";
import {
  heavyMatch,
  installAppShellFixture,
  patchDemoMatchDocs,
} from "./fixtures/appShell";
import { ReviewMode } from "./review/ReviewMode";

const off = () => () => {};

// Fake analysis / comparison results (bridge mock) so the AI view has something to show.
const sampleAnalysis = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "被集火秒杀",
      explanation:
        "0:41 敌方双 DPS 进攻 CD 对齐,你在没有减伤/位移的情况下于 1.4s 内掉血 82% 后阵亡。此前 3s 你贴在开阔地带、离掩体 12 码。",
      // Deep-dive chips: mix one with a spell and one without, to inspect both the
      // icon-plus-text layout and the no-icon fallback
      deepDive: {
        text: "承伤窗口内敌方寒冰新星先手,你的位移在 CD。",
        chips: [
          {
            t: 38,
            label: "寒冰新星",
            unitNames: ["Player1-Test"],
            spellId: "122",
          },
          {
            t: 40,
            label: "变形术",
            unitNames: ["Player3-Test"],
            spellId: "118",
          },
          { t: 41, label: "脱靶", unitNames: ["Player1-Test"] },
        ],
      },
    },
    {
      eventIds: ["e2"],
      severity: "med",
      category: "cooldowns",
      title: "防御 CD 留手:Tranquility 未使用",
      explanation:
        "整场保留了 Tranquility 未用即阵亡——对面 Restoration Druid 在 0:33 交出 Ironbark 后,你本应在承伤窗口用 Power Word: Shield 或 Renew's 持续回复顶住并读出 Tranquility。",
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

// Spell-icon stub: the main process's icon cache does not exist in the test bed.
// Returns a recognizable little square so icon-with-text layout can be inspected
// (both lane chips and finding chips consume this surface).
const FAKE_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
       <rect width="32" height="32" rx="6" fill="#5b4bb8"/>
       <circle cx="16" cy="16" r="7" fill="#c9b8ff"/>
     </svg>`,
  );

(window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
  icon: { get: async () => FAKE_ICON },
  analysis: {
    // The panel reads getState (cache + running in one atomic read), not
    // getCached — when the stub lacks this surface the panel stays idle forever
    // and the AI view shows no findings at all in the test bed.
    getState: async () => ({ cached: sampleAnalysis, running: false }),
    getCached: async () => sampleAnalysis,
    run: () => {},
    cancel: () => {},
    // Window analysis (#16): when the stub lacks this surface, clicking
    // "AI analysis for this window" lands on an error card (the TypeError is
    // swallowed by the catch) — returning a sample ok lets the test bed actually
    // show the result card and chip jumps.
    analyzeWindow: async () => ({
      status: "ok" as const,
      entries: [
        {
          title: "位移未交",
          text: "窗口内 Player2 吃了 寒冰新星 后未交位移,承伤段防御选择偏晚;下次同窗可提前给盾。",
          chips: [
            {
              t: 38,
              label: "寒冰新星",
              unitNames: ["Player1-Test"],
              spellId: "122",
            },
            {
              t: 41,
              label: "圣佑术",
              unitNames: ["Player2-Test"],
              spellId: "642",
            },
          ],
        },
      ],
      fromCache: false,
    }),
    onDelta: off,
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
// Full real match: dev/local/full-match.json (gitignored, local machine only).
// Loaded at runtime when present.
const LOCAL_KEY = "real · 完整真实局(本地 dev/local)";

// Scene mode (?scene=…): renders one deterministic state for visual-regression
// screenshots. data-scene-ready is Playwright's readiness signal — once present,
// that scene has rendered.
const SCENE_VIEW: Record<
  | "report-battle"
  | "report-replay"
  | "report-ai"
  | "report-synth"
  | "report-window"
  | "report-events"
  | "video"
  | "report-heavy",
  {
    fixture: StoredMatch;
    initialView: "report" | "replay" | "events" | "ai" | "video";
    initialTimeRange?: { fromS: number; toS: number };
  }
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
  // Time-range selected state: the window is the real match's first kill-attempt
  // band (0:36–0:59)
  "report-window": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "report",
    initialTimeRange: { fromS: 36, toS: 59 },
  },
  "report-events": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "events",
  },
  // Recording page (2a): vod://fixture issues no network request and always
  // errors → a black frame with stable pixels; the combat timeline and the three
  // right-hand tabs still render from log data as usual. The recorder surface is
  // patched in below.
  video: {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "video",
  },
  // First-paint timing only: the real sample scaled up deterministically by a
  // fixed factor; not used as a screenshot baseline
  "report-heavy": {
    fixture: heavyMatch(
      realMatch as unknown as Record<string, unknown>,
    ) as unknown as StoredMatch,
    initialView: "report",
  },
};

const APP_SHELL_VIEW = {
  dashboard: "stats",
  settings: "settings",
  matchlist: "matches",
  dev: "dev",
} as const;

/** Direct-link zone for the dev page: the core zone is the match inspector,
 * and that is what the baseline screenshots. */
const APP_SHELL_DEV_ZONE = {
  dev: "inspect",
} as const;

function AppShellScene({ name }: { name: SceneName }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    installAppShellFixture();
    // Only the dev page needs the demo id → document wiring (see the notes on
    // patchDemoMatchDocs)
    if (name === "dev") patchDemoMatchDocs();
    setReady(true);
  }, [name]);
  if (!ready) return null;
  return (
    <div className="scene-root scene-appshell" data-scene-ready={name}>
      <App
        initialAppView={APP_SHELL_VIEW[name as keyof typeof APP_SHELL_VIEW]}
        initialDevZone={
          APP_SHELL_DEV_ZONE[name as keyof typeof APP_SHELL_DEV_ZONE]
        }
      />
    </div>
  );
}

/** Six-round shuffle for the header scene (UI review 2026-08-21 #4): the same
 * real match cloned per round, alternating W/L — the pill strip is the
 * subject, not the rounds. */
function sixRoundShuffle(base: StoredMatch): StoredShuffle {
  const rounds = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    kind: "shuffleRound" as const,
    sequenceNumber: i,
    startTime: base.startTime,
    endTime: base.endTime,
    winningTeamId: i % 2,
  }));
  return {
    kind: "shuffle",
    rounds,
    startTime: base.startTime,
    endTime: base.endTime,
    result: base.result,
  };
}

function Scene({ name }: { name: SceneName }) {
  if (name in APP_SHELL_VIEW) return <AppShellScene name={name} />;
  if (name === "report-shuffle")
    return (
      <div className="scene-root" data-scene-ready={name}>
        <ShuffleReport
          shuffle={sixRoundShuffle(realMatch as unknown as StoredMatch)}
        />
      </div>
    );
  const cfg = SCENE_VIEW[name as keyof typeof SCENE_VIEW];
  return (
    <div className="scene-root" data-scene-ready={name}>
      <MatchReport
        source={cfg.fixture}
        matchId={name}
        initialView={cfg.initialView}
        initialTimeRange={cfg.initialTimeRange ?? null}
      />
    </div>
  );
}

function Harness() {
  const [local, setLocal] = useState<StoredMatch | null>(null);
  // Stress-test sample pool (dev/local/stress-*.json, gitignored; generated from
  // real-world logs by make-report-fixture.mjs --keep-names). Only loaded when
  // the index exists, and each file is only fetched on selection (up to 200MB+).
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
      fixtures[s.label] = null as unknown as StoredMatch; // placeholder: loaded on demand when selected
    }
  }
  const keys = Object.keys(fixtures);
  const [which, setWhich] = useState(keys[0]!);
  // Switch to the local full match automatically once it finishes loading
  useEffect(() => {
    if (local) setWhich(LOCAL_KEY);
  }, [local]);

  // Selecting a not-yet-loaded stress sample → fetch on demand (big files only
  // enter memory when needed)
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
// Review workbench (?review=<name>): scene mode wins ties (never both — a
// scene name and a review session name live in disjoint namespaces, but the
// precedence is explicit here per the brief), otherwise a `review` param
// routes to the blind-review workbench instead of the interactive Harness.
// Deliberately NOT folded into scenes.ts: a review session is an ad hoc named
// artifact built per experiment run, not a fixed baseline-screenshot state.
const review = scene
  ? null
  : new URLSearchParams(window.location.search).get("review");

// Scene mode uniformly uses fixtureBridge's full mock (which, unlike the slim
// mock at the top of this file, also has getState/getFlags/notebook, so the AI
// view actually renders finding cards instead of sitting idle). It must be
// installed synchronously before render — the panel's mount effect reads it
// immediately.
if (scene) installFixtureBridge();
// Review mode reuses this file's slim mock as-is (icon stub, compare stub,
// …) EXCEPT the AI tab's analysis surface: a blind reviewer seeing this
// file's canned findings (which have nothing to do with the real match being
// reviewed) would be a giveaway, so getState/getCached are overridden to
// report "no cache, not running" — the AI tab stays idle instead.
// analyzeWindow needs the same treatment: MatchReport's time-window
// selection (drag-select on the HP curve, or the 时间窗 dropdown) exposes an
// independent "AI 分析此段" button that calls analyzeWindow directly — the
// slim mock's canned window result ("位移未交"/"Player1-Test") would render
// as a real-looking finding card there even with getState/getCached patched.
// { status: "no-client" } is the exact shape production fixtureBridge.ts
// returns for "no analysis available" and the one WindowAnalysisCard already
// renders as a clean placeholder (not an error, not a fake finding) — so
// this is not inventing a new empty case, only reusing the existing one.
// `run` is left untouched: it's already a no-op (`() => {}`) that never
// fires `onDone`/`onDelta`, so it cannot inject a fake full-match finding
// either way.
if (review) {
  const fixtureAnalysis = (
    window as unknown as {
      __gladlogFixture: {
        analysis: {
          getState: (...args: unknown[]) => Promise<unknown>;
          getCached: (...args: unknown[]) => Promise<unknown>;
          analyzeWindow: (...args: unknown[]) => Promise<unknown>;
        };
      };
    }
  ).__gladlogFixture.analysis;
  fixtureAnalysis.getState = async () => ({
    cached: null,
    running: false,
    slots: [],
    activeKey: null,
  });
  fixtureAnalysis.getCached = async () => null;
  fixtureAnalysis.analyzeWindow = async () => ({
    status: "no-client" as const,
  });
}
// video scene: fixtureBridge has no recorder surface (a missing surface in the
// production stub means no recording tab) — the url uses a local 404 path so
// loading always fails → a black frame with stable pixels, and localhost stays
// out of stubExternal's leak ledger (vod:// would be recorded and flagged red).
// Patch one in for scene mode, with startedAt = the scene fixture's startTime
// (offsetS=0).
if (scene === "video") {
  (
    window as unknown as { __gladlogFixture: { recorder?: unknown } }
  ).__gladlogFixture.recorder = {
    getForMatch: async (id: string) =>
      id === "video"
        ? {
            url: "/__vod_fixture_missing__.mp4",
            startedAt: (realMatch as unknown as StoredMatch).startTime,
          }
        : null,
  };
}

// The spell-name / talent tables load in the background (analysis
// data/ensure.ts); production's first screen (the match list) does not need
// them, but the test bed and the visual baselines render the report immediately
// on load, so the ~50ms table load races the screenshot and makes baselines
// flaky — wait for it before mounting and trade latency for determinism. The
// firstPaint budget is measured through this same entry point and measures "the
// report's first render once ready", matching the semantics of the production
// report page.
void ensureAnalysisData().then(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {scene ? (
        <Scene name={scene} />
      ) : review ? (
        <ReviewMode name={review} />
      ) : (
        <Harness />
      )}
    </React.StrictMode>,
  );
});
