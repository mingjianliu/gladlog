/**
 * WO3 #18 (r1014-176, f4da82c5 2:55): the death line's free stretch reads CC
 * alone; `offCooldownForLastSeconds` says how long before the death the
 * option had been off cooldown, on the cooldown's own return (the ledger's
 * rendered-second slack taken back off).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  freeToPressMsBefore,
  offCooldownForLastSeconds,
} from "../src/utils/deathOutcomeAnalysis";

const T0 = 1_000_000;
const unit = (castAt: number[]): any => ({
  id: "p",
  name: "P-R-US",
  spec: "257",
  info: { talents: [], pvpTalents: [] },
  spellCastEvents: castAt.map((s) => ({
    spellId: "47788",
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
  })),
  auraEvents: [],
});

describe("offCooldownForLastSeconds", () => {
  it("a 30 s cooldown pressed at 0 s, death at 33 s → off cooldown for the last 3.0 s", () => {
    expect(offCooldownForLastSeconds(unit([0]), "47788", 30, 33, T0)).toBe(3);
  });
  it("off cooldown for the whole window → undefined", () => {
    expect(
      offCooldownForLastSeconds(unit([0]), "47788", 30, 60, T0),
    ).toBeUndefined();
    expect(
      offCooldownForLastSeconds(unit([]), "47788", 30, 20, T0),
    ).toBeUndefined();
  });
});

describe("freeToPressMsBefore (T32)", () => {
  // a single-charge ledger entry: pressed at 38.8 s on a 20 s cooldown → back
  // at 58.8 s
  const cd = (casts: number[]) =>
    ({
      casts: casts.map((timeSeconds) => ({ timeSeconds })),
      cooldownSeconds: 20,
    }) as unknown as Parameters<typeof freeToPressMsBefore>[1];
  it("Feign Death back 1.7 s before the death: free 7.8 s of control → 1.7 s (round-11 132-1)", () => {
    expect(freeToPressMsBefore(7800, cd([38.8]), 60.5)).toBe(1700);
  });
  it("back before the free stretch began: the control figure stands", () => {
    expect(freeToPressMsBefore(7800, cd([10]), 60.5)).toBe(7800);
    expect(freeToPressMsBefore(7800, cd([]), 60.5)).toBe(7800);
  });
  it("no lock before the death: no figure either way", () => {
    expect(freeToPressMsBefore(undefined, cd([38.8]), 60.5)).toBeUndefined();
  });
  it("locked through the death: 0 stays 0", () => {
    expect(freeToPressMsBefore(0, cd([38.8]), 60.5)).toBe(0);
  });
});
