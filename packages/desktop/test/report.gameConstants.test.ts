import { describe, expect, it } from "vitest";
import {
  CLASS_COLORS,
  classColor,
  className,
  SPEC_NAMES,
  specName,
} from "../src/renderer/src/report/data/gameConstants";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("gameConstants", () => {
  it("13 个职业都有色与名;未知回退", () => {
    for (let c = 1; c <= 13; c++) {
      expect(CLASS_COLORS[c]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(className(c).length).toBeGreaterThan(0);
    }
    expect(classColor(999)).toBe("#9d9d9d");
    expect(className(999)).toBe("Unknown");
    expect(specName(999999)).toBe("");
  });
  it("fixture 中出现的每个 classId/specId 都被覆盖", () => {
    const m = loadMatchFixture();
    for (const u of Object.values(m.units)) {
      if (u.kind !== "Player") continue;
      expect(CLASS_COLORS[u.classId], `classId ${u.classId}`).toBeDefined();
      expect(SPEC_NAMES[u.specId], `specId ${u.specId}`).toBeDefined();
    }
  });
});
