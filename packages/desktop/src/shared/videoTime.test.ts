import { describe, expect, it } from "vitest";

import {
  computeVideoWindow,
  PRE_ROLL_S,
  seekTargetS,
  toBattleSeconds,
  toVideoSeconds,
} from "./videoTime";

const T0 = 1_750_000_000_000;

/** lagS > 0 表示录像起点晚于开场 lagS 秒(一期的常态,也是那个 bug 的现场)。 */
function win(lagS: number, durationS = 600) {
  return computeVideoWindow({
    matchStartMs: T0,
    matchEndMs: T0 + 300_000,
    recordingStartedAtMs: T0 + lagS * 1000,
    durationS,
  });
}

describe("computeVideoWindow", () => {
  it("录像晚于开场:offsetS 为负且不再被 clamp 成 0", () => {
    const w = win(10);
    expect(w.offsetS).toBe(-10);
    expect(w.missingHeadS).toBe(10);
    expect(w.headroomS).toBe(-10); // 带符号 —— 设计文档 §9.1 的基线就是负的
  });

  it("录像早于开场(二期目标):offsetS 与 headroomS 同为正", () => {
    const w = win(-5);
    expect(w.offsetS).toBe(5);
    expect(w.headroomS).toBe(5);
    expect(w.missingHeadS).toBe(0);
  });

  it("windowStartS 允许回滚到开场之前,但不越过视频 0", () => {
    expect(win(-20).windowStartS).toBe(20 - PRE_ROLL_S);
    expect(win(-1).windowStartS).toBe(0);
    expect(win(10).windowStartS).toBe(0);
  });

  it("windowEndS 被实际时长夹住,且永不小于 windowStartS", () => {
    expect(win(-5, 600).windowEndS).toBe(305);
    expect(win(-5, 100).windowEndS).toBe(100);
    expect(win(-5, 0).windowEndS).toBe(305); // 时长未知不夹
    const degenerate = computeVideoWindow({
      matchStartMs: T0,
      matchEndMs: T0 + 1000,
      recordingStartedAtMs: T0 - 500_000,
      durationS: 10,
    });
    expect(degenerate.windowEndS).toBeGreaterThanOrEqual(
      degenerate.windowStartS,
    );
  });

  it("本场整段落在录像结束之后 → noFootage", () => {
    expect(win(-5, 600).noFootage).toBe(false);
    expect(win(-1000, 600).noFootage).toBe(true);
    expect(win(-1000, 0).noFootage).toBe(false); // 时长未知时不下结论
  });
});

describe("换算(设计文档 §9.2 的判据)", () => {
  it("缺头 lag 秒时,战斗秒 b 对应的视频秒必须是 b − lag", () => {
    for (const lag of [2, 10, 25]) {
      const w = win(lag);
      for (const b of [0, 30, 120]) {
        expect(toVideoSeconds(b, w.offsetS)).toBe(b - lag);
      }
    }
  });

  it("有头 head 秒时,战斗秒 b 对应的视频秒必须是 b + head", () => {
    expect(toVideoSeconds(60, win(-8).offsetS)).toBe(68);
  });

  it("lag === 0 时(录像与开场同时开始)必须是恒等 -- 不能只靠往返恒等测出来,那对任意 offsetS 都成立", () => {
    expect(toVideoSeconds(60, win(0).offsetS)).toBe(60);
  });

  it("往返恒等", () => {
    for (const lag of [-8, 0, 12]) {
      const w = win(lag);
      for (const b of [0, 17.5, 240]) {
        expect(toBattleSeconds(toVideoSeconds(b, w.offsetS), w.offsetS)).toBe(
          b,
        );
      }
    }
  });
});

describe("seekTargetS", () => {
  it("默认回滚 PRE_ROLL_S 秒", () => {
    expect(seekTargetS(60, win(-20))).toBe(60 + 20 - PRE_ROLL_S);
  });

  it("preRoll:false 时精确落点", () => {
    expect(seekTargetS(60, win(-20), { preRoll: false })).toBe(80);
  });

  it("回滚不越过窗口下限", () => {
    expect(seekTargetS(0, win(-1))).toBe(0);
  });

  it("越过窗口上限时夹住", () => {
    const w = win(-5, 600);
    expect(seekTargetS(99_999, w)).toBe(w.windowEndS);
  });

  it("缺头场景:战斗前 lag 秒内的时刻全部落到窗口下限", () => {
    const w = win(10);
    expect(seekTargetS(3, w)).toBe(0);
    expect(seekTargetS(60, w)).toBe(60 - 10 - PRE_ROLL_S);
  });
});
