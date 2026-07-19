# 回放缩放与分栏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让回放视图的滚轮缩放在 Windows 鼠标上也自然可用、缩放热区覆盖整个地图列、地图与 GCD 泳道之间的宽度可拖拽分配。

**Architecture:** 从 911 行的 `ReplayView.tsx` 抽出四个单元(两个 hook、两个组件),`ReplayView` 只做组装。分栏用单一 `ratio` 状态,三个档位是它的预设值。缩放数学跑在 viewBox 单位上,与像素宽度解耦,所以拖拽不干扰缩放。两侧布局皆为流式,不需要任何 `ResizeObserver`。

**Tech Stack:** React 19 + TypeScript,vitest + jsdom + @testing-library/react,原生 CSS(`packages/desktop/src/renderer/src/styles.css`)。

**Spec:** `docs/specs/2026-07-19-replay-zoom-and-split-design.md`

## Global Constraints

- 类名 `.rpt-replay-zoom-btn` 与 `.rpt-replay-zoom-reset` **不得改名** —— `packages/desktop/test/report.replayzoom.test.tsx` 依赖它们。
- `data-testid="rpt-replay-field"` **不得改名** —— 同上。
- 拖拽范围硬性 `[0.2, 0.8]`;默认 ratio `1/3`。
- 分隔条**不做**双击复位。
- 全景态(`view === null`)的裸滚轮**必须不调用** `preventDefault()`。
- localStorage 一切读写包 try/catch(隐私模式下抛异常),沿用 `ReplayView.tsx:101-105` 的写法。
- 每个任务结束前跑 `npm test --workspace=packages/desktop`;全部完成后额外跑 `npm run typecheck && npx eslint packages/desktop/src --quiet`。
- 绝不用 `tsc -b`(会往 src 吐 .js)。

## File Structure

| 文件                                                                          | 职责                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/desktop/src/renderer/src/report/components/useReplayLayout.ts`      | 新建。ratio + 档位 + 持久化;导出纯函数 `clampSplitRatio` |
| `packages/desktop/src/renderer/src/report/components/useReplayLayout.test.ts` | 新建。`clampSplitRatio` 单测                             |
| `packages/desktop/src/renderer/src/report/components/useReplayZoom.ts`        | 新建。`view` 状态、缩放/平移、滚轮规则                   |
| `packages/desktop/src/renderer/src/report/components/ReplayZoomControls.tsx`  | 新建。缩放浮层(纯展示)                                   |
| `packages/desktop/src/renderer/src/report/components/ReplaySplitter.tsx`      | 新建。拖拽条                                             |
| `packages/desktop/src/renderer/src/report/components/ReplayView.tsx`          | 修改。组装上述单元                                       |
| `packages/desktop/src/renderer/src/styles.css`                                | 修改。解除 560px 顶、热区 wrapper、浮层与分隔条样式      |
| `packages/desktop/test/report.replaysplit.test.tsx`                           | 新建。档位渲染 + 跨档保留                                |
| `packages/desktop/test/report.replayzoom.test.tsx`                            | 修改。追加滚轮判定表用例                                 |

---

### Task 1: `clampSplitRatio` 与 `useReplayLayout`

纯逻辑 + 状态 hook,不接线到 UI。本任务结束时 UI 无任何变化。

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/useReplayLayout.ts`
- Test: `packages/desktop/src/renderer/src/report/components/useReplayLayout.test.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  - `export type ReplayLayoutMode = "split" | "map" | "gcd"`
  - `export const SPLIT_MIN = 0.2`、`export const SPLIT_MAX = 0.8`、`export const SPLIT_DEFAULT = 1 / 3`
  - `export function clampSplitRatio(desired: number): number`
  - `export function useReplayLayout(): { mode: ReplayLayoutMode; ratio: number; setMode(m: ReplayLayoutMode): void; setRatio(r: number): void }`

- [ ] **Step 1: 写失败的测试**

创建 `packages/desktop/src/renderer/src/report/components/useReplayLayout.test.ts`:

```ts
import {
  clampSplitRatio,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
} from "./useReplayLayout";

