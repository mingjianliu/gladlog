// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("回放缩放(用户反馈:人堆看不清)", () => {
  it("滚轮放大改 viewBox,复位按钮出现并可还原;双击也复位", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const before = svg.getAttribute("viewBox")!;
    fireEvent.wheel(svg, {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    });
    const after = svg.getAttribute("viewBox")!;
    expect(after).not.toBe(before);
    expect(svg.getAttribute("class")).toContain("zoomed");
    // 复位按钮
    const reset = container.querySelector(".rpt-replay-zoom-reset")!;
    expect(reset).toBeTruthy();
    fireEvent.click(reset);
    expect(svg.getAttribute("viewBox")).toBe(before);
    // 再放大后双击复位
    fireEvent.wheel(svg, {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    });
    expect(svg.getAttribute("viewBox")).not.toBe(before);
    fireEvent.dblClick(svg);
    expect(svg.getAttribute("viewBox")).toBe(before);
  });

  it("缩小到全景即退出缩放态(viewBox 回满幅,无复位按钮)", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const before = svg.getAttribute("viewBox")!;
    fireEvent.wheel(svg, {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    });
    fireEvent.wheel(svg, {
      deltaY: 100,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    });
    fireEvent.wheel(svg, {
      deltaY: 100,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    });
    expect(svg.getAttribute("viewBox")).toBe(before);
    expect(container.querySelector(".rpt-replay-zoom-reset")).toBeNull();
  });
});

describe("滚轮判定表(Windows 鼠标也要能用)", () => {
  it("全景态裸滚轮不拦截,交给页面滚动", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const before = svg.getAttribute("viewBox")!;
    const ev = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      svg.dispatchEvent(ev);
    });
    // 两件事都要:没缩放,且没有吃掉事件 —— 后者是地图不变成滚动黑洞的保证
    expect(svg.getAttribute("viewBox")).toBe(before);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("已缩放态裸滚轮接管缩放", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const panorama = svg.getAttribute("viewBox")!;
    // 先用 ⌘ 进缩放态
    fireEvent.wheel(svg, {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      metaKey: true,
    });
    const zoomed = svg.getAttribute("viewBox")!;
    expect(zoomed).not.toBe(panorama);
    // 再裸滚轮,应继续缩放并吃掉事件
    const ev = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      svg.dispatchEvent(ev);
    });
    expect(svg.getAttribute("viewBox")).not.toBe(zoomed);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("热区覆盖 SVG 两侧留白(wrapper 上的滚轮也生效)", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const cell = container.querySelector(".rpt-replay-map-cell")!;
    const before = svg.getAttribute("viewBox")!;
    fireEvent.wheel(cell, {
      deltaY: -100,
      clientX: 10,
      clientY: 10,
      metaKey: true,
    });
    expect(svg.getAttribute("viewBox")).not.toBe(before);
  });
});

describe("缩放按钮(+/-)", () => {
  it("点击+按钮放大,点击-按钮缩小到全景并隐藏复位按钮", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const panorama = svg.getAttribute("viewBox")!;

    // 点击 + 按钮放大
    const zoomButtons = container.querySelectorAll(".rpt-replay-zoom-btn");
    const zoomInBtn = zoomButtons[0];
    fireEvent.click(zoomInBtn);
    const zoomed = svg.getAttribute("viewBox")!;
    expect(zoomed).not.toBe(panorama);

    // 复位按钮应该出现
    const resetBtn = container.querySelector(".rpt-replay-zoom-reset");
    expect(resetBtn).toBeTruthy();

    // 点击 - 按钮缩小回到全景
    const zoomOutBtn = zoomButtons[1];
    fireEvent.click(zoomOutBtn);
    expect(svg.getAttribute("viewBox")).toBe(panorama);

    // 复位按钮应该消失
    expect(container.querySelector(".rpt-replay-zoom-reset")).toBeNull();
  });
});
