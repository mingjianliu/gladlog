import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  combatMemo,
  roundFingerprint,
  roundValue,
} from "../src/utils/combatMemo";

// codex 85-tk-I-T81-1 (P3): the lazy-load test in the desktop package never
// starts unloaded (its setup has already awaited the tables), so dropping the
// data epoch from the fingerprint left every test green. Here the epoch is
// driven by hand: a reading kept before a table loaded must not be served
// after it did.
let epoch = 0;
vi.mock("../src/data/ensure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/data/ensure")>()),
  analysisDataEpoch: () => epoch,
}));

describe("数据表载入前留下的读数,载入后重算(可控的 epoch 0 → 7)", () => {
  const combat = () => ({ startTime: 0, endTime: 90_000, units: {} });
  beforeEach(() => {
    epoch = 0;
  });

  it("combatMemo", () => {
    const c = combat();
    const fp = roundFingerprint(c);
    const compute = vi.fn(() => [epoch]);
    expect(combatMemo(c, "k", fp, compute)).toEqual([0]);
    expect(combatMemo(c, "k", fp, compute)).toEqual([0]);
    expect(compute).toHaveBeenCalledTimes(1);
    epoch = 7;
    expect(combatMemo(c, "k", fp, compute)).toEqual([7]);
    expect(combatMemo(c, "k", fp, compute)).toEqual([7]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("roundValue", () => {
    const c = combat();
    const fp = roundFingerprint(c);
    const compute = vi.fn(() => ({ epoch }));
    const before = roundValue(c, "k", fp, compute);
    expect(roundValue(c, "k", fp, compute)).toBe(before);
    epoch = 7;
    const after = roundValue(c, "k", fp, compute);
    expect(after).not.toBe(before);
    expect(after.epoch).toBe(7);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
