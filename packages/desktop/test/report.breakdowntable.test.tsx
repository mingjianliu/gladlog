// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Meters } from "../src/renderer/src/report/components/Meters";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const src = loadRealMatchFixture() as unknown as ReportSource;
const rows = deriveSummary(src);

describe("Meters 行内明细展开(backlog #11)", () => {
  it("点行主体展开分解表,再点收起;同时只展开一人", () => {
    const { container } = render(
      <Meters rows={rows} mode="damage" source={src} />,
    );
    const bars = container.querySelectorAll(".rpt-meter-clickable");
    expect(bars.length).toBeGreaterThan(1);
    fireEvent.click(bars[0]!);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(1);
    expect(
      container.querySelectorAll(".rpt-breakdown tbody tr").length,
    ).toBeGreaterThan(0);
    fireEvent.click(bars[1]!);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(1);
    fireEvent.click(bars[1]!);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(0);
  });

  it("裁剪 fixture 无 params → 无暴击列;>8 行折叠为「其余 N 个」", () => {
    const { container } = render(
      <Meters rows={rows} mode="damage" source={src} />,
    );
    fireEvent.click(container.querySelectorAll(".rpt-meter-clickable")[0]!);
    expect(screen.queryByText("暴击")).toBeNull();
    const trs = container.querySelectorAll(".rpt-breakdown tbody tr");
    expect(trs.length).toBeLessThanOrEqual(9); // 8 + 可能的折叠行
  });

  it("名字按钮仍是隐藏切换,不触发展开", () => {
    const toggled: string[] = [];
    const { container } = render(
      <Meters
        rows={rows}
        mode="damage"
        source={src}
        onToggleUnit={(id) => toggled.push(id)}
      />,
    );
    fireEvent.click(container.querySelector(".rpt-meter-name")!);
    expect(toggled).toHaveLength(1);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(0);
  });

  it("未传 source(旧调用形态)→ 行不可展开不报错", () => {
    const { container } = render(<Meters rows={rows} mode="damage" />);
    expect(container.querySelectorAll(".rpt-meter-clickable")).toHaveLength(0);
  });
});
