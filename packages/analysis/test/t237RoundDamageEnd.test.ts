/**
 * Pipeline T237 (user rulings R111, R117): the burst readers stop at the round's
 * end — `roundEndMs`, a Solo Shuffle round's deciding death — not at the
 * combat's end ~2 s later. The death that ends the round is pressure of its
 * own second, so the window it happened in runs up to it.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  boundBurstWindow,
  markRoundEndingDeathSecond,
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

describe("markRoundEndingDeathSecond", () => {
  it("友方的死亡就是回合结束:那一秒算有压力", () => {
    const m = new Map<number, number>([[86, 0.2]]);
    markRoundEndingDeathSecond(m, [player([DEATH])], T0, DEATH);
    expect(m.get(87)).toBe(Infinity);
    expect(m.get(86)).toBe(0.2);
  });
  it("回合结束的死亡是对面的,或者没有回合结束:不标", () => {
    const m = new Map<number, number>();
    markRoundEndingDeathSecond(m, [player([])], T0, DEATH);
    markRoundEndingDeathSecond(m, [player([DEATH])], T0, undefined);
    // a friendly death that is not the round's end (3v3)
    markRoundEndingDeathSecond(m, [player([DEATH - 5_000])], T0, DEATH);
    expect(m.size).toBe(0);
  });
  it("605 s2 22-4:被截短的第 87 秒凑不够下限,窗口仍然开到这次死亡", () => {
    const cast = { playerName: "Mage", spellId: "84714", castSeconds: 56.2 };
    const window = {
      fromSeconds: 56.2,
      toSeconds: 89,
      activeCDs: [cast],
    } as never;
    const facts = new Map([
      ["Mage|84714|56.2", { buffEndSeconds: 89 }],
    ]) as never;
    const perSecond = () => {
      const m = new Map<number, number>();
      for (let s = 56; s <= 86; s++) m.set(s, 0.1);
      m.set(87, 0.01); // 87.0 – 87.199 s only
      return m;
    };
    const cut = perSecond();
    const segOf = (m: Map<number, number>) =>
      boundBurstWindow(window, facts, m);
    expect(segOf(cut)[0]!.toSeconds).toBe(86);
    markRoundEndingDeathSecond(cut, [player([DEATH])], T0, DEATH);
    const after = segOf(cut);
    expect(after[0]!.toSeconds).toBe(87);
  });
});
