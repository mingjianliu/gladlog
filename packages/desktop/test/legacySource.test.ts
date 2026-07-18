import { describe, expect, it } from "vitest";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import type { ReportSource } from "../src/renderer/src/report/derive/types";

describe("toLegacySafe memoization", () => {
  it("同一 source 两次调用返回同一实例，不同 source 不串", () => {
    const source1: ReportSource = {
      units: {
        "player1": {
          kind: "Player",
          name: "Alice",
          teamId: 0,
        } as any,
      },
      events: [],
      winningTeamId: 0,
      playerId: "player1",
      arenaId: "arena1",
      startTime: 0,
      endTime: 100,
      duration: 100,
      bracket: "3v3",
    } as any;

    const source2: ReportSource = {
      units: {
        "player2": {
          kind: "Player",
          name: "Bob",
          teamId: 1,
        } as any,
      },
      events: [],
      winningTeamId: 1,
      playerId: "player2",
      arenaId: "arena2",
      startTime: 0,
      endTime: 100,
      duration: 100,
      bracket: "3v3",
    } as any;

    const res1a = toLegacySafe(source1);
    const res1b = toLegacySafe(source1);
    const res2 = toLegacySafe(source2);

    expect(res1a).toBe(res1b);
    expect(res1a).not.toBe(res2);
    expect(res1a.winningTeamId).toBe("0");
    expect(res2.winningTeamId).toBe("1");
  });
});
