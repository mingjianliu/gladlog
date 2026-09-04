import matchJson from "../../../test/fixtures/report-match.json";
import type { StoredMatchMeta } from "../../main/matchStore";
import type { GladlogSettings } from "../../main/settingsStore";
import type { LogsStatusSnapshot } from "../../preload/api";
import { DEMO_ANALYSIS } from "./report/data/demoAnalysis";
import type {
  StoredMatch,
  StoredShuffle,
  StoredShuffleRound,
} from "./report/derive/types";

// keep in sync with test/fixtures/loadFixture.ts
function buildSyntheticShuffle(base: StoredMatch): StoredShuffle {
  const rounds: StoredShuffleRound[] = [0, 1, 2].map((i) => ({
    ...base,
    kind: "shuffleRound" as const,
    sequenceNumber: i,
    startTime: base.startTime, // no shift: event timestamps are unmoved, keeping it self-consistent
    endTime: base.endTime,
    winningTeamId: i % 2,
  }));
  return {
    kind: "shuffle",
    rounds,
    startTime: rounds[0]!.startTime,
    endTime: rounds[2]!.endTime,
    result: base.result,
  };
}

export function installFixtureBridge(): void {
  const typedMatch = matchJson as unknown as StoredMatch;
  const syntheticShuffle = buildSyntheticShuffle(typedMatch);

  let currentSettings: GladlogSettings = {
    wowDirectory: null,
    anthropicApiKey: null,
    deepseekApiKey: null,
    aiModels: {},
    aiBackend: "anthropic",
    aiBackendCommand: null,
    aiLanguage: "zh",
    autoAnalyzeNew: false,
    recordingEnabled: false,
    obsWebsocketUrl: null,
    obsWebsocketPassword: null,
    recordingKeepCount: 50,
    recordingMaxBytes: 80 * 1024 ** 3,
    recordingMode: "managed",
    managedWsPassword: null,
    recordingDirectory: null,
    managedDesktopAudioDevice: "default",
    managedMicDevice: null,
    autoCheckUpdates: true,
    // Pinned to whatever app.getVersion() returns further down in this file
    // ("fixture"): equal values mean UpdateBanner renders no post-update
    // trace, so the baselines never depend on the app version. This file also
    // has NO `update` surface on purpose — updateBridge then degrades to "no
    // update information" and every update-related element stays out of the
    // screenshots. If anyone ever adds one, lastCheckedAt must be a constant,
    // never Date.now(), or settings.png drifts with the wall clock.
    lastSeenVersion: "fixture",
    // 100%: this file installs NO `ui` surface on purpose, so applyUiZoom
    // degrades to a no-op and the browser test bed / visual baselines keep
    // rendering at 1:1 regardless of what is stored here.
    uiZoom: 1,
  };

  // Give the AI view something to show in the fixture preview (the findings
  // card + the cohort comparison). Same object the product ships as the
  // 「看一个演示分析」demo (UI review #7) — one source, so the report-ai
  // visual baseline IS the demo.
  const sampleAnalysis = DEMO_ANALYSIS;
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
      ],
      facts: {},
    },
    report: "相对同 spec/comp 分档,你的进攻输出与防御 CD 利用都偏低。",
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
  const off = () => () => {};

  const gladlogMock = {
    logs: {
      async getStatus(): Promise<LogsStatusSnapshot> {
        return {
          watching: false,
          logsDir: "(fixture)",
          files: [],
        };
      },
      onStatusChanged() {
        return () => {};
      },
      onMatchStored() {
        return () => {};
      },
      onDiagnostic() {
        return () => {};
      },
    },
    // (fixture) bug report: nothing hits disk; return a fake path so the UI
    // flow can proceed
    bugReport: {
      async create(): Promise<{ dir: string; synced: boolean }> {
        return { dir: "/fixture/bugreports/demo", synced: false };
      },
    },
    // Task-6 复核 I12: without this surface the recorder status row and the
    // recording-mode selector never render in fixture mode -- the settings
    // scene was invisible to visual regression. Fixed values only (visual
    // baselines must be deterministic): "已就绪" + managed + already
    // installed, so both the status row and the mode selector show up
    // without the download/progress branch cluttering the baseline.
    recorder: {
      async getStatus() {
        return {
          enabled: true,
          connected: true,
          recording: false,
          lastError: null,
          sourceActive: true,
        };
      },
      onStatus() {
        return () => {};
      },
      async testConnection() {
        return { ok: true };
      },
      async autoConfig() {
        return { found: true, enabled: true, ok: true };
      },
      async getForMatch() {
        return null;
      },
      async installObs() {
        return { ok: true };
      },
      onInstallProgress() {
        return () => {};
      },
      async getObsInstallState() {
        return { installed: true, platformSupported: true };
      },
      // Managed-OBS prefs rows (2026-09-04): fixed device lists so the
      // settings scene's visual baseline stays deterministic.
      async listAudioDevices() {
        return {
          output: [{ id: "{fixture-out}", name: "Speakers (Fixture)" }],
          input: [{ id: "{fixture-mic}", name: "Microphone (Fixture)" }],
        };
      },
      async importObsPrefs() {
        return { found: false };
      },
      async selectRecordingDirectory() {
        return null;
      },
    },
    matches: {
      async list(): Promise<StoredMatchMeta[]> {
        return [
          {
            id: "fixture-match",
            kind: "match" as const,
            bracket: typedMatch.bracket,
            zoneId: String(typedMatch.zoneId),
            startTime: typedMatch.startTime,
            endTime: typedMatch.endTime,
            result: typedMatch.result,
            storedAt: Date.now(),
          },
          {
            id: "fixture-shuffle",
            kind: "shuffle" as const,
            bracket: "Solo Shuffle",
            zoneId: String(typedMatch.zoneId),
            startTime: syntheticShuffle.startTime,
            endTime: syntheticShuffle.endTime,
            result: syntheticShuffle.result,
            storedAt: Date.now(),
          },
        ];
      },
      async rebuildIndex(): Promise<{ updated: number; failed: number }> {
        return { updated: 0, failed: 0 };
      },
      // Fixture mode has no main process: a rebuild never really runs, so
      // there are no progress events to push
      onRebuildProgress() {
        return () => {};
      },
      async reparse(): Promise<{ ok: boolean }> {
        return { ok: false };
      },
      async openDir(): Promise<boolean> {
        return false;
      },
      // The fixture has no raw.txt (and the trimmed doc has no lineIndex
      // either) → the deep link degrades to unavailable
      async rawLine(): Promise<{ line: string; fileLine: number } | null> {
        return null;
      },
      // Fixture mode has no main process, so export degrades to unavailable
      async exportImage(): Promise<{
        path: string;
        width: number;
        height: number;
      } | null> {
        return null;
      },
      async get(id: string): Promise<unknown | null> {
        if (id === "fixture-match") {
          return {
            schemaVersion: 1,
            kind: "match",
            data: typedMatch,
          };
        }
        if (id === "fixture-shuffle") {
          return {
            schemaVersion: 1,
            kind: "shuffle",
            data: syntheticShuffle,
          };
        }
        return null;
      },
      async page(opts: {
        before?: number;
        limit: number;
      }): Promise<StoredMatchMeta[]> {
        const all = await gladlogMock.matches.list();
        const filtered =
          opts.before == null
            ? all
            : all.filter((mt) => mt.startTime < opts.before!);
        return filtered
          .sort((a, b) => b.startTime - a.startTime)
          .slice(0, opts.limit);
      },
    },
    settings: {
      async get(): Promise<GladlogSettings> {
        return currentSettings;
      },
      async save(partial: Partial<GladlogSettings>): Promise<GladlogSettings> {
        currentSettings = { ...currentSettings, ...partial };
        return currentSettings;
      },
    },
    app: {
      async getVersion(): Promise<string> {
        return "fixture";
      },
      async selectDirectory(): Promise<string | null> {
        return null;
      },
      async openExternal(): Promise<void> {
        return undefined;
      },
      async saveTextFile(): Promise<string | null> {
        return null;
      },
    },
    // Developer page, AI-calls section: two deterministic records so the
    // visual baseline has something to capture
    debug: {
      async aiCalls() {
        return [
          {
            kind: "analysis" as const,
            matchId: "fixture-match",
            at: Date.now(),
            model: "claude-opus-5",
            prompt: "（fixture）分析请求 prompt 正文…",
            raw: '{"findings":[]}',
          },
          {
            kind: "compare" as const,
            matchId: "fixture-shuffle",
            at: Date.now() - 60_000,
            model: "claude-sonnet-5",
            prompt: "（fixture）对比请求 prompt 正文…",
            raw: '{"report":"…"}',
          },
        ];
      },
    },
    icon: {
      async get(): Promise<string | null> {
        return null;
      },
    },
    // Fixed return value: visual baselines must be deterministic, so never
    // probe the real machine
    ai: {
      async detectCli(): Promise<{ path: string | null }> {
        return { path: "/usr/local/bin/claude" };
      },
    },
    analysis: {
      async getCached(): Promise<unknown> {
        return sampleAnalysis;
      },
      /** This is what the panel actually reads (the cache and the running
       *  flag are read atomically in one call). Without it the panel swallows
       *  the error and sits idle — no finding shows up in the fixture
       *  preview. */
      async getState(): Promise<unknown> {
        return { cached: sampleAnalysis, running: false };
      },
      async getFlags(): Promise<Record<string, string>> {
        return {};
      },
      async setFlag(): Promise<Record<string, string>> {
        return {};
      },
      async deepen(): Promise<void> {},
      async analyzeWindow() {
        return { status: "no-client" as const };
      },
      async notebook(): Promise<unknown[]> {
        return [
          {
            category: "目标选择",
            count: 2,
            recurring: 1,
            done: 0,
            entries: [
              {
                matchId: "fixture-1",
                flagKey: "k1",
                flag: "recurring",
                title: "爆发打进减伤",
                explanation: "开大时目标挂着 40% 减伤墙。",
                severity: "high",
                startTime: Date.now() - 86_400_000,
                zoneId: "1505",
                result: "Loss",
                bracket: "3v3",
              },
              {
                matchId: "fixture-1",
                flagKey: "k2",
                flag: null,
                title: "脱火过多",
                explanation: "击杀窗口内 40% 伤害打在副目标。",
                severity: "med",
                startTime: Date.now() - 172_800_000,
                zoneId: "980",
                result: "Win",
                bracket: "3v3",
              },
            ],
          },
        ];
      },
      run() {},
      cancel() {},
      onDone: off,
      onError: off,
    },
    compare: {
      async getCached(): Promise<unknown> {
        return sampleCompare;
      },
      run() {},
      cancel() {},
      onDelta: off,
      onDone: off,
      onError: off,
    },
    // Coach chat card: without a chat surface bridge().chat.getState throws and
    // CoachChatCard renders null, so the card has been outside every visual/axe
    // scene since it landed (2026-08-02) — the report-ai baseline could not
    // capture it at all. This stubs a ready state with two turns so the baseline
    // covers the bubble layout and the input row, and axe can reach the form
    // controls inside (the unlabelled textarea slipped through exactly here).
    chat: {
      async getState(): Promise<unknown> {
        return {
          status: "ready",
          backend: "claudeCli",
          model: "claude-opus-5",
          messages: [
            { role: "user", content: "第二轮我为什么会被秒?", at: 0 },
            {
              role: "assistant",
              content:
                "0:36 那波 Frozen Orb 落地后你还站在原地读了一次治疗,盾也没提前给。下次看到法师交 Frozen Orb 先拉视线再补。",
              at: 0,
            },
          ],
          busy: false,
        };
      },
      async send(): Promise<unknown> {
        return { status: "ok", reply: "(fixture 桩:不真调模型)" };
      },
      async cancel(): Promise<void> {},
    },
  };

  // Assign mock to window
  window.__gladlogFixture = gladlogMock as any;
}
