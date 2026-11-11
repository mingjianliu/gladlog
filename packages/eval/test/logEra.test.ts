import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";
import { describe, expect, it } from "vitest";

import { bumpEra, type LogEra, logEraOf } from "../scripts/lib/logEra";

describe("logEraOf (GH #160 item 3)", () => {
  it("一局落在产品的两个上线时刻划出的三段里,切换那一刻算新版本", () => {
    expect(logEraOf(PATCH_121_GOLIVE_EPOCH_MS - 1)).toBe("pre-12.1");
    expect(logEraOf(PATCH_121_GOLIVE_EPOCH_MS)).toBe("12.1.0");
    expect(logEraOf(PATCH_1215_GOLIVE_EPOCH_MS - 1)).toBe("12.1.0");
    expect(logEraOf(PATCH_1215_GOLIVE_EPOCH_MS)).toBe("12.1.5");
  });
  it("bumpEra 按版本累加,不串版本", () => {
    const counts: Partial<Record<LogEra, { casts: number; bad: number }>> = {};
    bumpEra(counts, "12.1.0", { casts: 3, bad: 1 });
    bumpEra(counts, "12.1.0", { casts: 2, bad: 0 });
    bumpEra(counts, "12.1.5", { casts: 4, bad: 4 });
    expect(counts).toEqual({
      "12.1.0": { casts: 5, bad: 1 },
      "12.1.5": { casts: 4, bad: 4 },
    });
  });
});
