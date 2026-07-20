import { describe, expect, it } from "vitest";

import { checkWindowSpanConsistency } from "./promptQualityCheck";

describe("checkWindowSpanConsistency", () => {
  it("**回归**:线上真实不自洽行(001-be78167b,2:57–3:15 标注 19s)", () => {
    const v = checkWindowSpanConsistency([
      "  [VULNERABLE] 2:57–3:15 (19s) on Discipline Priest: no major defensives",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("相减为 18s");
    expect(v[0]).toContain("(19s)");
  });

  it("自洽时不报", () => {
    expect(
      checkWindowSpanConsistency([
        "  [VULNERABLE] 2:57–3:15 (18s) on Discipline Priest",
        "      0:27–1:10 (43s)",
      ]),
    ).toEqual([]);
  });

  it("跨分钟边界正确", () => {
    expect(checkWindowSpanConsistency(["  0:55–1:05 (10s)"])).toEqual([]);
    expect(checkWindowSpanConsistency(["  0:55–1:05 (11s)"])).toHaveLength(1);
  });

  it("零宽窗口合法", () => {
    expect(checkWindowSpanConsistency(["  1:00–1:00 (0s)"])).toEqual([]);
  });

  it("一行多个窗口各自判定", () => {
    expect(
      checkWindowSpanConsistency(["  a 0:00–0:10 (10s) and b 1:00–1:30 (25s)"]),
    ).toHaveLength(1);
  });

  it("空输入 → 无违规", () => {
    expect(checkWindowSpanConsistency([])).toEqual([]);
  });
});
