/**
 * User ruling R103 (pipeline T234): a burst window under the 8 s it is judged
 * over is still judged when the pressured unit itself died inside it at
 * least 3 s after it opened.
 */
import { describe, expect, it } from "vitest";

import {
  BURST_WINDOW_MIN_JUDGED_DEATH_S,
  BURST_WINDOW_MIN_JUDGED_S,
  burstWindowLongEnoughToJudge,
} from "../src/analysis/candidates/burstWindowResponse";

const point = (durationSec: number, diedAfterSec?: number) =>
  ({
    tSec: 145,
    endSec: 145 + durationSec,
    durationSec,
    pressured:
      diedAfterSec === undefined
        ? { died: false }
        : { died: true, diedSec: 145 + diedAfterSec },
  }) as never;

describe("burstWindowLongEnoughToJudge", () => {
  it("两个数:8 秒的窗口,3 秒的死亡下限", () => {
    expect(BURST_WINDOW_MIN_JUDGED_S).toBe(8);
    expect(BURST_WINDOW_MIN_JUDGED_DEATH_S).toBe(3);
  });
  it("够 8 秒的窗口照旧判,不看有没有人死", () => {
    expect(burstWindowLongEnoughToJudge(point(8))).toBe(true);
    expect(burstWindowLongEnoughToJudge(point(12, 1))).toBe(true);
  });
  it("不够 8 秒、没人死:不判(原规则)", () => {
    expect(burstWindowLongEnoughToJudge(point(6))).toBe(false);
  });
  it("受压单位在窗口里死了,开场后 4 秒:判(605 的 Ascendance 例子)", () => {
    expect(burstWindowLongEnoughToJudge(point(4, 4))).toBe(true);
  });
  it("开场后正好 3 秒死:判;2 秒死:不判", () => {
    expect(burstWindowLongEnoughToJudge(point(5, 3))).toBe(true);
    expect(burstWindowLongEnoughToJudge(point(5, 2))).toBe(false);
  });
  it("死在窗口结束之后(8 秒结果期内、窗口外):窗口不是被这次死亡截短的,不判", () => {
    expect(burstWindowLongEnoughToJudge(point(4, 6))).toBe(false);
  });
});
