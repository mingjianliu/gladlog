/**
 * The two occurrence picks of the T94 scan checks (codex 85-tk-I-T94-1 #1,
 * #2): which ledger overlap a printed item means, and which application an
 * `already up` defensive means.
 */
import { describe, expect, it } from "vitest";

import {
  alreadyUpApplication,
  ledgerOverlapsOfItem,
} from "../scripts/scan5/t94Picks";

describe("ledgerOverlapsOfItem", () => {
  // Soul Immolation [11, 14.04] and [14.04, 17.08]: both print `3.0s` on
  // the same target. Taking either let the second's clean sum clear the
  // first's corrupted figure.
  const first = { from: 11, to: 14.04 };
  const second = { from: 14.04, to: 17.08 };

  it("同一行里印得一样的两项:第 n 项对账本里的第 n 条", () => {
    expect(ledgerOverlapsOfItem([first, second], 0, 2)).toEqual([first]);
    expect(ledgerOverlapsOfItem([first, second], 1, 2)).toEqual([second]);
  });

  it("只有一条、或行与账本数目对不上:保持原来的读法(全部)", () => {
    expect(ledgerOverlapsOfItem([first], 0, 1)).toEqual([first]);
    expect(ledgerOverlapsOfItem([first, second], 0, 1)).toEqual([
      first,
      second,
    ]);
    expect(ledgerOverlapsOfItem([], 0, 1)).toEqual([]);
  });
});

describe("alreadyUpApplication", () => {
  const up = (fromS: number, toS: number) => ({
    timestamp: fromS * 1000,
    endMs: toS * 1000,
  });

  it("这一秒开始时还在身上的那次就是 already up 的那次,同一秒里后来又上的不算", () => {
    // Vanish up from 77.9, ended by an action at 78.3, re-applied 78.8;
    // the burst's second is 78
    const applies = [up(77.9, 78.3), up(78.8, 81.8)];
    expect(alreadyUpApplication(applies, 78_000)).toBe(applies[0]);
  });

  it("这一秒开始时身上没有:取这一秒里第一次上的(1:18.448,爆发 1:18.768 开)", () => {
    // the press of a minute before had ended long ago
    const applies = [up(18.2, 21), up(78.448, 79.7)];
    expect(alreadyUpApplication(applies, 78_000)).toBe(applies[1]);
  });

  it("上一次按的日志里没有结束行:它的结束是持有者自己出手的那一刻,不算还在身上", () => {
    // Greater Invisibility logs no REMOVED on an unseen mage: pressed
    // 1:39, the mage's next own action 1:41.6; pressed again 2:41.448
    const applies = [up(99, 101.6), up(161.448, 162.7)];
    expect(alreadyUpApplication(applies, 161_000)).toBe(applies[1]);
  });

  it("这一秒开始时没有、这一秒里也没上过:没有这样的一次", () => {
    expect(
      alreadyUpApplication([up(18.2, 21), up(79.5, 82)], 78_000),
    ).toBeUndefined();
  });

  it("这一秒里上了两次:取第一次", () => {
    const applies = [up(78.1, 78.3), up(78.8, 81)];
    expect(alreadyUpApplication(applies, 78_000)).toBe(applies[0]);
  });
});
