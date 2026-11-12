/**
 * scan5/fact10 pressInsideLockNotEntered (pipeline T94): the span a ruled
 * button's press must fall in to contradict a `missed-sync-window` row is the
 * producer's own — its raw lock and `SYNC_ENTER_LEAD_S` — not the row's
 * floored seconds.
 */
import { SYNC_ENTER_LEAD_S } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { describe, expect, it } from "vitest";

import { syncRowPressSpanMs } from "../scripts/scan5/fact10";

const START = 1_000_000;
const inside = (span: { from: number; to: number }, s: number) =>
  START + s * 1000 >= span.from && START + s * 1000 < span.to;

describe("scan5/fact10 syncRowPressSpanMs", () => {
  it("锁从 242.829 开始:提前 2.258 秒的按键不算进锁,提前 2 秒以内的算", () => {
    const span = syncRowPressSpanMs(START, 242, 245, [
      { fromSeconds: 242.829, toSeconds: 245.9 },
    ]);
    expect(inside(span, 240.571)).toBe(false);
    expect(inside(span, 242.829 - SYNC_ENTER_LEAD_S)).toBe(true);
    expect(inside(span, 244)).toBe(true);
  });

  it("锁在 162.595 结束:结束后 0.234 秒的按键不算,结束那一毫秒的算", () => {
    const span = syncRowPressSpanMs(START, 157, 162, [
      { fromSeconds: 157.2, toSeconds: 162.595 },
    ]);
    expect(inside(span, 162.829)).toBe(false);
    expect(inside(span, 162.595)).toBe(true);
  });

  it("按起始秒找锁:别的锁不被拿来用;被回合结束截短的锁也认", () => {
    const locks = [
      { fromSeconds: 60.4, toSeconds: 64.1 },
      { fromSeconds: 157.2, toSeconds: 170.3 },
    ];
    // the row's end second is the round's end (165), the raw lock runs on
    const span = syncRowPressSpanMs(START, 157, 165, locks);
    expect(span.from).toBe(START + (157.2 - SYNC_ENTER_LEAD_S) * 1000);
    expect(inside(span, 169)).toBe(true);
  });

  it("找不到生产方的锁时退回行上的整秒,取最宽的读法", () => {
    const span = syncRowPressSpanMs(START, 242, 245, []);
    expect(span).toEqual({
      from: START + (242 - SYNC_ENTER_LEAD_S) * 1000,
      to: START + 246 * 1000,
    });
    expect(inside(span, 240.571)).toBe(true);
  });
});
