// @vitest-environment jsdom
import { render } from "@testing-library/react";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import {
  dampeningAt,
  deriveDampeningSeries,
} from "../src/renderer/src/report/derive/dampeningSeries";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("回放三小件(backlog #11)", () => {
  it("deriveDampeningSeries:1s 网格、单调不减(dampening 只涨不跌)", () => {
    const series = deriveDampeningSeries(m);
    expect(series.length).toBeGreaterThan(30);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.tS).toBe(series[i - 1]!.tS + 1);
      expect(series[i]!.pct).toBeGreaterThanOrEqual(series[i - 1]!.pct);
    }
    expect(dampeningAt(series, 0)).toBe(series[0]!.pct);
    expect(dampeningAt(series, 10_000)).toBe(series[series.length - 1]!.pct);
  });

  it("回放渲染:每个存活单位有 HP 数字,seek 到有施法处出现施法闪现", () => {
    const { startTime, tracks } = deriveReplay(m);
    // 找一个真实施法时刻(任一单位第一条 cast)
    const anyUnit = Object.values(m.units).find(
      (u) => u.kind === "Player" && u.casts.length > 0,
    )!;
    const castT = anyUnit.casts[0]!.timestamp;
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: castT + 300, unitNames: [], nonce: 9 }}
      />,
    );
    const hpNums = container.querySelectorAll(".rpt-replay-hpnum");
    expect(hpNums.length).toBeGreaterThan(0);
    for (const el of hpNums) {
      expect(el.textContent).toMatch(/^\d+%$/);
    }
    expect(
      container.querySelectorAll(".rpt-replay-castflash").length,
    ).toBeGreaterThan(0);
    void startTime;
    void tracks;
  });
});
