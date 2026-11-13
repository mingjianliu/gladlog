import { RAW_LENGTH_LINE_TAGS } from "@gladlog/analysis/src/utils/renderGrid";
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

  it("签字例外(R37):只有 [NO HEAL CAST] 行可以印原始时长", () => {
    expect([...RAW_LENGTH_LINE_TAGS]).toEqual(["[YOU] [NO HEAL CAST]"]);
    expect(
      checkWindowSpanConsistency([
        "4:17–4:21 (3.5s)  [YOU] [NO HEAL CAST]   3.5s with no heal pressed (free to cast; nothing else pressed) — 2(Mate) 81% → 58%",
      ]),
    ).toEqual([]);
    expect(
      checkWindowSpanConsistency([
        "4:17–4:21 (3.5s)  [YOU] [INACTIVITY]   nothing pressed",
        "  [STACKED DEFENSIVES] 4:17–4:21 (3.5s)",
      ]),
    ).toHaveLength(2);
  });
});
