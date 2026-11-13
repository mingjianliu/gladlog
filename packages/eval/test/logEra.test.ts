import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";
import { describe, expect, it } from "vitest";

import { bumpEra, type LogEra, logEraOf } from "../scripts/lib/logEra";

describe("logEraOf (GH #160 item 3)", () => {
  it("一局落在产品的两个上线时刻划出的三段里,切换那一刻算新版本", () => {
    expect(logEraOf(undefined, PATCH_121_GOLIVE_EPOCH_MS - 1)).toBe("pre-12.1");
    expect(logEraOf(undefined, PATCH_121_GOLIVE_EPOCH_MS)).toBe("12.1.0");
    expect(logEraOf(undefined, PATCH_1215_GOLIVE_EPOCH_MS - 1)).toBe("12.1.0");
    expect(logEraOf(undefined, PATCH_1215_GOLIVE_EPOCH_MS)).toBe("12.1.5");
  });
  it("带时钟偏移的一局按日志自己写的时刻分版本,和产品同一道门(codex 80-PIPE-50-B50-v1)", () => {
    const H = 60 * 60 * 1000;
    // parsed 3 h after the go-live, stating 6 h earlier: 3 h before it
    const match = { logClockOffsetMs: -6 * H };
    const parsed = PATCH_1215_GOLIVE_EPOCH_MS + 3 * H;
    expect(logEraOf(undefined, parsed)).toBe("12.1.5");
    expect(logEraOf(match, parsed)).toBe("12.1.0");
    // parsed 3 h before, stating 6 h later: after it
    expect(
      logEraOf({ logClockOffsetMs: 6 * H }, PATCH_1215_GOLIVE_EPOCH_MS - 3 * H),
    ).toBe("12.1.5");
    // inside the band after the stated cutover: the go-live's own band side
    expect(
      logEraOf({ logClockOffsetMs: 0 }, PATCH_1215_GOLIVE_EPOCH_MS + 60_000),
    ).toBe("12.1.0");
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
