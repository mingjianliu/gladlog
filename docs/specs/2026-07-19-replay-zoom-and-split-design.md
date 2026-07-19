# 回放视图:滚轮键位、缩放热区、地图/GCD 可拖分栏

**日期:** 2026-07-19
**状态:** 已批准,待实现
**分支:** `worktree-replay-zoom-and-split`
**改动面:** `packages/desktop/src/renderer/src/report/components/ReplayView.tsx` 及邻近单元

## 缘起与一处需要澄清的历史

用户对回放视图提了三条抱怨。2026-07-19 早些时候曾有一轮设计,但那轮误入了旧 fork
`~/code/wowarenalogs`(CC BY-NC-ND),把抱怨对着上游的 pixi 实现分析,结论与 gladlog
的实际代码几乎相反(例如判定"gladlog 没有缩放按钮"——实际有;判定"面板覆盖层吞掉滚轮
事件"——gladlog 的框体是 grid 旁列,不是覆盖层)。那轮产出的 patch 不适用于本仓,不予移植。
本 spec 是对着 gladlog 自己的代码重新核实后的设计。

## 问题(逐条对 gladlog 现状核实)

**1. 滚轮缩放读起来像"Mac 专属键位"。** `ReplayView.tsx:147` 是
`if (!e.ctrlKey && !e.metaKey) return;` —— 滚轮必须按住 ⌘/Ctrl 才缩放。Mac 触控板捏合
天然发带 `ctrlKey` 的 wheel 事件,所以 Mac 上"捏一下就有";Windows 鼠标不按 Ctrl 则毫无反应。
缩放按钮是存在的(`:869-893`,速度档旁),只是离地图远。

这行有个**故意的取舍**,注释写着"普通滚轮留给页面滚动"——战报是长滚动页,当初把裸滚轮
让给了翻页。这是本次唯一有真实代价的决定。

**2. 缩放热区只有 SVG 本体。** 监听器挂在 `<svg>` 元素上(`:156`),而 SVG 带
`aspectRatio` + `preserveAspectRatio="xMidYMid meet"`,中间列比图宽时两侧留白是死区。

**3. 地图与 GCD 泳道的宽度锁死。** `.rpt-replay-stage` 是写死的
`grid-template-columns: 1fr 2fr`(`styles.css:916`),只有"地图 + GCD" / "纯地图"两档
toggle,比例不可调,且缺"纯 GCD"档。

**4. 地图 SVG 被硬顶在 560px 宽。**(写实现计划时发现,不在最初三条抱怨里,但会让
可拖分栏对地图侧完全失效。)`styles.css:653-656` 的 `.rpt-replay-field` 有
`max-width: 560px`,全局无任何覆盖。后果是拖分隔条给地图更多宽度、超过 560px 之后
毫无视觉效果,多出的全成空白 gutter。

更意外的是**「纯地图」档现在也没把地图变大**:`map-only` 把 arena-grid 放宽到 1100px、
框体加宽到 140px,但中间 SVG 仍卡在 560——该档的实际效果是"框体变大 + 居中"。

这正顶在"人堆看不清"这条抱怨上:目前唯一真能放大的手段是缩放(走 viewBox,与像素
宽度无关,一直有效),而"把地图铺大"这条路一直被这行 CSS 堵着。

## 让改动变小的三个既有事实

- `.rpt-gcd` 是 `flex: 1 1 0; min-width: 0`,SVG 是 `viewBox` + `preserveAspectRatio` +
  `aspectRatio`——**两侧都是纯流式**。分栏只需改 grid 列宽,**不需要任何 `ResizeObserver`
  或尺寸测量**。
- 回放时钟是 `requestAnimationFrame`(`:197-216`),不是 pixi ticker。藏掉地图**不会**
  冻住进度条,"纯 GCD"档可以真的不渲染地图。
- `applyZoom` 的数学跑在 viewBox 单位上(`dimsRef` 存 VW/VH),**与像素宽度解耦**——
  拖动分隔条不会扰动缩放状态。

## 设计

### 状态模型:一个 ratio,档位是它的预设值

分栏用单一的 `ratio`(地图占比,0–1)。三个档位是 `ratio` 的预设值,不是并列状态,
以此排除"档位说纯地图、ratio 说 0.4"的自相矛盾。

| 档位                 | ratio                                   | 渲染                           |
| -------------------- | --------------------------------------- | ------------------------------ |
| 地图 + GCD (`split`) | 用户上次拖的值,默认 `1/3`(即现在的 1:2) | 两侧 + 分隔条                  |
| 纯地图 (`map`)       | 1                                       | 不渲染 GcdSwimlane             |
| 纯 GCD (`gcd`)       | 0                                       | 不渲染 SVG / 框体列 / 缩放浮层 |

极端档**必须真的不渲染**另一侧,不能只靠 CSS 压到 0:`.rpt-gcd` 虽有 `min-width: 0`,
但内部 chips 会把它撑开,`flex: 1 1 0` 压不住。

**拖拽 clamp 到 `[0.2, 0.8]`**,拖不到极端。想全屏某一侧只能点档位按钮——"拖拽"永远是
微调,"档位"是唯一进极端态的路径,两者语义不重叠,也杜绝手滑把一侧拖没后找不回来。
分隔条**不做**双击复位。

### 滚轮判定表

缩放焦点仍按 SVG 的 `getBoundingClientRect()` 换算。热区**不含**左右 96px 的框体列。

热区需要一个当前不存在的 DOM 节点:`<svg>` 现在是 `.rpt-replay-arena-grid` 的直接
grid 子元素(`styles.css:742-744` 的 `.rpt-replay-arena-grid > svg { grid-column: 2 }`)。
中间列没有容器,留白属于 grid 轨道本身,挂不上监听。**实现时给 SVG 套一层 wrapper div
占据第 2 列**,`grid-column: 2` 从 `> svg` 移到该 wrapper,滚轮监听(`hotZoneRef`)挂
wrapper。这是本次唯一的 DOM 结构变动。

```
⌘/Ctrl + 滚轮           → 缩放,preventDefault()
裸滚轮 && view !== null  → 缩放,preventDefault()
裸滚轮 && view === null  → 不拦截,交给页面滚动
```

第三行是**不调用 `preventDefault()`**,而非"调用了但不缩放"——必须让事件继续冒泡,
否则全景态下地图会变成滚动黑洞。

进入缩放态 = 明确的"我在看地图"信号,所以此时接管裸滚轮;双击或点复位回到全景后,
滚轮自动交还翻页。

### 缩放按钮浮到地图右下角

从工具栏移到地图右下角浮层。**类名 `.rpt-replay-zoom-btn` / `.rpt-replay-zoom-reset`
保持不变**——那是现有测试的契约。工具栏对应位置腾空。

### 缩放状态跨档保留

切到「纯 GCD」再切回,`view` 不重置,回到原缩放位置。切档不该丢掉刚对准的视角。

### 单元划分

`ReplayView.tsx` 已 911 行。本次抽出四个单元,`ReplayView` 只做组装;不做与本次无关的
大重构(SVG 场景绘制是文件的大头,这次不碰)。

| 单元                     | 职责                                               | 依赖         |
| ------------------------ | -------------------------------------------------- | ------------ |
| `useReplayZoom.ts`       | `view` 状态、缩放/平移、滚轮规则                   | 无           |
| `useReplayLayout.ts`     | ratio + 档位 + 持久化;导出纯函数 `clampSplitRatio` | localStorage |
| `ReplaySplitter.tsx`     | 拖拽条(plain DOM pointer)                          | 无           |
| `ReplayZoomControls.tsx` | 缩放浮层(纯展示,承载类名契约)                      | 无           |

```ts
// useReplayZoom.ts
export function useReplayZoom(): {
  view: ViewBox | null; // null = 全景
  zoomLevel: number | null; // Math.round((VW / view.w) * 10) / 10,给按钮标 "2.4×"
  applyZoom(factor: number, fx: number, fy: number): void;
  panByPixels(dx: number, dy: number, rect: DOMRect): void;
  reset(): void;
  setDims(vw: number, vh: number): void; // 渲染期调用,见下
  svgRef: Ref<SVGSVGElement>;
  hotZoneRef: Ref<HTMLDivElement>;
};

// useReplayLayout.ts
export type ReplayLayoutMode = "split" | "map" | "gcd";
export function useReplayLayout(): {
  mode: ReplayLayoutMode;
  ratio: number; // split→用户值,map→1,gcd→0
  setMode(m: ReplayLayoutMode): void;
  setRatio(r: number): void; // 内部过 clamp
};
export function clampSplitRatio(desired: number): number;
```

`setDims` 是刻意保留的别扭接口:VW/VH 要等 `zoneMap` 分支算完,而那发生在
`tracks.length === 0` 的早退**之后**,所以现有代码在渲染期赋值 `dimsRef.current`
(`:293`)。抽 hook 时照搬这个写法,不发明更"干净"的方案——那会改行为。

### 布局落地

一行内联样式,不新增 CSS 规则:

```
split → gridTemplateColumns: `${ratio}fr 6px ${1 - ratio}fr`
map   → `1fr`   (不渲染 GcdSwimlane)
gcd   → `1fr`   (不渲染 SVG / 框体列 / 缩放浮层)
```

现有 `.rpt-replay-stage.map-only`(`styles.css:2844-2851`)**只有列宽那条被取代**:
`.rpt-replay-stage.map-only { grid-template-columns: 1fr }` 删除(改由内联样式驱动),
但紧随其后的 `.rpt-replay-stage.map-only .rpt-replay-arena-grid`(框体列加宽到 140px、
`max-width: 1100px` 居中)是「纯地图」档的真实视觉行为,**必须保留**,选择器改为跟随
新的 `map` 档 class。整条规则块一起删会静默丢掉纯地图档的加宽与居中。

### 解除 560px 硬顶

删除 `.rpt-replay-field` 的 `max-width: 560px`,改由**容器**界定上限:

- `split` 档:SVG 填满中间列,上限即 grid 中间轨道的宽度(随 ratio 变化)
- `map` 档:沿用既有的 `max-width: 1100px`(减去两侧 140px 框体 → 最大约 820px 方图)

`aspect-ratio` 保证任何宽度下仍是方的,`width: 100%` 保留。这条是"拖宽 = 地图真的变大"
成立的前提,顺带修好「纯地图」档一直没放大地图的问题。

### 持久化

`localStorage["gladlog.replaySplit"] = { mode, ratio }`,沿用现有
`gladlog.replayLayout` 的 try/catch 写法(隐私模式下 localStorage 抛异常)。
旧键值 `"map"` 用 `??` 兜底映射成 `mode: "map"`,不写迁移代码。
读到的 `ratio` 一律过 `clampSplitRatio`,越界或 `NaN` 落回默认。

## 验证

### 自动化

| 目标                              | 断言                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `clampSplitRatio`                 | 低于 0.2、高于 0.8、`NaN`、localStorage 越界值                                  |
| 滚轮判定表                        | 全景态裸滚轮 `defaultPrevented === false`;缩放态裸滚轮改 viewBox;⌘ 滚轮两态都改 |
| 档位渲染                          | `gcd` 档 `[data-testid=rpt-replay-field]` 不在 DOM;`map` 档 GcdSwimlane 不在    |
| 缩放跨档保留                      | 缩放 → 切 `gcd` → 切回 → viewBox 不变                                           |
| 现有 `report.replayzoom.test.tsx` | 两个用例原样保持绿(走 `ctrlKey` 路径)                                           |

`defaultPrevented === false` 是这批里最要紧的一条:"没缩放"和"让页面滚起来了"是两件事。
只断言 viewBox 未变的话,一个"调了 `preventDefault()` 然后什么都不做"的实现也能通过,
而那正是把地图变成滚动黑洞的 bug。

### 测不了的,明说

**拖拽交互本身不写自动化测试。** jsdom 的 `getBoundingClientRect()` 一律返回全零,
像素→比例的换算没有真实 rect 可依。不 mock 假 rect 来制造"测过了"的错觉——那只会
测到 mock 自己。逻辑边界由 `clampSplitRatio` 单测覆盖,交互进手动清单。

### 手动清单(`/run-ui` 测试台)

- 拖分隔条,两侧都不变形,地图不拉伸
- 拖宽地图侧,**地图确实变大**(560px 硬顶已解除),不是留出空白 gutter
- 「纯地图」档下地图明显大于分栏档(此前两者一样大)
- 全景态在地图上滚轮 → 页面正常翻页
- 缩放态在地图上滚轮 → 缩放,页面不动
- SVG 两侧留白处滚轮生效;框体列上滚轮不生效(按设计)
- 三个档位切换,「纯 GCD」下进度条继续走
- 缩放后切「纯 GCD」再切回,视角还在原处

### push 前

`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`

## 不做

- 分隔条双击复位(用户明确不要)
- 上下分栏、跨设备同步分栏位置
- 自定义 pinch 手势处理——浏览器已把捏合作为带 `ctrlKey` 的 wheel 送达,上面的规则已覆盖
- `ReplayView` 的整体拆分(SVG 场景绘制/框体/时间轴)——该做,但与本次三条抱怨无关
- 接入 C2 视觉回归(`docs/specs` 中的前端质检设计尚未实施)。本次的布局改动是 C2 落地后
  的天然回归目标,届时再补基线

## 设计决策

**档位是 ratio 的预设值,而非独立状态。** 两者并列会产生无法自洽的组合,且需要额外的
同步逻辑;单一状态让"当前布局"永远只有一个真相来源。

**拖拽够不到极端,极端只能点档位。** 让两种控制手段语义不重叠:拖拽=微调,档位=跳极端。
代价是拖到底也不会自动隐藏一侧,但换来的是手滑不会把一侧弄丢。

**缩放后才接管裸滚轮,而非永远接管。** 永远接管最直观、也和多数地图控件一致,但战报是
长滚动页、地图占中间一大块,光标扫过时翻页会卡住。用"是否已进入缩放态"作为意图信号,
两种需求都不牺牲。
