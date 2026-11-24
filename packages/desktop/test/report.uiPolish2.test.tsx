// @vitest-environment jsdom
import { NO_PRESS_SUFFIX } from "@gladlog/analysis";
import { render } from "@testing-library/react";

import { KpiChips } from "../src/renderer/src/report/components/KpiChips";
import { withNoPressLabel } from "../src/renderer/src/report/derive/burstLedger";
import type { Mistake } from "../src/renderer/src/report/derive/mistakes";

describe("UI 修整第二轮", () => {
  it("(no press) 这个英文 prompt 标记换成界面文字", () => {
    expect(withNoPressLabel(`Malevolence${NO_PRESS_SUFFIX}`, "(自动触发)")).toBe(
      "Malevolence(自动触发)",
    );
    expect(withNoPressLabel("Summon Infernal", "(自动触发)")).toBe(
      "Summon Infernal",
    );
  });

  it("顶部失误数和失误清单同口径:只数你自己的时刻,队友单独标", () => {
    const m = (over: Partial<Mistake>): Mistake =>
      ({
        tS: 10,
        unitName: "Me",
        type: "x",
        label: "x",
        severity: "average",
        detail: "",
        seekNames: [],
        isOwner: true,
        timed: true,
        ...over,
      }) as Mistake;
    const { container } = render(
      <KpiChips
        mistakes={[
          m({ isOwner: false, severity: "major", unitName: "Mate" }),
          m({ isOwner: false, tS: 90, unitName: "Mate" }),
        ]}
        bands={[]}
        kickRows={[]}
        dispelDash={
          {
            totals: { friendlyDeliberate: 0, friendlyPassive: 0 },
          } as never
        }
      />,
    );
    const v = container.querySelector(".rpt-kpi-v")!.textContent!;
    // was "1 重大 · 1 一般" over a card saying 你本人未检出失误
    expect(v).not.toContain("重大");
    expect(v).toContain("0 一般");
    expect(v).toContain("队友 2");
  });
});
