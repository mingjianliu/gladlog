import { describe, expect, it } from "vitest";

import { cdAvailableAt } from "../src/utils/cooldowns";

const cast = (timeSeconds: number) => ({ timeSeconds });

describe("cdAvailableAt(死亡时刻可用性——defensive-early 的镜像谓词)", () => {
  it("从未使用 → 全程可用", () => {
    expect(
      cdAvailableAt({ casts: [], cooldownSeconds: 120, neverUsed: true }, 45),
    ).toBe(true);
  });
  it("上次使用 + CD 已转好 → 可用", () => {
    expect(
      cdAvailableAt(
        { casts: [cast(10)], cooldownSeconds: 60, neverUsed: false },
        75, // readyAt = 70 ≤ 75
      ),
    ).toBe(true);
  });
  it("上次使用 + CD 未转好 → 不可用", () => {
    expect(
      cdAvailableAt(
        { casts: [cast(30)], cooldownSeconds: 60, neverUsed: false },
        75, // readyAt = 90 > 75
      ),
    ).toBe(false);
  });
  it("多次施放取 t 之前最近一次", () => {
    expect(
      cdAvailableAt(
        { casts: [cast(10), cast(80)], cooldownSeconds: 60, neverUsed: false },
        100, // last before 100 = 80, readyAt = 140 > 100
      ),
    ).toBe(false);
  });
});
