// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

function modeButton(container: HTMLElement, label: string): HTMLElement {
  const btn = Array.from(
    container.querySelectorAll(".rpt-replay-layout-seg button"),
  ).find((b) => b.textContent === label);
  if (!btn) throw new Error(`找不到档位按钮:${label}`);
  return btn as HTMLElement;
}

describe("回放三档布局", () => {
  // 本仓 vitest 环境下 localStorage 是 undefined(已实测),不能调 .clear() ——
  // 那会抛 TypeError。useReplayLayout 的读写都在 try/catch 里,读不到就落回
  // 默认档,所以每个用例天然是干净的初始状态,无需清理。

  it("纯 GCD 档不渲染地图与缩放浮层", () => {
    const { container } = render(<ReplayView source={m} />);
    expect(
      container.querySelector("[data-testid=rpt-replay-field]"),
    ).toBeTruthy();
    fireEvent.click(modeButton(container, "纯 GCD"));
    expect(
      container.querySelector("[data-testid=rpt-replay-field]"),
    ).toBeNull();
    expect(container.querySelector(".rpt-replay-zoom-group")).toBeNull();
    expect(
      container.querySelector("[data-testid=rpt-frames-friendly]"),
    ).toBeNull();
  });

  it("纯地图档不渲染 GCD 泳道", () => {
    const { container } = render(<ReplayView source={m} />);
    fireEvent.click(modeButton(container, "纯地图"));
    expect(container.querySelector(".rpt-gcd")).toBeNull();
    expect(
      container.querySelector("[data-testid=rpt-replay-field]"),
    ).toBeTruthy();
  });

  it("缩放状态跨档保留 —— 切走再切回,视角还在原处", () => {
    const { container } = render(<ReplayView source={m} />);
    const svg = container.querySelector("[data-testid=rpt-replay-field]")!;
    const panorama = svg.getAttribute("viewBox")!;
    fireEvent.wheel(svg, {
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      metaKey: true,
    });
    const zoomed = svg.getAttribute("viewBox")!;
    expect(zoomed).not.toBe(panorama);

    fireEvent.click(modeButton(container, "纯 GCD"));
    fireEvent.click(modeButton(container, "地图 + GCD"));

    const svg2 = container.querySelector("[data-testid=rpt-replay-field]")!;
    expect(svg2.getAttribute("viewBox")).toBe(zoomed);
  });
});
