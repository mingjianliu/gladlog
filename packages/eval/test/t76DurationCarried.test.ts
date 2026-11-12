/**
 * T76: the tools that list which talent duration modifiers the product does
 * NOT price ask one predicate, and it knows every table that prices one.
 */
import { describe, expect, it } from "vitest";

import {
  durationPairCarriedBy,
  durationPairCorpusPending,
} from "../scripts/lib/durationCarried";

describe("durationPairCarriedBy", () => {
  it("names the table that prices the pair", () => {
    // Rallying Cry's aura under Battlefield Commander — the hand table
    expect(durationPairCarriedBy("97463", "424742")).toBe("hand");
    // Havoc under Improved Havoc — a tooltip row, which the two tools missed
    expect(durationPairCarriedBy("80240", "1244460")).toBe("tooltip");
    // Spiritwalker's Grace under Spiritwalker's Momentum — per event
    expect(durationPairCarriedBy("79206", "443425")).toBe("per-event");
  });

  it("is undefined for a pair no table names, and for the wrong talent on a priced aura", () => {
    expect(durationPairCarriedBy("80240", "424742")).toBeUndefined();
    expect(durationPairCarriedBy("999999999", "1244460")).toBeUndefined();
  });

  it("a CC entry written on DB2 + tooltip alone is priced and still pending", () => {
    for (const blind of ["2094", "427773"]) {
      expect(durationPairCarriedBy(blind, "200733")).toBe("hand");
      expect(typeof durationPairCorpusPending(blind, "200733")).toBe(
        "boolean",
      );
    }
    expect(durationPairCorpusPending("97463", "424742")).toBe(false);
  });
});
