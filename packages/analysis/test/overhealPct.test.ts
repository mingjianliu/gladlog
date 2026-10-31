import { describe, expect, it } from "vitest";

import { computeHealingInWindow } from "../src/context/timelineHelpers";
import { overhealPct } from "../src/utils/cooldowns";

const heal = (
  ms: number,
  amount: number,
  effectiveAmount: number,
  petDest?: true,
): any => ({
  amount,
  effectiveAmount,
  ...(petDest ? { petDest } : {}),
  logLine: { timestamp: ms },
});

describe("fact7 D9: overheal share leaves pet heals out of both sides", () => {
  it("a pet row's zeroed effective amount is not overheal", () => {
    expect(overhealPct([heal(0, 100, 50), heal(0, 900, 0, true)])).toBe(50);
  });
  it("no row on a player: 0", () => {
    expect(overhealPct([heal(0, 900, 0, true)])).toBe(0);
  });
  it("a real full overheal on a player still counts", () => {
    expect(overhealPct([heal(0, 100, 0)])).toBe(100);
  });
  it("computeHealingInWindow prints the share over the window's rows", () => {
    const rows = [
      heal(10, 100, 50),
      heal(20, 900, 0, true),
      heal(5_000, 300, 300),
    ];
    expect(computeHealingInWindow(rows, 0, 100)?.overhealPct).toBe(50);
  });
});
