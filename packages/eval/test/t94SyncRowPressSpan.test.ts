/**
 * scan5/fact10 pressInsideLockNotEntered (pipeline T94): whether a ruled
 * button's press contradicts a `missed-sync-window` row is the producer's own
 * "entered" test (`castEntersWindow`) on the producer's own lock of the row's
 * healer — not the row's floored seconds, and not a fixed press interval.
 */
import { SYNC_ENTER_LEAD_S } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { describe, expect, it } from "vitest";

import {
  type ISyncRowLock,
  syncRowLock,
  syncRowPressEnters,
} from "../scripts/scan5/fact10";

const START = 1_000_000;
/** a press of a button with no buff length and no cast bar */
const pressAt = (
  s: number,
  row: { t: number; endT: number; healer?: string },
  locks: readonly ISyncRowLock[],
  owner: unknown = {},
  spellId = "0",
) => syncRowPressEnters({ spellId, owner, timeSeconds: s }, START, row, locks);

describe("scan5/fact10 syncRowPressEnters", () => {
  it("锁从 242.829 开始:提前 2.258 秒的按键不算进锁,提前 2 秒以内的算", () => {
    const locks = [{ fromSeconds: 242.829, toSeconds: 245.9 }];
    const row = { t: 242, endT: 245 };
    expect(pressAt(240.571, row, locks)).toBe(false);
    expect(pressAt(242.829 - SYNC_ENTER_LEAD_S, row, locks)).toBe(true);
    expect(pressAt(244, row, locks)).toBe(true);
  });

  it("锁在 162.595 结束:结束后 0.234 秒的按键不算,结束那一毫秒的算", () => {
    const locks = [{ fromSeconds: 157.2, toSeconds: 162.595 }];
    const row = { t: 157, endT: 162 };
    expect(pressAt(162.829, row, locks)).toBe(false);
    expect(pressAt(162.595, row, locks)).toBe(true);
  });

  it("按起始秒找锁:别的锁不被拿来用;被回合结束截短的锁也认", () => {
    const locks = [
      { fromSeconds: 60.4, toSeconds: 64.1 },
      { fromSeconds: 157.2, toSeconds: 170.3 },
    ];
    // the row's end second is the round's end (165), the raw lock runs on
    expect(syncRowLock(157, 165, undefined, locks)).toBe(locks[1]);
    expect(pressAt(169, { t: 157, endT: 165 }, locks)).toBe(true);
    expect(
      pressAt(157.2 - SYNC_ENTER_LEAD_S - 0.01, { t: 157, endT: 165 }, locks),
    ).toBe(false);
  });

  it("找不到生产方的锁时退回行上的整秒,取最宽的读法", () => {
    const row = { t: 242, endT: 245 };
    expect(syncRowLock(242, 245, undefined, [])).toBeUndefined();
    expect(pressAt(240.571, row, [])).toBe(true);
    expect(pressAt(245.9, row, [])).toBe(true);
    expect(pressAt(239.9, row, [])).toBe(false);
    expect(pressAt(246.1, row, [])).toBe(false);
  });

  // codex 85-tk-I-T94-1 #4: two healers locked in the same second
  it("同一秒两个治疗各有一把锁:按行上的治疗名认锁,另一把更长的不被拿来用", () => {
    const locks = [
      { fromSeconds: 100.1, toSeconds: 106.1, healerName: "A" },
      { fromSeconds: 100.8, toSeconds: 103.8, healerName: "B" },
    ];
    const rowB = { t: 100, endT: 103, healer: "B" };
    expect(syncRowLock(100, 103, "B", locks)).toBe(locks[1]);
    // a press at 104 is outside B's lock (inside A's)
    expect(pressAt(104, rowB, locks)).toBe(false);
    expect(pressAt(104, { t: 100, endT: 106, healer: "A" }, locks)).toBe(true);
    // without a name the exact rendered end still picks the right one
    expect(syncRowLock(100, 103, undefined, locks)).toBe(locks[1]);
  });

  // codex 85-tk-I-T94-1 #3: the producer's test has an active-span branch
  // and a cast-bar branch; a fixed press interval has neither
  it("提前 2.1 秒按下、锁开始时还在生效的技能算进锁(生产方的 activeIn)", () => {
    const locks = [{ fromSeconds: 100.2, toSeconds: 103.7, healerName: "H" }];
    const row = { t: 100, endT: 103, healer: "H" };
    // Ravager 228920: 12 s for a holder without talents that change it
    const warrior = { spec: "71", info: { talents: [], pvpTalents: [] } };
    expect(pressAt(98.1, row, locks, warrior, "228920")).toBe(true);
    // a press that had run out before the lock is not in it
    expect(pressAt(80, row, locks, warrior, "228920")).toBe(false);
    // a button with no buff length is the press instant only
    expect(pressAt(98.1, row, locks)).toBe(false);
  });

  it("读条在锁内开始、锁结束后才读完的技能算进锁(生产方的读条起点)", () => {
    const locks = [{ fromSeconds: 160, toSeconds: 167.143 }];
    const row = { t: 160, endT: 167 };
    const owner = {
      castStartEvents: [{ spellId: "265187", timestamp: START + 166_724 }],
    };
    expect(pressAt(167.861, row, locks, owner, "265187")).toBe(true);
    expect(pressAt(167.861, row, locks, {}, "265187")).toBe(false);
  });
});
