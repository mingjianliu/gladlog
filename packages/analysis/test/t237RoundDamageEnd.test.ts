/**
 * Pipeline T237 (user ruling R111): the burst readers stop at the round's
 * end — `roundEndMs`, a Solo Shuffle round's deciding death — not at the
 * combat's end ~2 s later. The round's last second is cut short there and is
 * read as a rate over the part of it the round lasted.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  boundBurstWindow,
  rateRoundEndingSecond,
} from "../src/analysis/burstWindowDecisionPoints";
import { ensureAnalysisData } from "../src/data/ensure";
import { roundDamageEndMs, SOLO_SHUFFLE_BRACKET } from "../src/utils/roundEnd";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const DEATH = T0 + 87_199;
const player = (deaths: number[]) => ({
  info: {},
  deathRecords: deaths.map((timestamp) => ({ timestamp })),
});

describe("roundDamageEndMs", () => {
  it("单排:止于决定胜负的死亡,不是两秒后的日志结束", () => {
    expect(
      roundDamageEndMs({
        endTime: DEATH + 2_000,
        startInfo: { bracket: SOLO_SHUFFLE_BRACKET },
        units: { a: player([DEATH]), b: player([]) },
      }),
    ).toBe(DEATH);
  });
  it("其他赛制止于日志结束;日志先于死亡行结束时不越过日志", () => {
    expect(
      roundDamageEndMs({
        endTime: DEATH + 2_000,
        startInfo: { bracket: "3v3" },
        units: { a: player([DEATH]) },
      }),
    ).toBe(DEATH + 2_000);
    expect(
      roundDamageEndMs({
        endTime: DEATH - 500,
        startInfo: { bracket: SOLO_SHUFFLE_BRACKET },
        units: { a: player([DEATH]) },
      }),
    ).toBe(DEATH - 500);
  });
});

describe("rateRoundEndingSecond", () => {
  it("回合的最后一秒被截短:按回合实际占的那部分折成每秒速率", () => {
    const m = new Map<number, number>([
      [86, 0.2],
      [87, 0.01],
    ]);
    rateRoundEndingSecond(m, T0, DEATH);
    // 87.000 – 87.199 s: 200 ms of the second
    expect(m.get(87)).toBeCloseTo(0.05, 9);
    expect(m.get(86)).toBe(0.2);
  });
  it("那一秒没有伤害、没有回合结束、回合恰好占满一秒:不动", () => {
    const m = new Map<number, number>([[86, 0.2]]);
    rateRoundEndingSecond(m, T0, DEATH);
    rateRoundEndingSecond(m, T0, undefined);
    rateRoundEndingSecond(m, T0, T0 + 86_999);
    expect([...m]).toEqual([[86, 0.2]]);
  });
  it("605 s2 22-4:被截短的第 87 秒按速率过下限,窗口开到这次死亡", () => {
    const cast = { playerName: "Mage", spellId: "84714", castSeconds: 56.2 };
    const window = {
      fromSeconds: 56.2,
      toSeconds: 89,
      activeCDs: [cast],
    } as never;
    const facts = new Map([
      ["Mage|84714|56.2", { buffEndSeconds: 89 }],
    ]) as never;
    const perSecond = (last: number) => {
      const m = new Map<number, number>();
      for (let s = 56; s <= 86; s++) m.set(s, 0.1);
      m.set(87, last); // 87.0 – 87.199 s only
      return m;
    };
    const segOf = (m: Map<number, number>) =>
      boundBurstWindow(window, facts, m);
    const cut = perSecond(0.01);
    expect(segOf(cut)[0]!.toSeconds).toBe(86);
    rateRoundEndingSecond(cut, T0, DEATH);
    expect(segOf(cut)[0]!.toSeconds).toBe(87);
    // 605 s2 22-2: a last second too light even as a rate stays outside
    const light = perSecond(0.004);
    rateRoundEndingSecond(light, T0, DEATH);
    expect(segOf(light)[0]!.toSeconds).toBe(86);
  });
});