describe("clampSplitRatio", () => {
  it("低于下限夹到 SPLIT_MIN", () => {
    expect(clampSplitRatio(0.05)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(0)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(-3)).toBe(SPLIT_MIN);
  });

  it("高于上限夹到 SPLIT_MAX", () => {
    expect(clampSplitRatio(0.95)).toBe(SPLIT_MAX);
    expect(clampSplitRatio(1)).toBe(SPLIT_MAX);
    expect(clampSplitRatio(42)).toBe(SPLIT_MAX);
  });

  it("范围内原样返回", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(SPLIT_MIN)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(SPLIT_MAX)).toBe(SPLIT_MAX);
  });

  it("非有限值落回默认(localStorage 读到脏数据)", () => {
    expect(clampSplitRatio(NaN)).toBe(SPLIT_DEFAULT);
    expect(clampSplitRatio(Infinity)).toBe(SPLIT_DEFAULT);
    expect(clampSplitRatio(-Infinity)).toBe(SPLIT_DEFAULT);
    expect(clampSplitRatio(undefined as unknown as number)).toBe(SPLIT_DEFAULT);
  });
});
```

注意最后一组:`NaN` 走的是"落回默认",不是"夹到下限"。`Math.min/max` 遇 `NaN` 会传播 `NaN`,必须先判有限性——这正是这组测试要钉住的。

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx vitest run --workspace=packages/desktop src/renderer/src/report/components/useReplayLayout.test.ts`
Expected: FAIL,报找不到模块 `./useReplayLayout`

- [ ] **Step 3: 写实现**

创建 `packages/desktop/src/renderer/src/report/components/useReplayLayout.ts`:

```ts
import { useCallback, useState } from "react";

/** 分栏档位。ratio 是它们的预设值,不是并列状态。 */
export type ReplayLayoutMode = "split" | "map" | "gcd";

/** 地图占比的可拖范围。拖不到极端 —— 极端只能点档位按钮进。 */
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
/** 默认 1/3,即改造前写死的 1fr 2fr。 */
export const SPLIT_DEFAULT = 1 / 3;

const STORAGE_KEY = "gladlog.replaySplit";

/** 夹到 [SPLIT_MIN, SPLIT_MAX];非有限值(localStorage 脏数据)落回默认。 */
export function clampSplitRatio(desired: number): number {
  if (!Number.isFinite(desired)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, desired));
}

interface Persisted {
  mode: ReplayLayoutMode;
  ratio: number;
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      const mode =
        p.mode === "map" || p.mode === "gcd" || p.mode === "split"
          ? p.mode
          : "split";
      return { mode, ratio: clampSplitRatio(p.ratio as number) };
    }
    // 旧键迁移:gladlog.replayLayout 存过 "map" / "full"
    const legacy = localStorage.getItem("gladlog.replayLayout");
    return {
      mode: legacy === "map" ? "map" : "split",
      ratio: SPLIT_DEFAULT,
    };
  } catch {
    /* 隐私模式等 */
  }
  return { mode: "split", ratio: SPLIT_DEFAULT };
}

function persist(next: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等 */
  }
}

export function useReplayLayout(): {
  mode: ReplayLayoutMode;
  ratio: number;
  setMode(m: ReplayLayoutMode): void;
  setRatio(r: number): void;
} {
  const [state, setState] = useState<Persisted>(readPersisted);

  const setMode = useCallback((mode: ReplayLayoutMode) => {
    setState((prev) => {
      const next = { ...prev, mode };
      persist(next);
      return next;
    });
  }, []);

  const setRatio = useCallback((r: number) => {
    setState((prev) => {
      const next = { ...prev, ratio: clampSplitRatio(r) };
      persist(next);
      return next;
    });
  }, []);

  // 生效占比:极端档不读用户拖的值
  const ratio =
    state.mode === "map" ? 1 : state.mode === "gcd" ? 0 : state.ratio;

  return { mode: state.mode, ratio, setMode, setRatio };
}
```

