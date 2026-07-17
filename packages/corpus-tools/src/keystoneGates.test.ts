import { describe, expect, it } from "vitest";

import { assignBuildGroup, type KeystoneGate } from "./keystoneGates";

const discGate: KeystoneGate = {
  spec: "Discipline Priest",
  keystoneNodeIds: [82585, 110277, 82583],
  match: "any",
  metric: "offensiveIndex",
  groupPresent: "offensive",
  groupAbsent: "standard",
};

describe("assignBuildGroup", () => {
  it("returns groupPresent when ANY keystone node is present (match=any)", () => {
    expect(assignBuildGroup([100, 82583, 200], discGate)).toBe("offensive");
  });
  it("returns groupAbsent when no keystone node is present (match=any)", () => {
    expect(assignBuildGroup([100, 200, 300], discGate)).toBe("standard");
  });
  it("match=all requires every keystone node", () => {
    const allGate: KeystoneGate = { ...discGate, match: "all" };
    expect(assignBuildGroup([82585, 110277, 82583], allGate)).toBe("offensive");
    expect(assignBuildGroup([82585, 110277], allGate)).toBe("standard");
  });
});
