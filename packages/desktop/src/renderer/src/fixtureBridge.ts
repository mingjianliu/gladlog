import matchJson from "../../../test/fixtures/report-match.json";
import type { StoredMatchMeta } from "../../main/matchStore";
import type { GladlogSettings } from "../../main/settingsStore";
import type { LogsStatusSnapshot } from "../../preload/api";
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
    startTime: base.startTime, // 不平移:事件时间戳未移,保持自洽
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
    anthropicModel: null,
    aiBackend: "anthropic",
    aiBackendCommand: null,
  };

  // 让 AI 视图在 fixture 预览下有内容(findings 卡片 + cohort 对比)。
  const sampleAnalysis = {
    findings: [
      {
        eventIds: ["e1"],
        severity: "high",
        category: "survival",
        title: "被集火秒杀",
        explanation:
          "敌方双 DPS 进攻 CD 对齐时,你在没有减伤/位移的情况下于 1.4s 内掉血 82% 后阵亡;此前贴在开阔地带、离掩体较远。",
      },
      {
        eventIds: ["e2"],
        severity: "med",
        category: "cooldowns",
        title: "防御 CD 留手",
        explanation:
          "整场保留了一个大防御 CD 未用即阵亡——上一段承伤窗口本应交出以打断集火节奏。",
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
    },
    icon: {
      async get(): Promise<string | null> {
        return null;
      },
    },
    analysis: {
      async getCached(): Promise<unknown> {
        return sampleAnalysis;
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
  };

  // Assign mock to window
  window.__gladlogFixture = gladlogMock as any;
}