`state.ratio` 始终存"用户拖的那个中间态值";对外暴露的 `ratio` 在极端档被覆盖成 1/0。所以从「纯地图」切回「地图 + GCD」时,用户上次拖的比例还在。

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run --workspace=packages/desktop src/renderer/src/report/components/useReplayLayout.test.ts`
Expected: PASS,4 个用例

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/src/report/components/useReplayLayout.ts \
        packages/desktop/src/renderer/src/report/components/useReplayLayout.test.ts
git commit -m "feat(replay): 分栏比例状态与 clampSplitRatio"
```

---

### Task 2: 抽出 `useReplayZoom` 与热区 wrapper(零行为改动)

把现有缩放逻辑原样搬进 hook,并引入滚轮监听要挂的 wrapper。**判定规则一字不改**
(仍是"必须按 ⌘/Ctrl"),现有两个缩放测试必须一路绿着。

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/useReplayZoom.ts`
- Modify: `packages/desktop/src/renderer/src/report/components/ReplayView.tsx:117-158`(删除,改为调用 hook)、`:293`(改为 `zoom.setDims(VW, VH)`)、`:317-350`(套 wrapper,ref 与事件改指向 hook)、`:701`(补 `</div>`)、`:869-893`(按钮改调 hook)
- Modify: `packages/desktop/src/renderer/src/styles.css:742-744`(`grid-column` 移到 wrapper)

**Interfaces:**

- Consumes: 无
- Produces:

  ```ts
  export interface ReplayViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  export function useReplayZoom(): {
    view: ReplayViewBox | null;
    zoomLevel: number | null;
    applyZoom(factor: number, fx: number, fy: number): void;
    panByPixels(dx: number, dy: number, rect: DOMRect): void;
    reset(): void;
    setDims(vw: number, vh: number): void;
    svgRef: React.RefObject<SVGSVGElement | null>;
    /** 回调 ref:元素挂载时装滚轮监听,卸载时拆。不是 RefObject。 */
    hotZoneRef: (el: HTMLDivElement | null) => void;
  };
  ```

滚轮监听按 spec 归 hook 所有(不留在 `ReplayView`),且用**回调 ref** 而非
`RefObject` + `useEffect`。两个理由:

1. 原实现 `useEffect(..., [applyZoom, tracks.length])` 里的 `tracks.length` 是个
   绕路——它存在只是因为 `tracks` 为空时组件早退、ref 一直是 null,靠这个依赖等数据
   到位后重跑。回调 ref 在元素出现/消失时天然触发,不需要这个 hack。
2. hook 每次渲染返回新对象,若把 `zoom` 整个放进依赖数组会每渲染一次装拆一次监听。

判定表要读当前 `view`,但监听不该因 `view` 变化而重装,所以 hook 内用
`viewRef.current = view` 在渲染期同步(与 `dimsRef`、`ReplayView.tsx:109` 的
`lastTRef.current = t` 同一套路,是本仓既有写法)。

- [ ] **Step 1: 先跑现有测试,记下绿的基线**

Run: `npx vitest run --workspace=packages/desktop test/report.replayzoom.test.tsx`
Expected: PASS,2 个用例。这是本任务的回归网,搬迁后必须还是这个结果。

- [ ] **Step 2: 写 hook**

创建 `packages/desktop/src/renderer/src/report/components/useReplayZoom.ts`:

```tsx
import { useCallback, useRef, useState } from "react";

export interface ReplayViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FALLBACK_VW = 520;
const FALLBACK_VH = 520;
/** 最多放大到全幅的 1/5。 */
const MAX_ZOOM_DIVISOR = 5;

/**
 * 回放地图的缩放/平移。全部数学跑在 viewBox 单位上,与像素宽度无关 ——
 * 所以拖动分栏分隔条不会扰动缩放状态。
 */
