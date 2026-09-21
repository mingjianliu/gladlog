import { describe, expect, it } from "vitest";

import {
  bindBreakToWindow,
  findBrokenCC,
  ICCBreakableWindow,
  ICCInstance,
  TRINKET_BREAK_TOLERANCE_MS,
} from "../src/utils/ccTrinketAnalysis";

describe("bindBreakToWindow and findBrokenCC", () => {
  describe("bindBreakToWindow", () => {
    it("exports TRINKET_BREAK_TOLERANCE_MS as 250", () => {
      expect(TRINKET_BREAK_TOLERANCE_MS).toBe(250);
    });

    it("binds a break cast within the active window", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      const bound = bindBreakToWindow([window], 12_000);
      expect(bound).toBe(window);
    });

    it("binds a break cast within ±250ms of the active window boundaries", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      // 200ms before apply
      expect(bindBreakToWindow([window], 9_800)).toBe(window);
      // 200ms after remove
      expect(bindBreakToWindow([window], 16_200)).toBe(window);
    });

    it("binds to the window with the longest duration when multiple windows overlap", () => {
      const shortWindow: ICCBreakableWindow = { applyMs: 10_000, removeMs: 13_000 }; // 3s
      const longWindow: ICCBreakableWindow = { applyMs: 10_500, removeMs: 16_500 }; // 6s
      const mediumWindow: ICCBreakableWindow = { applyMs: 9_000, removeMs: 14_000 }; // 5s

      // Cast at 11_000 when all three are active
      const bound = bindBreakToWindow([shortWindow, longWindow, mediumWindow], 11_000);
      expect(bound).toBe(longWindow);
    });

    it("returns undefined when cast is outside ±250ms tolerance", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };
      // Well before apply
      expect(bindBreakToWindow([window], 9_000)).toBeUndefined();
      // Well after remove
      expect(bindBreakToWindow([window], 17_000)).toBeUndefined();
    });

    it("matches exactly at the 250ms tolerance boundary, but not at 251ms", () => {
      const window: ICCBreakableWindow = { applyMs: 10_000, removeMs: 16_000 };

      // Exactly at -250ms (9_750ms) -> matches
      expect(bindBreakToWindow([window], 9_750)).toBe(window);
      // At -251ms (9_749ms) -> undefined
      expect(bindBreakToWindow([window], 9_749)).toBeUndefined();

      // Exactly at +250ms (16_250ms) -> matches
      expect(bindBreakToWindow([window], 16_250)).toBe(window);
      // At +251ms (16_251ms) -> undefined
      expect(bindBreakToWindow([window], 16_251)).toBeUndefined();
    });
  });

  describe("findBrokenCC", () => {
    const makeCC = (atSeconds: number, durationSeconds: number, spellName: string): ICCInstance => ({
      atSeconds,
      durationSeconds,
      spellId: "118",
      spellName,
      sourceName: "Mage",
      sourceId: "Player-1",
      sourceSpec: "Frost Mage",
      damageTakenDuring: 0,
      trinketState: "used",
      drInfo: null,
      distanceYards: null,
      losBlocked: null,
    });

    it("finds the broken CC instance matching the cast timestamp", () => {
      const matchStartMs = 1_000_000;
      const cc1 = makeCC(10.0, 6.0, "Polymorph"); // 10_000ms to 16_000ms from matchStart
      const cc2 = makeCC(25.0, 4.0, "Kidney Shot"); // 25_000ms to 29_000ms from matchStart

      // Cast at matchStartMs + 12_000ms
      const broken = findBrokenCC([cc1, cc2], matchStartMs, matchStartMs + 12_000);
      expect(broken).toBe(cc1);

      // Cast outside any CC
      const none = findBrokenCC([cc1, cc2], matchStartMs, matchStartMs + 20_000);
      expect(none).toBeUndefined();
    });

    it("picks the longest duration CC when multiple instances overlap at cast time", () => {
      const matchStartMs = 1_000_000;
      const shortCC = makeCC(10.0, 3.0, "Cheap Shot"); // 10s to 13s
      const longCC = makeCC(10.5, 6.0, "Blind"); // 10.5s to 16.5s

      const broken = findBrokenCC([shortCC, longCC], matchStartMs, matchStartMs + 11_000);
      expect(broken).toBe(longCC);
    });
  });
});
