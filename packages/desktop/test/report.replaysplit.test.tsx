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

/**
 * 每个用例都从干净状态起步。
 *
 * useReplayLayout 会把档位与分栏比例写进 localStorage,挂载时再读回来。
 * 原先这里假设「本仓 vitest 环境下 localStorage 是 undefined,所以天然干净」
 * —— 那是**环境巧合而非保证**:本机确实读不到,CI 的 jsdom 里它是存在的,
 * 于是上一条用例存进去的比例漏给了下一条(CI 实测:「← 减小比例」从上一条
 * 留下的 38.33 起步,得到 33 而不是期望的 28)。
 *
 * 所以显式清 —— 并且不能止于「清」:这个差异是双向温床,不依赖持久化的
 * 用例会因泄漏而 CI 红,依赖持久化的用例(纯地图档高度记忆)则本地红。
 * 缺失时补一个内存 shim,让两种环境跑的是同一条代码路径。
 */
function ensureLocalStorage(): void {
  if (globalThis.localStorage) return;
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
  });
}

beforeEach(() => {
  ensureLocalStorage();
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* 该环境不提供 localStorage —— 本就没有可泄漏的状态 */
  }
});

describe("回放三档布局", () => {
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

function splitter(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".rpt-replay-splitter");
  if (!el) throw new Error("找不到分隔条(split 档下才渲染)");
  return el as HTMLElement;
}

// Task 6 code review 修复 4:分隔条键盘可达性(WAI-ARIA Window Splitter 模式)。
// 键盘交互不依赖 getBoundingClientRect(),jsdom 里可测——跟拖拽本身(Task 6
// brief 明确不写自动化测试,mock rect 只测得到 mock 自己)不一样。
describe("分隔条键盘可达性", () => {
  it("初始 aria-value* 反映默认比例(1/3)与 [SPLIT_MIN, SPLIT_MAX] 范围", () => {
    const { container } = render(<ReplayView source={m} />);
    const el = splitter(container);
    expect(el.getAttribute("aria-valuenow")).toBe("33"); // round(1/3 * 100)
    expect(el.getAttribute("aria-valuemin")).toBe("20"); // SPLIT_MIN
    expect(el.getAttribute("aria-valuemax")).toBe("80"); // SPLIT_MAX
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("→ 增大比例,aria-valuenow 同步变大", () => {
    const { container } = render(<ReplayView source={m} />);
    const el = splitter(container);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(el.getAttribute("aria-valuenow")).toBe("38"); // 33.33 + 5 = 38.33 → 38
  });

  it("← 减小比例,aria-valuenow 同步变小", () => {
    const { container } = render(<ReplayView source={m} />);
    const el = splitter(container);
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(el.getAttribute("aria-valuenow")).toBe("28"); // 33.33 - 5 = 28.33 → 28
  });

  it("Home 落到下限 SPLIT_MIN(0.2)", () => {
    const { container } = render(<ReplayView source={m} />);
    const el = splitter(container);
    fireEvent.keyDown(el, { key: "ArrowRight" }); // 先离开默认值,确认 Home 真的把它拉回来而非巧合停在原地
    fireEvent.keyDown(el, { key: "Home" });
    expect(el.getAttribute("aria-valuenow")).toBe("20");
  });

  it("End 落到上限 SPLIT_MAX(0.8)", () => {
    const { container } = render(<ReplayView source={m} />);
    const el = splitter(container);
    fireEvent.keyDown(el, { key: "End" });
    expect(el.getAttribute("aria-valuenow")).toBe("80");
  });

  it("←/→ 不冒泡到 ReplayView 的全局播放头快进快退(避免同时跳时间轴)", () => {
    const { container } = render(<ReplayView source={m} />);
    const el = splitter(container);
    const timeBefore = container.querySelector(".rpt-replay-time")!.textContent;
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    const timeAfter = container.querySelector(".rpt-replay-time")!.textContent;
    expect(timeAfter).toBe(timeBefore);
  });
});

describe("纯地图档的高度调节", () => {
  const resizer = (c: HTMLElement) =>
    c.querySelector("[data-testid=rpt-replay-map-resizer]") as HTMLElement;

  it("只在纯地图档出现 —— 另外两档尺寸归 ratio 管", () => {
    const { container } = render(<ReplayView source={m} />);
    expect(resizer(container)).toBeFalsy(); // 默认 split 档
    fireEvent.click(modeButton(container, "纯地图"));
    expect(resizer(container)).toBeTruthy();
    fireEvent.click(modeButton(container, "纯 GCD"));
    expect(resizer(container)).toBeFalsy();
  });

  it("键盘 ↓/↑ 调高度,并按场地宽高比换成 stage 的 --map-w", () => {
    const { container } = render(<ReplayView source={m} />);
    fireEvent.click(modeButton(container, "纯地图"));
    const stage = container.querySelector(".rpt-replay-stage") as HTMLElement;
    const widthPx = () =>
      Number(stage.style.getPropertyValue("--map-w").replace("px", ""));
    const before = Number(resizer(container).getAttribute("aria-valuenow"));
    const beforeW = widthPx();

    fireEvent.keyDown(resizer(container), { key: "ArrowDown" });
    const after = Number(resizer(container).getAttribute("aria-valuenow"));
    expect(after).toBeGreaterThan(before);
    // 下发的是宽度(高度靠 aspectRatio 推回来),因为只有宽度能被
    // minmax(0,…) 收进容器;高度变大 → 宽度必须同向变大
    expect(widthPx()).toBeGreaterThan(beforeW);

    fireEvent.keyDown(resizer(container), { key: "ArrowUp" });
    expect(Number(resizer(container).getAttribute("aria-valuenow"))).toBe(
      before,
    );
  });

  it("Home/End 到两端,越界被 clamp 住", () => {
    const { container } = render(<ReplayView source={m} />);
    fireEvent.click(modeButton(container, "纯地图"));
    const min = Number(resizer(container).getAttribute("aria-valuemin"));
    const max = Number(resizer(container).getAttribute("aria-valuemax"));

    fireEvent.keyDown(resizer(container), { key: "Home" });
    expect(Number(resizer(container).getAttribute("aria-valuenow"))).toBe(min);
    // 已在下限,继续按 ↑ 不该越过
    fireEvent.keyDown(resizer(container), { key: "ArrowUp" });
    expect(Number(resizer(container).getAttribute("aria-valuenow"))).toBe(min);

    fireEvent.keyDown(resizer(container), { key: "End" });
    expect(Number(resizer(container).getAttribute("aria-valuenow"))).toBe(max);
    fireEvent.keyDown(resizer(container), { key: "ArrowDown" });
    expect(Number(resizer(container).getAttribute("aria-valuenow"))).toBe(max);
  });

  it("高度记进 localStorage,重挂后保持", () => {
    const { container, unmount } = render(<ReplayView source={m} />);
    fireEvent.click(modeButton(container, "纯地图"));
    fireEvent.keyDown(resizer(container), { key: "ArrowDown" });
    const picked = Number(resizer(container).getAttribute("aria-valuenow"));
    unmount();

    const again = render(<ReplayView source={m} />);
    expect(Number(resizer(again.container).getAttribute("aria-valuenow"))).toBe(
      picked,
    );
  });
});