export function useReplayZoom() {
  const [view, setView] = useState<ReplayViewBox | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // VW/VH 要等 zoneMap 分支算完,那发生在 tracks.length === 0 的早退之后,
  // 所以沿用原实现:渲染期由消费者写入。
  const dimsRef = useRef({ vw: FALLBACK_VW, vh: FALLBACK_VH });
  // 滚轮判定要读当前 view,但监听不该因 view 变化而重装 —— 渲染期同步进 ref。
  const viewRef = useRef<ReplayViewBox | null>(null);
  viewRef.current = view;
  const detachRef = useRef<(() => void) | null>(null);

  const setDims = useCallback((vw: number, vh: number) => {
    dimsRef.current = { vw, vh };
  }, []);

  const applyZoom = useCallback((factor: number, fx: number, fy: number) => {
    const { vw, vh } = dimsRef.current;
    setView((cur0) => {
      const cur = cur0 ?? { x: 0, y: 0, w: vw, h: vh };
      const w = Math.min(vw, Math.max(vw / MAX_ZOOM_DIVISOR, cur.w * factor));
      const h = (w / vw) * vh;
      let x = cur.x + fx * (cur.w - w);
      let y = cur.y + fy * (cur.h - h);
      x = Math.min(Math.max(0, x), vw - w);
      y = Math.min(Math.max(0, y), vh - h);
      return w >= vw ? null : { x, y, w, h };
    });
  }, []);

  const panByPixels = useCallback((dx: number, dy: number, rect: DOMRect) => {
    const { vw, vh } = dimsRef.current;
    setView((cur) => {
      if (!cur) return cur;
      const mx = (dx / rect.width) * cur.w;
      const my = (dy / rect.height) * cur.h;
      return {
        ...cur,
        x: Math.min(Math.max(0, cur.x - mx), vw - cur.w),
        y: Math.min(Math.max(0, cur.y - my), vh - cur.h),
      };
    });
  }, []);

  const reset = useCallback(() => setView(null), []);

  // 回调 ref:元素来了就装监听,走了就拆。本任务保持原规则(必须按 ⌘/Ctrl),
  // 改判定表是 Task 3 的事。
  const hotZoneRef = useCallback(
    (el: HTMLDivElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        applyZoom(
          e.deltaY > 0 ? 1.25 : 0.8,
          (e.clientX - rect.left) / rect.width,
          (e.clientY - rect.top) / rect.height,
        );
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      detachRef.current = () => el.removeEventListener("wheel", onWheel);
    },
    [applyZoom],
  );

  const zoomLevel = view
    ? Math.round((dimsRef.current.vw / view.w) * 10) / 10
    : null;

  return {
    view,
    zoomLevel,
    applyZoom,
    panByPixels,
    reset,
    setDims,
    svgRef,
    hotZoneRef,
  };
}
```

- [ ] **Step 3: 接进 `ReplayView`**

删除 `ReplayView.tsx:117-158`(`view` state、`panRef`、`svgRef`、`dimsRef`、`applyZoom`、滚轮 `useEffect`),在原位置改为:

```tsx
const zoom = useReplayZoom();
const { view } = zoom;
const panRef = useRef<{ px: number; py: number } | null>(null);
```

顶部加 import:

```tsx
import { useReplayZoom } from "./useReplayZoom";
```

`:293` 的 `dimsRef.current = { vw: VW, vh: VH };` 改为:

```tsx
zoom.setDims(VW, VH);
```

滚轮 `useEffect` 整段删掉 —— 监听已经在 hook 的 `hotZoneRef` 里了(规则仍是原来的
"必须按 ⌘/Ctrl")。但它需要一个可挂的元素,所以**本任务同时引入 wrapper**,否则监听
无处可挂、缩放会直接失效。

给 `<svg>`(`:317` 起)外套一层 div:

```tsx
<div className="rpt-replay-arena-grid">
  <div className="rpt-replay-map-cell" ref={zoom.hotZoneRef}>
    <svg ref={zoom.svgRef} ... >
