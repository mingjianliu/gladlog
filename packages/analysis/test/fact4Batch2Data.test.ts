/**
 * fact4 batch 2 (2026-10-22): the data rows the delayed-control and channel
 * fixes rest on — each with its DB2 / corpus evidence in the table's own
 * comment.
 */
import { describe, expect, it } from "vitest";

import { COPY_CAST_IDS } from "../src/utils/castPress";
import { AOE_CC_LANDING_WINDOW_S } from "../src/utils/drAnalysis";

describe("fact4 batch 2 data", () => {
  it("Freezing Trap, Binding Shot and Snowdrift land over their area's life (D29 / D4 / D5 / D63 / D16)", () => {
    expect(AOE_CC_LANDING_WINDOW_S["187650"]).toEqual({ fromS: 0, toS: 60.5 });
    expect(AOE_CC_LANDING_WINDOW_S["109248"]).toEqual({ fromS: 0, toS: 10.5 });
    expect(AOE_CC_LANDING_WINDOW_S["389794"]).toEqual({ fromS: 0, toS: 6.5 });
  });
  it("Snowdrift's per-target pulse rows are no presses; its press is", () => {
    expect(COPY_CAST_IDS.has("389823")).toBe(true);
    expect(COPY_CAST_IDS.has("390171")).toBe(true);
    expect(COPY_CAST_IDS.has("389794")).toBe(false);
  });
});
