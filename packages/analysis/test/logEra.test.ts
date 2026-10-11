/**
 * `logIsFrom` — the one comparison of a log timestamp with a dated game
 * change (utils/logEra.ts). The 12.1 gates read it; so does every later
 * rule that depends on when the match was played.
 */
import { describe, expect, it } from "vitest";

import {
  DR_RESET_CUTOVER_EPOCH_MS,
  DR_RESET_MS_121,
  DR_RESET_MS_PRE_121,
  drResetMsAt,
  PATCH_121_GOLIVE_EPOCH_MS,
} from "../src/utils/drAnalysis";
import { logIsFrom } from "../src/utils/logEra";

describe("logIsFrom", () => {
  it("the cutover instant itself is already the new rule", () => {
    expect(logIsFrom(99, 100)).toBe(false);
    expect(logIsFrom(100, 100)).toBe(true);
    expect(logIsFrom(101, 100)).toBe(true);
  });
  it("a timestamp that is not a number is on neither side — it reads false", () => {
    expect(logIsFrom(Number.NaN, 100)).toBe(false);
    expect(logIsFrom(undefined as unknown as number, 100)).toBe(false);
  });
  it("the DR reset window is asked through it and flips exactly at 12.1 go-live", () => {
    expect(DR_RESET_CUTOVER_EPOCH_MS).toBe(PATCH_121_GOLIVE_EPOCH_MS);
    expect(PATCH_121_GOLIVE_EPOCH_MS).toBe(Date.UTC(2026, 7, 11, 22, 0, 0));
    expect(drResetMsAt(PATCH_121_GOLIVE_EPOCH_MS - 1)).toBe(
      DR_RESET_MS_PRE_121,
    );
    expect(drResetMsAt(PATCH_121_GOLIVE_EPOCH_MS)).toBe(DR_RESET_MS_121);
    // a fixture's small synthetic epoch is a date long before the cutover
    expect(drResetMsAt(1_000_000)).toBe(DR_RESET_MS_PRE_121);
  });
});