```

对应地在 `</svg>`(`:701`)之后补一个 `</div>`。**两侧框体(`:703-781`)必须留在 wrapper
外**,仍作 arena-grid 的直接子元素 —— 它们要占第 1、3 列。

同时把 `grid-column` 从 svg 移到 wrapper,否则 svg 不再是 grid 子元素、布局会塌。
`styles.css:742-744` 改为:

```css
.rpt-replay-arena-grid > .rpt-replay-map-cell {
  grid-column: 2;
  min-width: 0;
}
```

(删除原来的 `.rpt-replay-arena-grid > svg { grid-column: 2; }`。)

行为为什么不变:wheel 事件从 svg 冒泡到 wrapper,监听挂在 wrapper 上同样收得到,
判定规则一字未改。现有两个测试在 svg 上发事件,照样通过。

SVG 元素上:`ref={svgRef}` 改 `ref={zoom.svgRef}`;`onDoubleClick={() => setView(null)}` 改 `onDoubleClick={zoom.reset}`;`onPointerMove` 里那段手写换算改为:

```tsx
onPointerMove={(e) => {
  if (!view || !panRef.current) return;
  const rect = e.currentTarget.getBoundingClientRect();
  zoom.panByPixels(
    e.clientX - panRef.current.px,
    e.clientY - panRef.current.py,
    rect,
  );
  panRef.current = { px: e.clientX, py: e.clientY };
}}
```

`:869-893` 的三个按钮:`onClick={() => applyZoom(...)}` 改 `zoom.applyZoom(...)`,`onClick={() => setView(null)}` 改 `zoom.reset`,标签里的 `Math.round((VW / view.w) * 10) / 10` 改用 `zoom.zoomLevel`。

- [ ] **Step 4: 跑测试,确认与 Step 1 相同**

Run: `npx vitest run --workspace=packages/desktop test/report.replayzoom.test.tsx`
Expected: PASS,2 个用例 —— 与 Step 1 一字不差

再跑全量确认没波及别处:

Run: `npm test --workspace=packages/desktop`
Expected: 57 files / 264 tests 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/src/report/components/useReplayZoom.ts \
        packages/desktop/src/renderer/src/report/components/ReplayView.tsx
git commit -m "refactor(replay): 缩放逻辑抽成 useReplayZoom(零行为改动)"
```

---

### Task 3: 滚轮判定表

wrapper 与热区在 Task 2 已就位(监听要挂,不能等)。本任务**只改判定规则**。

**Files:**

- Modify: `packages/desktop/src/renderer/src/report/components/useReplayZoom.ts`(`hotZoneRef` 里的判定)
- Modify: `packages/desktop/test/report.replayzoom.test.tsx`(追加用例)

**Interfaces:**

- Consumes: Task 2 的 `useReplayZoom`
- Produces: 无新导出(`hotZoneRef` 签名不变)

- [ ] **Step 1: 写失败的测试**

在 `packages/desktop/test/report.replayzoom.test.tsx` 末尾追加:

```tsx
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
    svg.dispatchEvent(ev);
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
    svg.dispatchEvent(ev);
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
```

用原生 `WheelEvent` + `dispatchEvent` 而非 `fireEvent.wheel`,是因为要读 `defaultPrevented`;`fireEvent` 不把事件对象还给你。`cancelable: true` 必须给,否则 `preventDefault()` 无效、`defaultPrevented` 恒为 false,测试会假绿。

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx vitest run --workspace=packages/desktop test/report.replayzoom.test.tsx`
Expected: 前两个新用例 FAIL(裸滚轮当前不缩放),第三个 PASS(wrapper 在 Task 2 已就位)

- [ ] **Step 3: 改判定规则**

只动 `useReplayZoom.ts` 里 `hotZoneRef` 内的那一行守卫。原来:

```tsx
if (!e.ctrlKey && !e.metaKey) return;
```

改为:

```tsx
// 全景态的裸滚轮留给页面滚动 —— 必须原样 return、不碰 preventDefault,
// 否则地图会变成滚动黑洞。进入缩放态 = 明确的"我在看地图",此时才接管。
if (!e.ctrlKey && !e.metaKey && !viewRef.current) return;
```

读 `viewRef.current` 而非 `view`:监听是在回调 ref 里一次性装好的,闭包捕获的 `view`
会永远停在装监听那一刻的值(即 `null`),裸滚轮将永远不缩放。这是本任务唯一容易踩的坑,
而且两个新用例正好会抓到它。

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run --workspace=packages/desktop test/report.replayzoom.test.tsx`
Expected: PASS,5 个用例(原 2 + 新 3)

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/src/report/components/ReplayView.tsx \
        packages/desktop/src/renderer/src/styles.css \
        packages/desktop/test/report.replayzoom.test.tsx
