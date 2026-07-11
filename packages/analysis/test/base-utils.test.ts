import { binarySearchClosest } from "../src/utils/binarySearch";
import { computeDampening } from "../src/utils/dampening";

describe("base utils", () => {
  it("binarySearchClosest 精确三例", () => {
    const arr = [{ t: 10 }, { t: 20 }, { t: 30 }];
    const get = (x: { t: number }) => x.t;
    expect(binarySearchClosest(arr, 9, get)?.t).toBe(10);
    expect(binarySearchClosest(arr, 21, get)?.t).toBe(20);
    expect(binarySearchClosest(arr, 31, get)?.t).toBe(30);
  });
  it("computeDampening:開局 ≥ 0 且随时间单調不减", () => {
    const d0 = computeDampening(0, '3v3', []);
    const d60 = computeDampening(60_000, '3v3', []);
    const d300 = computeDampening(300_000, '3v3', []);
    expect(d0).toBeGreaterThanOrEqual(0);
    expect(d60).toBeGreaterThanOrEqual(d0);
    expect(d300).toBeGreaterThanOrEqual(d60);
  });
});
