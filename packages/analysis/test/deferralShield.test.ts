import { describe, expect, test } from "vitest";

import { timeDilationPendingAt } from "../src/utils/deferralShield";

describe("timeDilationPendingAt — Time Dilation's take-back rule", () => {
  test("one absorb: eight equal ticks from 1 s after it", () => {
    const a = [{ tsMs: 0, amount: 800 }];
    expect(timeDilationPendingAt(a, 999)).toBe(800);
    expect(timeDilationPendingAt(a, 1000)).toBe(700);
    expect(timeDilationPendingAt(a, 4000)).toBe(400);
    expect(timeDilationPendingAt(a, 8000)).toBe(0);
  });

  test("a tick after a new absorb is pending / 8; one with none repeats the last", () => {
    // tick 1 at 1000: 800/8 = 100 → 700; absorb 900 at 1500 → 1600;
    // tick 2 at 2000: 1600/8 = 200 → 1400; tick 3 at 3000 repeats 200 → 1200
    const a = [
      { tsMs: 0, amount: 800 },
      { tsMs: 1500, amount: 900 },
    ];
    expect(timeDilationPendingAt(a, 2000)).toBe(1400);
    expect(timeDilationPendingAt(a, 3000)).toBe(1200);
    expect(timeDilationPendingAt(a, 9000)).toBe(0);
  });

  test("a logged episode (match 4d44c355, unit 7CB64D): pending after two ticks", () => {
    // the first second's 12 absorbs, then the 13 before the second tick; the
    // log's ticks were 8,101 and 18,003 — 126,010 still held back
    const first = [
      25597, 2695, 3317, 811, 3159, 42, 15372, 4153, 3092, 4270, 94, 2202,
    ];
    const second = [
      4003, 2640, 813, 42, 10151, 6034, 4288, 49048, 3656, 2181, 94, 1245, 3115,
    ];
    const a = [
      ...first.map((amount, i) => ({ tsMs: i * 60, amount })),
      ...second.map((amount, i) => ({ tsMs: 1100 + i * 60, amount })),
    ];
    const logged = 152114 - 8101 - 18003;
    expect(
      Math.abs(timeDilationPendingAt(a, 2000) - logged) / logged,
    ).toBeLessThan(0.001);
  });
});
