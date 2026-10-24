import { describe, expect, it } from "vitest";

import { laggingMaxHpCorrected } from "../src/maxHpLag";

const s = (timestamp: number, hp: number, maxHp: number) => ({
  timestamp,
  hp,
  maxHp,
});

describe("laggingMaxHpCorrected (fact4 D13 / D14 / D50)", () => {
  it("a bear form exit: the rows on the old max after current HP rescaled read the new max", () => {
    const rows = [
      s(0, 1_607_106, 1_644_592),
      s(50, 1_239_524, 1_644_592), // rescaled, max not yet: 75.4 %
      s(150, 1_245_000, 1_644_592),
      s(310, 1_251_259, 1_265_069), // max caught up: 98.9 %
    ];
    expect(laggingMaxHpCorrected(rows)).toEqual([
      1_644_592, 1_265_069, 1_265_069, 1_265_069,
    ]);
  });
  it("a max-HP buff falling off (Ursine Vigor): 87 % at full HP becomes 100 %", () => {
    const rows = [
      s(0, 1_265_069, 1_265_069),
      s(10, 1_100_060, 1_265_069),
      s(60, 1_100_060, 1_100_060),
    ];
    expect(laggingMaxHpCorrected(rows)).toEqual([
      1_265_069, 1_100_060, 1_100_060,
    ]);
  });
  it("a real hit before a max change is no lag: the jump is not the max ratio", () => {
    const rows = [
      s(0, 1_000_000, 1_000_000),
      s(50, 600_000, 1_000_000), // −40 %, the max later moves −10 %
      s(200, 600_000, 900_000),
    ];
    expect(laggingMaxHpCorrected(rows)).toEqual([1_000_000, 1_000_000, 900_000]);
  });
  it("a jump more than MAX_HP_LAG_MS before the max change is not paired", () => {
    const rows = [
      s(0, 1_000_000, 1_000_000),
      s(50, 900_000, 1_000_000),
      s(2_000, 900_000, 900_000),
    ];
    expect(laggingMaxHpCorrected(rows)).toEqual([1_000_000, 1_000_000, 900_000]);
  });
});

describe("laggingMaxHpCorrected — a real heal or hit is no lag (codex 20-F17-03 #1)", () => {
  it("the max-change row's own HP moving by the ratio: the rescale is there", () => {
    // 5c48e842 r1 127.4 s: a 73,971 heal to full, then cur and max both ×1.10
    const rows = [
      s(127_000, 669_809, 743_780),
      s(127_402, 743_780, 743_780),
      s(127_680, 818_158, 818_158),
    ];
    expect(laggingMaxHpCorrected(rows)).toEqual([
      743_780, 743_780, 818_158,
    ]);
  });
  it("a jump the unit's logged heals add up to stays", () => {
    const rows = [
      s(0, 669_809, 743_780),
      s(400, 743_780, 743_780),
      s(600, 743_780, 818_158), // the max moves alone (no rescale logged)
    ];
    const heal = [{ timestamp: 400, amount: 73_971 }];
    expect(laggingMaxHpCorrected(rows, heal)).toEqual([
      743_780, 743_780, 818_158,
    ]);
    // without the heal the same rows read as a lag run
    expect(laggingMaxHpCorrected(rows)).toEqual([743_780, 818_158, 818_158]);
  });
  it("a hit that does not add up keeps the lag reading (bear exit with a tick)", () => {
    const rows = [
      s(0, 1_607_106, 1_644_592),
      s(50, 1_239_524, 1_644_592),
      s(310, 1_251_259, 1_265_069),
    ];
    const hits = [{ timestamp: 50, amount: -12_000 }];
    expect(laggingMaxHpCorrected(rows, hits)).toEqual([
      1_644_592, 1_265_069, 1_265_069,
    ]);
  });
  it("codex 20-F17-05 #1：max 变化那一行的 HP 变动是一次记录在案的命中，不排除更早的滞后", () => {
    // max 1,000,000 → 900,000 (×0.9); the rescale at 50 ms (×0.9), and a
    // logged 90,000 hit on the max-change row that happens to be ×0.9 too
    const rows = [
      s(0, 1_000_000, 1_000_000),
      s(50, 900_000, 1_000_000), // rescaled, max not yet
      s(200, 810_000, 900_000), // the hit (−90,000 = ×0.9), max caught up
    ];
    const hits = [{ timestamp: 120, amount: -90_000 }];
    expect(laggingMaxHpCorrected(rows, hits)).toEqual([
      1_000_000, 900_000, 900_000,
    ]);
  });
  it("codex 20-F17-05 #2：中间一跳被记录在案的命中解释掉时，继续往前找真正的缩放", () => {
    const rows = [
      s(0, 1_000_000, 1_000_000),
      s(20, 909_091, 1_000_000), // the rescale (÷1.1)
      s(60, 826_446, 1_000_000), // a logged hit of the same ratio
      s(100, 826_446, 909_091), // max catches up
    ];
    const hits = [{ timestamp: 40, amount: -82_645 }];
    expect(laggingMaxHpCorrected(rows, hits)).toEqual([
      1_000_000, 909_091, 909_091, 909_091,
    ]);
  });
});
