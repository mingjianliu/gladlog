import { describe, expect, it } from "vitest";

import { loadRealMatchFixture } from "../../../../../test/fixtures/loadFixture";
import { deriveVideoMoments } from "./videoMoments";

const m = loadRealMatchFixture();

describe("deriveVideoMoments", () => {
  it("合并 keyMoments,按 tS 升序,label 非空", () => {
    const ms = deriveVideoMoments(m);
    expect(ms.length).toBeGreaterThan(0);
    for (let i = 1; i < ms.length; i++) {
      expect(ms[i]!.tS).toBeGreaterThanOrEqual(ms[i - 1]!.tS);
    }
    for (const v of ms) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(Number.isFinite(v.tS)).toBe(true);
    }
  });

  it("AI chips 注入为 kind=ai;非法条目跳过", () => {
    const ms = deriveVideoMoments(m, [
      { t: 12, label: "恐惧 → 治疗(4.0s)", unitNames: ["Healer"] },
      { t: Number.NaN, label: "bad" } as never,
      { t: 5, label: "" } as never,
    ]);
    const ai = ms.filter((v) => v.kind === "ai");
    expect(ai).toHaveLength(1);
    expect(ai[0]).toMatchObject({ tS: 12, weight: "major" });
  });
});
