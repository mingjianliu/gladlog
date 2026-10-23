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
