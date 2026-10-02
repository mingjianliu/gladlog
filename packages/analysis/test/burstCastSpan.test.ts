/**
 * `burstCastSpan` — the one "how long is this cooldown running" predicate
 * (triage 2026-09-29 kick-eaten F-K1 + sync-burst F-L3, user ruling A14 = B,
 * 2026-09-30: no 10 s floor, for every consumer).
 */
import { describe, expect, it } from "vitest";

import {
  burstCastSpan,
  formatBurstLedgerForContext,
  type IBurstLedgerEntry,
} from "../src/utils/burstLedger";

describe("burstCastSpan", () => {
  it("runs from the cast to the end of its buff — a 4 s buff is 4 s, not 10", () => {
    expect(
      burstCastSpan({ castTimeSeconds: 55.8, buffEndSeconds: 59.8 }),
    ).toEqual({ from: 55.8, to: 59.8 });
  });

  it("a cooldown with no tracked buff is a zero-length span, running for nobody", () => {
    const s = burstCastSpan({ castTimeSeconds: 40, buffEndSeconds: 40 });
    expect(s).toEqual({ from: 40, to: 40 });
    // the "already running at t" test every consumer uses
    const running = (t: number) => s.from <= t && s.to > t;
    expect(running(40)).toBe(false);
    expect(running(40.5)).toBe(false);
  });

  it("an observed end before the cast never makes a negative span", () => {
    expect(
      burstCastSpan({ castTimeSeconds: 40, buffEndSeconds: 39.2 }),
    ).toEqual({ from: 40, to: 40 });
  });

  it("a long buff keeps its full length", () => {
    expect(burstCastSpan({ castTimeSeconds: 10, buffEndSeconds: 30 }).to).toBe(
      30,
    );
  });
});

describe("burst ledger: a zero-length burst", () => {
  const burst = (
    fromSeconds: number,
    toSeconds: number,
  ): IBurstLedgerEntry => ({
    fromSeconds,
    toSeconds,
    spells: [
      {
        spellId: "6353",
        spellName: "Soul Fire",
        castTimeSeconds: 40,
        spanToSeconds: toSeconds,
      },
    ],
    totalDamage: 0,
    damageByTarget: [],
    dominantTarget: null,
    allyCDsOverlapping: [],
  });
  const NO_DAMAGE = "No damage dealt to enemy players during this burst.";

  it("says nothing about damage: the window cannot contain the cast's own hit", () => {
    const lines = formatBurstLedgerForContext([burst(40, 40)], [], []);
    expect(
      lines.some((l) => l.includes("Burst #1 — 0:40–0:40 | Soul Fire")),
    ).toBe(true);
    expect(lines.some((l) => l.includes(NO_DAMAGE))).toBe(false);
  });

  it("a burst with a real window and no damage still says so", () => {
    const lines = formatBurstLedgerForContext([burst(40, 52)], [], []);
    expect(lines.some((l) => l.includes(NO_DAMAGE))).toBe(true);
  });
});
