import type { StoredMatch, StoredShuffle, StoredShuffleRound } from "./report/derive/types";
import type { GladlogSettings } from "../../main/settingsStore";
import type { StoredMatchMeta } from "../../main/matchStore";
import type { LogsStatusSnapshot } from "../../preload/api";
import matchJson from "../../../test/fixtures/report-match.json";

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
  };

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
  };

  // Assign mock to window
  window.__gladlogFixture = gladlogMock as any;
}