git commit -m "feat(replay): 缩放态接管裸滚轮,热区扩到整个地图列"
```

---

### Task 4: 缩放按钮浮到地图右下角

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/ReplayZoomControls.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/ReplayView.tsx`(`:868-893` 删除,浮层挂进 `.rpt-replay-map-cell`)
- Modify: `packages/desktop/src/renderer/src/styles.css`

**Interfaces:**

- Consumes: Task 2 的 `useReplayZoom`(`zoomLevel`、`applyZoom`、`reset`)
- Produces: `export function ReplayZoomControls(props: { zoomLevel: number | null; onZoomIn(): void; onZoomOut(): void; onReset(): void }): JSX.Element`

- [ ] **Step 1: 写组件**

创建 `packages/desktop/src/renderer/src/report/components/ReplayZoomControls.tsx`:

```tsx
/**
 * 地图右下角的缩放浮层。类名是 report.replayzoom.test.tsx 的契约,勿改名。
 */
export function ReplayZoomControls(props: {
  zoomLevel: number | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <span className="rpt-replay-zoom-group">
      <button
        className="rpt-replay-zoom-btn"
        title="放大(也可 ⌘/Ctrl+滚轮;放大后普通滚轮即可继续缩放,拖拽平移)"
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button
        className="rpt-replay-zoom-btn"
        title="缩小"
        onClick={props.onZoomOut}
      >
        −
      </button>
      {props.zoomLevel != null && (
        <button
          className="rpt-replay-zoom-reset"
          title="复位缩放(或双击地图)"
          onClick={props.onReset}
        >
          ⤢ {props.zoomLevel}× 复位
        </button>
      )}
    </span>
  );
}
```

- [ ] **Step 2: 接线**

`ReplayView.tsx` 顶部加 import:

```tsx
import { ReplayZoomControls } from "./ReplayZoomControls";
```

删除 `:868-893`(`<span className="rpt-replay-divider" />` 与整个 `rpt-replay-zoom-group`)。在 `.rpt-replay-map-cell` 内、`</svg>` 之后放浮层:

```tsx
    </svg>
    <ReplayZoomControls
      zoomLevel={zoom.zoomLevel}
      onZoomIn={() => zoom.applyZoom(0.8, 0.5, 0.5)}
      onZoomOut={() => zoom.applyZoom(1.25, 0.5, 0.5)}
      onReset={zoom.reset}
    />
  </div>
```

`styles.css` 里 `.rpt-replay-map-cell` 补定位,并新增浮层样式:

```css
.rpt-replay-arena-grid > .rpt-replay-map-cell {
  grid-column: 2;
  min-width: 0;
  position: relative;
}
.rpt-replay-map-cell .rpt-replay-zoom-group {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border: 1px solid var(--hairline);
}
```

`.rpt-replay-zoom-btn` / `.rpt-replay-zoom-reset` 自身的样式(`styles.css:2253` 起)保持不动。

- [ ] **Step 3: 跑测试**

Run: `npm test --workspace=packages/desktop`
Expected: 全绿。`report.replayzoom.test.tsx` 的 5 个用例靠类名找按钮,搬位置不影响。

- [ ] **Step 4: 提交**

```bash
git add packages/desktop/src/renderer/src/report/components/ReplayZoomControls.tsx \
        packages/desktop/src/renderer/src/report/components/ReplayView.tsx \
        packages/desktop/src/renderer/src/styles.css
git commit -m "feat(replay): 缩放按钮浮到地图右下角"
```

---

### Task 5: 三档布局与 560px 硬顶解除

**Files:**

