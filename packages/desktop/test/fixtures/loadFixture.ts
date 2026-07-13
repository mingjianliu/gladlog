import { readFileSync } from "fs";

import type {
  StoredMatch,
  StoredShuffle,
  StoredShuffleRound,
} from "../../src/renderer/src/report/derive/types";

export function loadMatchFixture(): StoredMatch {
  const base = import.meta.url;
  return JSON.parse(
    readFileSync(new URL("report-match.json", base).pathname, "utf-8"),
  ) as StoredMatch;
}

/**
 * 真实 3v3 比赛(纳格兰,胜)——已裁剪到前 90 秒 + 匿名化(角色名/GUID → 通用名)、
 * 去掉渲染用不到的事件数组(actionsIn/Out、healIn、absorbsIn)与原始 params。
 * 用于用真实走位/技能数据检验渲染(meter/时间轴/单位详情/回放)。
 */
export function loadRealMatchFixture(): StoredMatch {
  const base = import.meta.url;
  return JSON.parse(
    readFileSync(new URL("real-match-sample.json", base).pathname, "utf-8"),
  ) as StoredMatch;
}

export function buildSyntheticShuffle(base: StoredMatch): StoredShuffle {
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
