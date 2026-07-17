// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("回放缩放(用户反馈:人堆看不清)", () => {
  it("滚轮放大改 viewBox,复位按钮出现并可还原;双击也复位", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const before = svg.getAttribute("viewBox")!;
    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100 });
    const after = svg.getAttribute("viewBox")!;
    expect(after).not.toBe(before);
    expect(svg.className.baseVal ?? svg.getAttribute("class")).toContain(
      "zoomed",
    );
    // 复位按钮
    const reset = container.querySelector(".rpt-replay-zoom-reset")!;
    expect(reset).toBeTruthy();
    fireEvent.click(reset);
    expect(svg.getAttribute("viewBox")).toBe(before);
    // 再放大后双击复位
    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100 });
    expect(svg.getAttribute("viewBox")).not.toBe(before);
    fireEvent.dblClick(svg);
    expect(svg.getAttribute("viewBox")).toBe(before);
  });

  it("缩小到全景即退出缩放态(viewBox 回满幅,无复位按钮)", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const before = svg.getAttribute("viewBox")!;
    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100 });
    fireEvent.wheel(svg, { deltaY: 100, clientX: 100, clientY: 100 });
    fireEvent.wheel(svg, { deltaY: 100, clientX: 100, clientY: 100 });
    expect(svg.getAttribute("viewBox")).toBe(before);
    expect(container.querySelector(".rpt-replay-zoom-reset")).toBeNull();
  });
});