- Modify: `packages/desktop/src/renderer/src/report/components/ReplayView.tsx`(`:89-106` 删除旧 layout state、`:299-314` 档位与 stage、`:785` GcdSwimlane 门控)
- Modify: `packages/desktop/src/renderer/src/styles.css:653-656`、`:914-920`、`:2844-2851`
- Test: `packages/desktop/test/report.replaysplit.test.tsx`(新建)

**Interfaces:**

- Consumes: Task 1 的 `useReplayLayout`、Task 2 的 `useReplayZoom`
- Produces: 无新导出

- [ ] **Step 1: 写失败的测试**

创建 `packages/desktop/test/report.replaysplit.test.tsx`:

```tsx
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
  beforeEach(() => localStorage.clear());

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
```

第三个用例是这批里唯一会因为"图省事在切档时 reset 掉 view"而挂的 —— 它钉住的正是 spec 里"切档不该丢掉刚对准的视角"。

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx vitest run --workspace=packages/desktop test/report.replaysplit.test.tsx`
Expected: FAIL,`找不到档位按钮:纯 GCD`

- [ ] **Step 3: 改 `ReplayView`**

删除 `:89-106`(`layout` state 与 `switchLayout`),改为:

```tsx
const { mode, ratio, setMode, setRatio } = useReplayLayout();
```

顶部加 import:

```tsx
import { useReplayLayout, type ReplayLayoutMode } from "./useReplayLayout";
```

(`ReplaySplitter` 由 Task 6 创建并 import,本任务不要提前引它 —— 文件还不存在,会编译不过。)

档位表放在 `ReplayView.tsx` 模块顶层(和 `FALLBACK_VW` 那些常量一起):

```tsx
const LAYOUT_MODES: readonly (readonly [ReplayLayoutMode, string])[] = [
  ["split", "地图 + GCD"],
  ["map", "纯地图"],
  ["gcd", "纯 GCD"],
];
```

档位按钮(`:299-309`)改为:

```tsx
<div className="rpt-replay-layout-seg rpt-mode-seg">
  {LAYOUT_MODES.map(([value, label]) => (
    <button
      key={value}
      className={mode === value ? "active" : ""}
      onClick={() => setMode(value)}
    >
      {label}
    </button>
  ))}
</div>
```

stage(`:310-314`)改为内联列宽:

```tsx
<div
  className={`rpt-replay-stage mode-${mode}`}
  ref={stageRef}
  style={{
    gridTemplateColumns:
      mode === "split" ? `${ratio}fr 6px ${1 - ratio}fr` : "1fr",
  }}
>
```

`stageRef` 在组件顶部声明(Task 6 的分隔条要用它换算):

```tsx
const stageRef = useRef<HTMLDivElement | null>(null);
```

地图列(`:315` 的 `.rpt-replay-arena-col`)整块按 `mode !== "gcd"` 门控:

```tsx
{
  mode !== "gcd" && <div className="rpt-replay-arena-col">...</div>;
}
```

GcdSwimlane 的门控(`:785`)从 `layout === "full"` 改为 `mode !== "map"`。

- [ ] **Step 4: 改 CSS**

`styles.css:653-656`,删掉 `max-width`:

```css
.rpt-replay-field {
  width: 100%;
  aspect-ratio: 1 / 1;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 8px;
}
```

`styles.css:914-920`,列宽交给内联样式:

```css
.rpt-replay-stage {
  display: grid;
  gap: 8px;
  align-items: start;
  width: 100%;
}
```

`styles.css:2844-2851`,**只**替换列宽那条,加宽与居中必须留下:

```css
/* 纯地图档:框体加宽 + 整体居中(列宽由内联样式给) */
.rpt-replay-stage.mode-map .rpt-replay-arena-grid {
  grid-template-columns: 140px minmax(0, 1fr) 140px;
  max-width: 1100px;
  margin: 0 auto;
}
```

(删除 `.rpt-replay-stage.map-only { grid-template-columns: 1fr; }` 那条;选择器 `.map-only` 全部改为 `.mode-map`。)

- [ ] **Step 5: 跑测试,确认通过**

Run: `npx vitest run --workspace=packages/desktop test/report.replaysplit.test.tsx`
Expected: PASS,3 个用例

Run: `npm test --workspace=packages/desktop`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/renderer/src/report/components/ReplayView.tsx \
        packages/desktop/src/renderer/src/styles.css \
        packages/desktop/test/report.replaysplit.test.tsx
git commit -m "feat(replay): 三档布局(补纯 GCD),解除地图 560px 硬顶"
```

