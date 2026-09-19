import { describe, expect, it, vi } from "vitest";

import { memoizeWhenReady } from "../src/utils/memoize";

describe("memoize — memoizeWhenReady", () => {
  it("does NOT cache results while isReady() returns false", () => {
    const ready = false;
    const fn = vi.fn((x: number) => x * 2);
    const memoized = memoizeWhenReady(() => ready, fn);

    expect(memoized(5)).toBe(10);
    expect(memoized(5)).toBe(10);
    expect(memoized(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("caches and reuses results once isReady() becomes true", () => {
    let ready = false;
    const fn = vi.fn((x: number) => x * 3);
    const memoized = memoizeWhenReady(() => ready, fn);

    // Call while unready -> not cached
    expect(memoized(4)).toBe(12);
    expect(fn).toHaveBeenCalledTimes(1);

    // Transition to ready
    ready = true;

    // First call while ready executes fn and caches
    expect(memoized(4)).toBe(12);
    expect(fn).toHaveBeenCalledTimes(2);

    // Subsequent calls return cached value without executing fn
    expect(memoized(4)).toBe(12);
    expect(memoized(4)).toBe(12);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caches distinct arguments independently", () => {
    const fn = vi.fn((s: string) => s.toUpperCase());
    const memoized = memoizeWhenReady(() => true, fn);

    expect(memoized("a")).toBe("A");
    expect(memoized("b")).toBe("B");
    expect(memoized("a")).toBe("A");
    expect(memoized("b")).toBe("B");

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
