/**
 * Triage 2026-09-29 sync-burst F-S2 / F-S6 / F-S7: the per-CD timing facts on
 * a `missed-sync-window` line (facts only — the verdict and gates unchanged).
 */
import { describe, expect, it } from "vitest";

import {
  enemyMinHpInWindow,
  syncReadyTimingFacts,
} from "../src/analysis/candidates/cooldownTiming";

const cd = (name: string, casts: number[], cooldownSeconds: number, charges = 1) =>
  ({
    spellId: name,
    spellName: name,
    casts: casts.map((timeSeconds) => ({ timeSeconds })),
    cooldownSeconds,
    neverUsed: casts.length === 0,
    charges,
  }) as never;

describe("syncReadyTimingFacts", () => {
  it("F-S2 pressedAfter: b711d4ac Kingsbane 0.28 s after the lock → +0.3s; a press past the 2 s lead is not listed", () => {
    const w = { fromSeconds: 226.7, toSeconds: 231.682 };
    expect(syncReadyTimingFacts(w, [cd("Kingsbane", [158.4, 231.959], 60)]).pressedAfter).toBe(
      "Kingsbane +0.3s",
    );
    expect(syncReadyTimingFacts(w, [cd("Kingsbane", [234.0], 60)]).pressedAfter).toBeUndefined();
  });

  it("F-S6 readyFrom: raw return, not the slack instant (e10c6bea +0.4, d692582c -0.8)", () => {
    expect(
      syncReadyTimingFacts({ fromSeconds: 205.815, toSeconds: 208.237 }, [
        cd("Kingsbane", [146.183], 60),
      ]).readyFrom,
    ).toBe("Kingsbane +0.4s");
    expect(
      syncReadyTimingFacts({ fromSeconds: 114.148, toSeconds: 118.98 }, [
        cd("Volley", [68.345], 45),
      ]).readyFrom,
    ).toBe("Volley -0.8s");
  });

  it("readyFrom is omitted for a CD back more than the 2 s lead before the lock, or never pressed", () => {
    const w = { fromSeconds: 33.572, toSeconds: 36.926 };
    expect(syncReadyTimingFacts(w, [cd("Avatar", [], 90)]).readyFrom).toBeUndefined();
    expect(syncReadyTimingFacts(w, [cd("Avatar", [-60], 90)]).readyFrom).toBeUndefined();
  });

  it("a 2-charge CD with a charge in hand has no readyFrom; with none, the next charge", () => {
    const w = { fromSeconds: 50, toSeconds: 55 };
    expect(syncReadyTimingFacts(w, [cd("X", [30], 30, 2)]).readyFrom).toBeUndefined();
    expect(syncReadyTimingFacts(w, [cd("X", [21, 22], 30, 2)]).readyFrom).toBe("X +1.0s");
  });
});

describe("enemyMinHpInWindow (F-S7)", () => {
  it("names whose reading the minimum was", () => {
    const enemies = [
      { id: "e1", name: "Ruñesmith" },
      { id: "e2", name: "Adriels" },
    ];
    const min = enemyMinHpInWindow(enemies, { startTime: 0 }, 10, 12, (u: any) =>
      u.id === "e2" ? 63 : 95,
    );
    expect(min).toEqual({ pct: 63, unitName: "Adriels" });
  });
});