---

### Task 6: 可拖分隔条

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/ReplaySplitter.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/ReplayView.tsx`
- Modify: `packages/desktop/src/renderer/src/styles.css`

**Interfaces:**

- Consumes: Task 1 的 `setRatio`、Task 5 的 `stageRef`
- Produces: `export function ReplaySplitter(props: { onRatioChange(r: number): void; stageRef: React.RefObject<HTMLDivElement | null> }): JSX.Element`

拖拽交互**不写自动化测试**:jsdom 的 `getBoundingClientRect()` 一律返回全零,像素→比例的换算没有真实 rect 可依,mock 一个假 rect 只会测到 mock 自己。逻辑边界已由 Task 1 的 `clampSplitRatio` 单测覆盖,交互进手动清单。

- [ ] **Step 1: 写组件**

创建 `packages/desktop/src/renderer/src/report/components/ReplaySplitter.tsx`:

```tsx
import { useCallback, useRef } from "react";

/**
 * 地图/GCD 之间的拖拽分隔条。比例由 stage 的实际宽度换算,
 * clamp 在 useReplayLayout 里做 —— 拖不到极端,极端只能点档位按钮进。
 */
export function ReplaySplitter(props: {
  onRatioChange: (r: number) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const stage = props.stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0) return;
      props.onRatioChange((e.clientX - rect.left) / rect.width);
    },
    [props],
  );

  return (
    <div
      className="rpt-replay-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整地图与 GCD 泳道的宽度"
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
```

- [ ] **Step 2: 接线**

`ReplayView.tsx` 顶部加 import:

```tsx
import { ReplaySplitter } from "./ReplaySplitter";
```

在 stage 内、地图列与 GcdSwimlane 之间插入(只在 `split` 档渲染 —— 极端档没有两侧可分):

```tsx
{
  mode === "split" && (
    <ReplaySplitter onRatioChange={setRatio} stageRef={stageRef} />
  );
}
```

`styles.css` 新增:

```css
.rpt-replay-splitter {
  cursor: col-resize;
  background: var(--hairline);
  border-radius: 3px;
  align-self: stretch;
  touch-action: none;
}
.rpt-replay-splitter:hover {
  background: var(--accent-line);
}
```

`touch-action: none` 不能省 —— 否则触控板/触屏上浏览器的滚动手势会抢走 pointer 事件,拖拽半路断掉。

- [ ] **Step 3: 跑测试**

Run: `npm test --workspace=packages/desktop`
Expected: 全绿(本任务无新增自动化测试,确认没打破既有的)

- [ ] **Step 4: 全套门禁**

```bash
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
```

Expected: 测试全绿、typecheck 无输出、eslint 无输出

- [ ] **Step 5: 手动验证(`/run-ui` 测试台)**

逐条走一遍,任一条不过就别提交:

- 拖分隔条,两侧都不变形,地图不拉伸
- 拖宽地图侧,**地图确实变大**(560px 硬顶已解除),不是留出空白 gutter
- 「纯地图」档下地图明显大于分栏档(此前两者一样大)
- 全景态在地图上滚轮 → 页面正常翻页
- 缩放态在地图上滚轮 → 缩放,页面不动
- SVG 两侧留白处滚轮生效;框体列上滚轮不生效(按设计)
- 三个档位切换,「纯 GCD」下进度条继续走
- 缩放后切「纯 GCD」再切回,视角还在原处
- 拖到两端停住(0.2 / 0.8),不会把任一侧拖没

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/renderer/src/report/components/ReplaySplitter.tsx \
        packages/desktop/src/renderer/src/report/components/ReplayView.tsx \
        packages/desktop/src/renderer/src/styles.css
git commit -m "feat(replay): 地图与 GCD 泳道之间可拖分隔条"
```
