# 前端质检体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 gladlog 前端建一座分层质检塔——视觉回归、无障碍、E2E 核心链路、性能预算——每层的「合格」都是机器可判定的断言。

**Architecture:** 一个 Playwright 依赖吃三层:`visual` project 驱动现有 `dev:ui` 纯浏览器测试台(截图 + axe + 首渲计时),`e2e` project 用 `_electron.launch()` 驱动 `electron-vite build` 产物(三条核心链路 + 冷启动)。解析预算是 parser 包里的普通 vitest 测试。截图基线只有 linux 一套,由 CI 生成与判定(本机无容器运行时,2026-07-19 决议)。

**Tech Stack:** Playwright (`@playwright/test`)、`@axe-core/playwright`、vitest、React 19、Electron 38、TypeScript(ESM,`moduleResolution: bundler`)。

设计文档:`docs/superpowers/specs/2026-07-19-frontend-qa-design.md`

## Global Constraints

- 类型检查一律 `npm run typecheck`(= `tsc --noEmit`)。**绝不 `tsc -b`**——会往 src 吐 .js 污染树。
- 每个 task 的最后一步 commit 之前必须过:`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`。CI 的 tsc 含 test 文件、且有独立 Lint 步。
- **门规谓词即规范**:分析代码与验证门对同一个事实必须共享同一个谓词——同一常量、同一函数,一处 export 两边 import。本计划里具体体现为 `PROMPT_VERSION`(Task 11)与三个预算常量(Task 15)。
- 截图基线**只有 linux 一套**,由 CI(ubuntu-latest)生成与判定;本机只跑 `test:visual:smoke`(带 `--ignore-snapshots`,不写基线)。Playwright config **不得**在 `snapshotPathTemplate` 里加 `{platform}`——加了就等于允许第二套标准。
- 所有新增 QA 代码放 `packages/desktop/qa/`,不混进 vitest 的 `test/`。vitest 必须显式 exclude `qa/**`(默认 include 会吞掉 `*.spec.ts`,Task 4 处理)。
- 性能预算走 **measure-then-lock**:先只测量并打印 `[budget]` 行,拿到真实 CI 数字后再锁常量(Task 15)。任何一步都不许写「随便填个数」。
- 新增 npm 依赖只装到 `packages/desktop` workspace(`npm i -D -w @gladlog/desktop ...`),不污染 root。

---

## File Structure

新建:

```
packages/desktop/
  dev/
    scenes.ts              # 场景名解析(纯函数,可单测)
    scenes.test.ts         # scenes.ts 的单测
    fixtures/appShell.ts   # app-shell 场景的确定性 metas / notebook fixture
  qa/
    playwright.config.ts   # visual + e2e 两个 project
    axe-allowlist.ts       # 无障碍豁免清单(规则 id + 选择器 + 理由)
    budgets.ts             # 三个性能预算常量(Task 15 锁定)
    support/seedAnalysis.ts# E2E:把 canned 分析结果写进缓存文件
    visual/scenes.spec.ts  # 7 个场景截图 + axe
    visual/firstPaint.spec.ts # 报表首渲计时
    e2e/import.spec.ts     # 链路1 导入→报告 + 冷启动计时
    e2e/evidence.spec.ts   # 链路2 finding→证据链
    e2e/coachLoop.spec.ts  # 链路3 教练闭环 + 重启持久化
    __screenshots__/       # linux 基线(提交进仓库)
packages/desktop/src/main/e2eEnv.ts       # GLADLOG_E2E userData 重定向(纯函数)
packages/desktop/src/main/e2eEnv.test.ts
packages/desktop/src/shared/promptVersion.ts # PROMPT_VERSION 单源(Task 11)
packages/parser/src/testing/synthLog.ts   # 确定性合成战斗日志生成器
packages/parser/test/synthLog.test.ts
packages/parser/test/parseBudget.test.ts  # 解析耗时预算
```

修改:

```
packages/desktop/dev/main.tsx        # 场景路由分支
packages/desktop/dev/harness.css     # 场景模式下隐藏工具栏
packages/desktop/src/renderer/src/report/components/MatchReport.tsx  # initialView prop
packages/desktop/src/main/index.ts   # 顶部接入 e2eEnv
packages/desktop/src/main/ai.ts      # PROMPT_VERSION 改为 re-export
packages/desktop/tsconfig.json       # include 加 dev、qa
packages/desktop/vitest.config.ts    # exclude qa/**
packages/desktop/package.json        # test:visual / test:visual:update / test:e2e
.github/workflows/test.yml           # frontend-qa job
```

---

# Phase 1 — dev:ui 场景化 + 视觉回归 + axe

## Task 1: MatchReport 支持 initialView

报表的三视图是组件内部 state,外部无法直达。加一个可选 prop,让 `?scene=report-replay` 这类 URL 能确定性地落到某个视图(也是未来证据链深链接的基础)。

**Files:**

- Modify: `packages/desktop/src/renderer/src/report/components/MatchReport.tsx:29-39`
- Test: `packages/desktop/src/renderer/src/report/components/MatchReport.initialView.test.tsx`

**Interfaces:**

- Consumes: 无(第一个 task)
- Produces: `MatchReport` 新增可选 prop `initialView?: "report" | "replay" | "ai"`,默认 `"report"`。Task 2 的场景表依赖它。

- [ ] **Step 1: 写失败的测试**

创建 `packages/desktop/src/renderer/src/report/components/MatchReport.initialView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";

import fixture from "../../../../../test/fixtures/report-match.json";
import type { ReportSource } from "../derive/types";
import { MatchReport } from "./MatchReport";

const source = fixture as unknown as ReportSource;

describe("MatchReport initialView", () => {
  it("默认打开战报视图", () => {
    render(<MatchReport source={source} matchId="m1" />);
    expect(screen.getByRole("button", { name: "战报" })).toHaveClass("active");
  });

  it("initialView=replay 直接打开回放视图", () => {
    render(<MatchReport source={source} matchId="m1" initialView="replay" />);
    expect(screen.getByRole("button", { name: "回放" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "战报" })).not.toHaveClass(
      "active",
    );
  });

  it("initialView=ai 直接打开 AI 视图", () => {
    render(<MatchReport source={source} matchId="m1" initialView="ai" />);
    expect(screen.getByRole("button", { name: "AI 分析" })).toHaveClass(
      "active",
    );
  });
});
```

注意:`toHaveClass` 来自 jest-dom。先确认 `packages/desktop` 是否已有 jest-dom setup——运行 `grep -rn "jest-dom" packages/desktop/src packages/desktop/vitest.config.ts`。**若没有**,把三处断言改成不依赖 jest-dom 的写法:

```tsx
expect(
  screen.getByRole("button", { name: "回放" }).className.split(" "),
).toContain("active");
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
npm test --workspace=packages/desktop -- MatchReport.initialView
```

Expected: FAIL——`initialView=replay` 那条断言失败(仍停在「战报」),因为 prop 尚未存在。

- [ ] **Step 3: 最小实现**

`MatchReport.tsx` 改签名与 state 初值:

```tsx
export function MatchReport({
  source,
  roundLabel,
  matchId,
  initialView = "report",
}: {
  source: ReportSource;
  roundLabel?: string;
  matchId?: string;
  initialView?: View;
}) {
  const [mode, setMode] = useState<MeterMode>("damage");
  const [view, setView] = useState<View>(initialView);
```

其余不动。

- [ ] **Step 4: 运行测试,确认通过**

```bash
npm test --workspace=packages/desktop -- MatchReport.initialView
```

Expected: PASS(3 passed)

- [ ] **Step 5: 全量检查 + 提交**

```bash
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
git add packages/desktop/src/renderer/src/report/components/MatchReport.tsx packages/desktop/src/renderer/src/report/components/MatchReport.initialView.test.tsx
git commit -m "feat(report): MatchReport 支持 initialView —— 视图可被 URL 直达"
```

---

## Task 2: dev:ui 场景路由(4 个报表场景)

给测试台加 `?scene=` 参数:URL 直达确定状态,不靠点下拉/标签。场景模式下隐藏工具栏,截图里只剩被测 UI。

**Files:**

- Create: `packages/desktop/dev/scenes.ts`
- Create: `packages/desktop/dev/scenes.test.ts`
- Modify: `packages/desktop/dev/main.tsx`
- Modify: `packages/desktop/dev/harness.css`
- Modify: `packages/desktop/tsconfig.json`

**Interfaces:**

- Consumes: Task 1 的 `MatchReport` prop `initialView`
- Produces:
  - `export type SceneName`(本 task 含 4 个报表场景,Task 3 追加 3 个 app-shell 场景)
  - `export const SCENE_NAMES: readonly SceneName[]`
  - `export function resolveScene(search: string): SceneName | null`
  - DOM 约定:场景模式下根节点带 `data-scene-ready="<sceneName>"`,Playwright 以此判断渲染完成。

- [ ] **Step 1: 写失败的测试**

创建 `packages/desktop/dev/scenes.test.ts`:

```ts
import { resolveScene, SCENE_NAMES } from "./scenes";

describe("resolveScene", () => {
  it("无 scene 参数 → null(走原交互式试验台)", () => {
    expect(resolveScene("")).toBeNull();
    expect(resolveScene("?foo=1")).toBeNull();
  });

  it("合法 scene 名 → 原样返回", () => {
    expect(resolveScene("?scene=report-battle")).toBe("report-battle");
    expect(resolveScene("?scene=report-ai&other=x")).toBe("report-ai");
  });

  it("非法 scene 名 → null(不静默渲染错场景)", () => {
    expect(resolveScene("?scene=nope")).toBeNull();
  });

  it("场景名清单唯一且非空", () => {
    expect(SCENE_NAMES.length).toBeGreaterThan(0);
    expect(new Set(SCENE_NAMES).size).toBe(SCENE_NAMES.length);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
npm test --workspace=packages/desktop -- scenes
```

Expected: FAIL——`Failed to resolve import "./scenes"`。

- [ ] **Step 3: 实现 scenes.ts**

创建 `packages/desktop/dev/scenes.ts`:

```ts
/** 视觉回归场景:每个 scene 是一个 URL 可直达的确定状态。
 *  qa/visual/scenes.spec.ts 逐个截图,基线即标准。 */
export const SCENE_NAMES = [
  "report-battle",
  "report-replay",
  "report-ai",
  "report-synth",
] as const;

export type SceneName = (typeof SCENE_NAMES)[number];

export function resolveScene(search: string): SceneName | null {
  const raw = new URLSearchParams(search).get("scene");
  if (!raw) return null;
  return (SCENE_NAMES as readonly string[]).includes(raw)
    ? (raw as SceneName)
    : null;
}
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
npm test --workspace=packages/desktop -- scenes
```

Expected: PASS(4 passed)

- [ ] **Step 5: 接进 main.tsx**

`packages/desktop/dev/main.tsx` 在 `const BASE_FIXTURES` 之后、`function Harness()` 之前插入场景渲染组件;并改最后的 render 调用。

先在文件顶部 import 区加:

```tsx
import { resolveScene, type SceneName } from "./scenes";
```

在 `function Harness()` 之前加:

```tsx
// 场景模式(?scene=…):渲染单一确定状态,给视觉回归截图用。
// data-scene-ready 是 Playwright 的就绪信号 —— 挂上即表示该场景已渲染。
const SCENE_VIEW: Record<
  SceneName,
  { fixture: StoredMatch; initialView: "report" | "replay" | "ai" }
> = {
  "report-battle": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "report",
  },
  "report-replay": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "replay",
  },
  "report-ai": {
    fixture: realMatch as unknown as StoredMatch,
    initialView: "ai",
  },
  "report-synth": {
    fixture: synthMatch as unknown as StoredMatch,
    initialView: "report",
  },
};

function Scene({ name }: { name: SceneName }) {
  const cfg = SCENE_VIEW[name];
  return (
    <div className="scene-root" data-scene-ready={name}>
      <MatchReport
        source={cfg.fixture}
        matchId={name}
        initialView={cfg.initialView}
      />
    </div>
  );
}
```

把文件末尾的 render 改成:

```tsx
const scene = resolveScene(window.location.search);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {scene ? <Scene name={scene} /> : <Harness />}
  </React.StrictMode>,
);
```

- [ ] **Step 6: 场景模式样式**

`packages/desktop/dev/harness.css` 末尾追加:

```css
/* 场景模式:无工具栏,内边距与 app 主区一致,截图里只剩被测 UI */
.scene-root {
  padding: 16px;
}
```

- [ ] **Step 7: tsconfig 覆盖 dev/**

`packages/desktop/tsconfig.json` 的 include 从 `["src", "test"]` 改为:

```json
  "include": ["src", "test", "dev"]
```

运行 `npm run typecheck`。**dev/ 此前未被类型检查,可能暴露既有错误——必须在本 task 内修掉,不许放过**(预期为 0 个:`main.tsx` 里的 window 赋值与 fixture 都已显式 cast)。

- [ ] **Step 8: 肉眼确认场景可用**

```bash
npm run dev:ui --workspace=packages/desktop
```

浏览器打开 `http://localhost:5199/?scene=report-replay`,确认:无顶部工具栏、直接停在「回放」视图。再开 `http://localhost:5199/`,确认原交互式试验台不受影响。看完 Ctrl-C 停掉。

- [ ] **Step 9: 全量检查 + 提交**

```bash
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
git add packages/desktop/dev packages/desktop/tsconfig.json
git commit -m "feat(dev-ui): ?scene= 场景路由 —— 视觉回归的确定性入口"
```

---

## Task 3: app-shell 场景(仪表盘/设置/比赛列表)

仪表盘、设置页、比赛列表目前不在测试台里。用现成的 `installFixtureBridge()` 把整个 `<App/>` 挂起来,再用确定性 metas 覆盖列表数据。独立收益:run-ui 工作流以后能直接看这三页。

**Files:**

- Create: `packages/desktop/dev/fixtures/appShell.ts`
- Modify: `packages/desktop/dev/scenes.ts`
- Modify: `packages/desktop/dev/scenes.test.ts`
- Modify: `packages/desktop/dev/main.tsx`

**Interfaces:**

- Consumes: Task 2 的 `SCENE_NAMES` / `resolveScene`;`installFixtureBridge()`(`src/renderer/src/fixtureBridge.ts`);`bridge()` 的解析顺序是 `window.__gladlogFixture ?? window.gladlog`
- Produces:
  - `SCENE_NAMES` 追加 `"dashboard" | "settings" | "matchlist"`
  - `export const DEMO_METAS: StoredMatchMeta[]`(固定时间戳,12 条)
  - `export function installAppShellFixture(): void`——装 fixture bridge 并覆盖 `matches.page/list` 为 `DEMO_METAS`

- [ ] **Step 1: 扩测试(先失败)**

`packages/desktop/dev/scenes.test.ts` 的 `describe` 内追加:

```ts
it("app-shell 场景也可直达", () => {
  expect(resolveScene("?scene=dashboard")).toBe("dashboard");
  expect(resolveScene("?scene=settings")).toBe("settings");
  expect(resolveScene("?scene=matchlist")).toBe("matchlist");
});
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
npm test --workspace=packages/desktop -- scenes
```

Expected: FAIL——`expected null to be 'dashboard'`。

- [ ] **Step 3: 扩场景名**

`packages/desktop/dev/scenes.ts` 的 `SCENE_NAMES` 改为:

```ts
export const SCENE_NAMES = [
  "report-battle",
  "report-replay",
  "report-ai",
  "report-synth",
  "dashboard",
  "settings",
  "matchlist",
] as const;
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
npm test --workspace=packages/desktop -- scenes
```

Expected: PASS(5 passed)

- [ ] **Step 5: 写确定性 metas fixture**

创建 `packages/desktop/dev/fixtures/appShell.ts`:

```ts
import type { StoredMatchMeta } from "../../src/main/matchStore";
import { installFixtureBridge } from "../../src/renderer/src/fixtureBridge";

/** 固定基准时刻(2026-07-19T12:00:00Z)。视觉回归会用 Playwright 的
 *  clock.setFixedTime 把 Date.now() 钉在同一时刻,两边必须一致,
 *  否则「今天/昨天」分组与仪表盘周期会随真实时间漂移 → 截图 flaky。 */
export const FIXED_NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

const HOUR = 3_600_000;
const DAY = 86_400_000;

const BRACKETS = ["3v3", "3v3", "2v2", "Solo Shuffle"] as const;

/** 12 场确定性对局:跨 3 天、含胜负与评分涨跌,足以覆盖列表分组与仪表盘曲线。 */
export const DEMO_METAS: StoredMatchMeta[] = Array.from(
  { length: 12 },
  (_, i) => {
    const startTime = FIXED_NOW - Math.floor(i / 4) * DAY - (i % 4) * HOUR;
    return {
      id: `demo-${i}`,
      kind: "match" as const,
      bracket: BRACKETS[i % BRACKETS.length]!,
      zoneId: "1505",
      startTime,
      endTime: startTime + 180_000,
      result: i % 3 === 0 ? "Loss" : "Win",
      storedAt: startTime + 200_000,
      playerName: "Demo",
      playerRating: 1800 + i * 7,
    } as StoredMatchMeta;
  },
);

/** 装 fixture bridge,并把比赛列表换成确定性数据。 */
export function installAppShellFixture(): void {
  installFixtureBridge();
  const api = window.__gladlogFixture;
  if (!api) throw new Error("installFixtureBridge 未挂载 __gladlogFixture");
  const matches = api.matches as unknown as {
    list: () => Promise<StoredMatchMeta[]>;
    page: (o: { before?: number; limit: number }) => Promise<StoredMatchMeta[]>;
  };
  matches.list = async () => DEMO_METAS;
  matches.page = async (o) =>
    DEMO_METAS.filter((m) => o.before == null || m.startTime < o.before)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, o.limit);
}
```

注意 `StoredMatchMeta` 的字段可能与上面不完全一致——运行 typecheck 时若报字段不存在/缺必填,以 `src/main/matchStore.ts` 的实际类型为准调整(`as StoredMatchMeta` 只兜可选字段,不许用 `as any` 掩盖必填缺失)。

- [ ] **Step 6: 接进 main.tsx**

`dev/main.tsx` import 区追加:

```tsx
import App from "../src/renderer/src/App";
import { installAppShellFixture } from "./fixtures/appShell";
```

`Scene` 组件改为分派两类场景:

```tsx
const APP_SHELL_SCENES: Record<string, true> = {
  dashboard: true,
  settings: true,
  matchlist: true,
};

function AppShellScene({ name }: { name: SceneName }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    installAppShellFixture();
    setReady(true);
  }, []);
  if (!ready) return null;
  return (
    <div className="scene-root scene-appshell" data-scene-ready={name}>
      <App />
    </div>
  );
}

function Scene({ name }: { name: SceneName }) {
  if (APP_SHELL_SCENES[name]) return <AppShellScene name={name} />;
  const cfg = SCENE_VIEW[name as keyof typeof SCENE_VIEW];
  return (
    <div className="scene-root" data-scene-ready={name}>
      <MatchReport
        source={cfg.fixture}
        matchId={name}
        initialView={cfg.initialView}
      />
    </div>
  );
}
```

`SCENE_VIEW` 的类型从 `Record<SceneName, …>` 改为只覆盖四个报表场景:

```tsx
const SCENE_VIEW: Record<
  "report-battle" | "report-replay" | "report-ai" | "report-synth",
  { fixture: StoredMatch; initialView: "report" | "replay" | "ai" }
> = {/* 内容不变 */};
```

`.scene-appshell` 不需要 padding(App 自带布局),`harness.css` 追加:

```css
.scene-appshell {
  padding: 0;
}
```

- [ ] **Step 7: 肉眼确认三页可用**

```bash
npm run dev:ui --workspace=packages/desktop
```

**在此之前必须先做一件事**:`App` 的 `appView` 默认是 `"matches"`(`App.tsx:27`),不给入口的话三个场景渲染的都是同一个「对局」页。与 Task 1 同一手法,给 `App` 加可选 prop:

```tsx
export default function App({
  initialAppView = "matches",
}: {
  initialAppView?: AppView;
} = {}) {
  const [appView, setAppView] = useState<AppView>(initialAppView);
```

`AppShellScene` 按场景传入:

```tsx
const APP_SHELL_VIEW = {
  dashboard: "stats",
  settings: "settings",
  matchlist: "matches",
} as const;

// AppShellScene 内:
return (
  <div className="scene-root scene-appshell" data-scene-ready={name}>
    <App initialAppView={APP_SHELL_VIEW[name as keyof typeof APP_SHELL_VIEW]} />
  </div>
);
```

`APP_SHELL_SCENES` 可直接换成 `APP_SHELL_VIEW`(用 `name in APP_SHELL_VIEW` 判断),少一张表。

改完再跑 `npm run dev:ui`,依次打开 `?scene=dashboard`、`?scene=settings`、`?scene=matchlist`,确认三页各自渲染出内容(仪表盘有曲线卡、设置页有表单、列表有 12 行且按天分组)。

- [ ] **Step 8: 全量检查 + 提交**

```bash
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
git add packages/desktop/dev packages/desktop/src/renderer/src/App.tsx
git commit -m "feat(dev-ui): 仪表盘/设置/列表场景 —— app-shell 也进视觉回归"
```

---

## Task 4: Playwright 落地 + 7 场景截图基线

**Files:**

- Create: `packages/desktop/qa/playwright.config.ts`
- Create: `packages/desktop/qa/visual/scenes.spec.ts`
- Create: `packages/desktop/qa/__screenshots__/`(由基线命令生成)
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/vitest.config.ts`
- Modify: `packages/desktop/tsconfig.json`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Task 2/3 的 `?scene=` 与 `data-scene-ready`;`SCENE_NAMES`;`FIXED_NOW`
- Produces:
  - npm scripts `test:visual`、`test:visual:update`
  - Playwright projects `visual` / `e2e`(后者 Task 10 才有测试文件)
  - 截图基线目录 `qa/__screenshots__/`

- [ ] **Step 1: 装依赖**

```bash
npm i -D -w @gladlog/desktop @playwright/test
npx playwright install --with-deps chromium
npx playwright --version
```

记下版本号(形如 `Version 1.5x.y`)——CI 的浏览器缓存键用它,版本变了缓存自动失效。

- [ ] **Step 2: 隔离 vitest 与 Playwright**

Playwright 的 `*.spec.ts` 会被 vitest 默认 include 吞掉,导致 `npm test` 直接崩。`packages/desktop/vitest.config.ts` 改为:

```ts
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // qa/ 是 Playwright 的地盘:*.spec.ts 由 playwright 跑,vitest 不许碰
    exclude: [...configDefaults.exclude, "qa/**"],
  },
});
```

`packages/desktop/tsconfig.json` 的 include 追加 `"qa"`:

```json
  "include": ["src", "test", "dev", "qa"]
```

`.gitignore` 追加(Playwright 的运行产物不进仓库,基线图要进):

```
packages/desktop/qa/test-results/
packages/desktop/qa/playwright-report/
```

- [ ] **Step 3: 写 Playwright 配置**

创建 `packages/desktop/qa/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
  testDir: ".",
  // 基线单源:路径里**不含 {platform}** —— linux 一套基线即唯一标准。
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  expect: {
    // 容差只吸收抗锯齿噪声,不用来放水
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "visual",
      testMatch: /visual\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${PORT}`,
      },
    },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts$/,
    },
  ],
  webServer: {
    command: "npm run dev:ui",
    cwd: "..",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: 写场景截图测试**

创建 `packages/desktop/qa/visual/scenes.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { FIXED_NOW } from "../../dev/fixtures/appShell";
import { SCENE_NAMES, type SceneName } from "../../dev/scenes";

/** 每个场景的「渲染完成」锚点:等它出现再截图,避免拍到半渲染帧。 */
const ANCHOR: Record<SceneName, string> = {
  "report-battle": "[data-testid=rpt-timeline]",
  "report-replay": "[data-testid=rpt-replay-field]",
  "report-ai": ".rpt-match",
  "report-synth": "[data-testid=rpt-timeline]",
  dashboard: "[data-testid=stats-dashboard]",
  settings: "[data-testid=settings-panel]",
  matchlist: "[data-testid=match-list]",
};

for (const scene of SCENE_NAMES) {
  test(`场景 ${scene} 与基线一致`, async ({ page }) => {
    // 只钉死 Date.now()/new Date(),不接管定时器 —— App 的后台补载用 setTimeout,
    // 假定时器会把它冻住。
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.goto(`/?scene=${scene}`);
    await expect(page.locator(`[data-scene-ready=${scene}]`)).toBeAttached();
    await expect(page.locator(ANCHOR[scene])).toBeVisible();
    await expect(page).toHaveScreenshot(`${scene}.png`, { fullPage: true });
  });
}
```

- [ ] **Step 5: 加 npm scripts**

`packages/desktop/package.json` 的 scripts 追加:

```json
    "test:visual": "playwright test -c qa/playwright.config.ts --project=visual",
    "test:visual:smoke": "playwright test -c qa/playwright.config.ts --project=visual --ignore-snapshots",
```

**基线由 CI 生成(2026-07-19 决议)**:本机无容器运行时,linux 基线改由 GitHub Actions 产出(见 Task 6),CI 既是基线的生产者也是判定者——单源约束原样成立。本机只跑 `test:visual:smoke`:`--ignore-snapshots` 让它验证「测试跑得通、场景渲染得出来」,同时**不比对也不写入**任何基线图。这一点是硬要求:本机直跑 `test:visual` 在基线缺失时会把 mac 截图写成基线,正是要避免的事。

在 `qa/playwright.config.ts` 顶部写清楚:

```ts
// 基线是 linux 单源,由 CI 生成与判定(.github/workflows/test.yml 的
// frontend-qa job + visual-baseline workflow)。本机只跑
// npm run test:visual:smoke —— 它带 --ignore-snapshots,不比对也不写基线;
// 直跑 test:visual 会在基线缺失时写入 mac 截图,污染单源。
```

- [ ] **Step 6: 本机冒烟(不产基线)**

```bash
cd packages/desktop && npm run test:visual:smoke
```

Expected: `7 passed`。这一步只证明 7 个场景都能渲染出锚点元素、axe 之外的流程跑得通。**不会**产生 `qa/__screenshots__/` 下的任何文件——跑完确认 `git status` 里没有 png。

若某场景超时,说明锚点选择器或场景本身有问题,在这里修掉(比留到 CI 便宜得多)。

- [ ] **Step 7: 确认没有误写基线**

```bash
cd /Users/mingjianliu/code/gladlog && git status --short packages/desktop/qa/
```

Expected: 只有 `.ts` 文件,**没有任何 `.png`**。若出现 png,说明跑成了 `test:visual` 而不是 smoke——删掉它们重来,mac 基线一旦提交就破坏了单源。

- [ ] **Step 8: 全量检查 + 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop --quiet
git add packages/desktop/qa packages/desktop/package.json packages/desktop/vitest.config.ts packages/desktop/tsconfig.json .gitignore package-lock.json
git commit -m "test(visual): Playwright 视觉回归骨架 —— 7 场景,基线待 CI 生成"
```

基线图本身在 Task 6 生成并单独提交。

---

## Task 5: axe 无障碍扫描 + 豁免清单

**Files:**

- Create: `packages/desktop/qa/axe-allowlist.ts`
- Modify: `packages/desktop/qa/visual/scenes.spec.ts`

**Interfaces:**

- Consumes: Task 4 的场景测试与 `ANCHOR` 表
- Produces:
  - `export type AxeExemption = { rule: string; selector: string; why: string }`
  - `export const AXE_EXEMPTIONS: AxeExemption[]`
  - `export function isExempt(rule: string, target: string): boolean`

- [ ] **Step 1: 装依赖**

```bash
npm i -D -w @gladlog/desktop @axe-core/playwright
```

- [ ] **Step 2: 写豁免清单骨架**

创建 `packages/desktop/qa/axe-allowlist.ts`:

```ts
/** 无障碍豁免清单:标准是 WCAG 2.1 A+AA,违规集合必须 ⊆ 本清单。
 *  政策 = 修或显式豁免,不许静默。本文件就是可见的技术债清单。 */
export type AxeExemption = {
  /** axe 规则 id,如 "color-contrast" */
  rule: string;
  /** 违规节点选择器(axe 报的 target[0]),支持前缀匹配 */
  selector: string;
  /** 为什么接受 —— 一行说清 */
  why: string;
};

export const AXE_EXEMPTIONS: AxeExemption[] = [];

export function isExempt(rule: string, target: string): boolean {
  return AXE_EXEMPTIONS.some(
    (e) => e.rule === rule && target.startsWith(e.selector),
  );
}
```

- [ ] **Step 3: 把 axe 挂进场景测试**

`qa/visual/scenes.spec.ts` 顶部 import 追加:

```ts
import AxeBuilder from "@axe-core/playwright";

import { isExempt } from "../axe-allowlist";
```

在 `toHaveScreenshot` 之后、测试体末尾追加:

```ts
const axe = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa"])
  .analyze();
const unexpected = axe.violations.flatMap((v) =>
  v.nodes
    .map((n) => ({ rule: v.id, target: n.target.join(" ") }))
    .filter((x) => !isExempt(x.rule, x.target)),
);
expect(
  unexpected,
  `场景 ${scene} 出现未豁免的无障碍违规;修掉它,或写进 qa/axe-allowlist.ts 并说明理由`,
).toEqual([]);
```

- [ ] **Step 4: 跑一次,看首扫结果**

```bash
cd packages/desktop && npm run test:visual:smoke
```

Expected: 大概率 FAIL,列出一批违规(深色游戏风 UI 的 `color-contrast` 最典型)。把每条的 `rule` 与 `target` 记下来。

- [ ] **Step 5: 逐条裁决**

对每条违规二选一,**不许第三种处理**:

1. **能改就改**——`color-contrast` 若只差一点,调 `src/renderer/src/styles.css` 里对应颜色(改完必须重跑 `test:visual:update` 更新基线,因为颜色变了)。
2. **接受则登记**——写进 `AXE_EXEMPTIONS`,理由要具体。例:

```ts
export const AXE_EXEMPTIONS: AxeExemption[] = [
  {
    rule: "color-contrast",
    selector: ".rpt-meter-sub",
    why: "次级数值(占比/人均)按信息层级刻意压暗;对比度 3.8:1,低于 AA 的 4.5:1。待整体配色调档时一并抬亮。",
  },
];
```

裁决完重跑 Step 4 的命令,直到 `7 passed`。

- [ ] **Step 6: 全量检查 + 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop --quiet
git add packages/desktop/qa packages/desktop/package.json package-lock.json
# 若 Step 5 改了配色,把 styles.css 与更新后的基线一并加入
git commit -m "test(a11y): axe WCAG 2.1 AA 扫描 + 显式豁免清单"
```

---

## Task 6: CI 接入(视觉 + axe)

**Files:**

- Modify: `.github/workflows/test.yml`

**Interfaces:**

- Consumes: Task 4/5 的 `test:visual` script 与基线
- Produces: `frontend-qa` job(本 task 只含 visual 部分;Task 13 追加 e2e 部分)

- [ ] **Step 1: 加 job**

`.github/workflows/test.yml` 在现有 `test` job 之后追加(与之并行,不拖慢快反馈):

```yaml
frontend-qa:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm

    - run: npm ci

    # 浏览器二进制按 Playwright 版本缓存,避免每次 CI 重下
    - name: Playwright version
      id: pw
      run: echo "v=$(npx playwright --version | tr -d ' ')" >> "$GITHUB_OUTPUT"

    - uses: actions/cache@v4
      id: pw-cache
      with:
        path: ~/.cache/ms-playwright
        key: playwright-${{ runner.os }}-${{ steps.pw.outputs.v }}

    - name: Install browsers
      run: npx playwright install --with-deps chromium

    # 视觉回归 + axe:基线是 linux 单源,CI 即权威
    - name: Visual regression + a11y
      run: npm -w @gladlog/desktop run test:visual

    # 失败必须留证:没有 diff 三联图就无法人工裁决
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: |
          packages/desktop/qa/playwright-report/
          packages/desktop/qa/test-results/
        retention-days: 14
```

注意 job 里跑的是 `test:visual`(CI 本身就是 linux,不需要容器)。

- [ ] **Step 1b: 加基线生成 workflow**

本机无容器运行时,linux 基线由 CI 产出(2026-07-19 决议)。新建 `.github/workflows/visual-baseline.yml`——**手动触发**,跑 `--update-snapshots` 并把生成的 png 作为 artifact 上传:

```yaml
name: visual-baseline

# 手动触发:生成/更新 linux 截图基线,产物下载后由人审、再提交。
# 基线的权威在人 —— 这个 workflow 只负责在与 CI 同一环境里把图画出来。
on: workflow_dispatch

jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Install browsers
        run: npx playwright install --with-deps chromium

      - name: Generate baselines
        run: npm -w @gladlog/desktop run test:visual -- --update-snapshots

      - uses: actions/upload-artifact@v4
        with:
          name: visual-baselines
          path: packages/desktop/qa/__screenshots__/
          retention-days: 7
```

- [ ] **Step 2: 本地验证 workflow 语法**

```bash
npx --yes yaml-lint .github/workflows/test.yml 2>/dev/null || node -e "
const yaml=require('js-yaml');const fs=require('fs');
yaml.load(fs.readFileSync('.github/workflows/test.yml','utf8'));
console.log('workflow YAML ok');
"
```

Expected: `workflow YAML ok`(或 lint 通过)。若两个命令都因缺依赖失败,跳过本步,靠 Step 4 的真实 CI 结果验证。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/test.yml
git commit -m "ci: frontend-qa job —— 视觉回归 + a11y,失败上传 diff 产物"
```

- [ ] **Step 4: 推分支,生成基线**

```bash
git push -u origin HEAD
gh workflow run visual-baseline.yml --ref "$(git branch --show-current)"
sleep 30
gh run watch "$(gh run list --workflow=visual-baseline.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: baseline job 通过(`--update-snapshots` 下所有场景都算 pass)。

- [ ] **Step 5: 下载基线并肉眼审**

```bash
cd /Users/mingjianliu/code/gladlog
gh run download "$(gh run list --workflow=visual-baseline.yml --limit 1 --json databaseId --jq '.[0].databaseId')" \
  -n visual-baselines -D packages/desktop/qa/__screenshots__/
find packages/desktop/qa/__screenshots__ -name "*.png" | sort
```

Expected: 7 个 png。**逐张打开看一遍**——基线即标准,一张画错的基线会把错误固化成「正确」。确认七张分别是:战报、回放、AI 分析、合成战报、仪表盘、设置、比赛列表,且内容不是空态/报错页。

- [ ] **Step 6: 提交基线**

```bash
git add packages/desktop/qa/__screenshots__
git commit -m "test(visual): 提交 CI 生成的 7 张 linux 基线(人工审过)"
git push
```

- [ ] **Step 7: 确认判定生效**

```bash
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: `frontend-qa` job 通过——这次是**真的在比对**基线,不再是缺图跳过。

若某场景报 diff:说明该场景不确定性(未冻结的时间、随机数、异步竞态)。**先查确定性漏洞,不许调大容差**;修完重新走 Step 4-6 更新基线。

---

# Phase 2 — 解析速度预算

## Task 7: 确定性合成战斗日志生成器

E2E 的「导入→报告」链路需要一份能走通真 parser 的原始日志;解析预算需要一份可放大的大日志。用同一个确定性生成器供三处消费(E2E、解析预算、首渲预算),**不提交真实玩家日志**——无 PII、可复现、体积可调。

**Files:**

- Create: `packages/parser/src/testing/synthLog.ts`
- Create: `packages/parser/test/synthLog.test.ts`

**Interfaces:**

- Consumes: `GladLogParser`(`packages/parser/src/api.ts`);行格式参照 `packages/parser/test/l2.segmenter.synthetic.test.ts`
- Produces:
  - `export function synthArenaLog(opts?: { rounds?: number; eventsPerRound?: number; startMs?: number }): string`
  - 默认参数产出 1 场 3v3、6 名玩家、含位置信息与至少 1 次死亡的完整日志
  - 消费方:Task 8(预算)、Task 10(E2E 导入)、Task 14(首渲大局)

- [ ] **Step 1: 写失败的测试**

创建 `packages/parser/test/synthLog.test.ts`:

```ts
import { GladLogParser } from "../src/api";
import type { GladMatch } from "../src/l3/model";
import { synthArenaLog } from "../src/testing/synthLog";

function parse(text: string): GladMatch[] {
  const out: GladMatch[] = [];
  const p = new GladLogParser({ timezone: "UTC" });
  p.on("match", (m) => out.push(m));
  for (const line of text.split("\n")) if (line.trim()) p.pushLine(line);
  p.end();
  return out;
}

describe("synthArenaLog", () => {
  it("默认产出恰好一场可解析的 3v3", () => {
    const matches = parse(synthArenaLog());
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bracket).toBe("3v3");
  });

  it("含 6 名玩家、伤害与治疗、至少一次死亡", () => {
    const m = parse(synthArenaLog())[0]!;
    const units = Object.values(m.units);
    expect(units.filter((u) => u.kind === "player")).toHaveLength(6);
    expect(units.some((u) => (u.damageOut ?? []).length > 0)).toBe(true);
    expect(units.some((u) => (u.healOut ?? []).length > 0)).toBe(true);
    expect(units.some((u) => (u.deaths ?? []).length > 0)).toBe(true);
  });

  it("确定性:同参数两次生成逐字节相同", () => {
    expect(synthArenaLog()).toBe(synthArenaLog());
  });

  it("eventsPerRound 可放大体积(供预算测试造大日志)", () => {
    const small = synthArenaLog({ eventsPerRound: 50 });
    const big = synthArenaLog({ eventsPerRound: 500 });
    expect(big.length).toBeGreaterThan(small.length * 5);
    expect(parse(big)).toHaveLength(1);
  });
});
```

**先核对真实 API**:运行 `grep -n "pushLine\|on(" packages/parser/src/api.ts` 确认推行方法名与事件订阅方法名。若不是 `pushLine`/`on`,按实际签名改测试(例如 `p.push(raw)`),**不要凭猜**。同样确认 `GladMatch.units` 的元素字段名(`kind`/`damageOut`/`healOut`/`deaths`)与 `packages/parser/src/l3/model.ts` 一致。

- [ ] **Step 2: 运行测试,确认失败**

```bash
npm test --workspace=packages/parser -- synthLog
```

Expected: FAIL——`Failed to resolve import "../src/testing/synthLog"`。

- [ ] **Step 3: 实现生成器**

创建 `packages/parser/src/testing/synthLog.ts`。以 `test/l2.segmenter.synthetic.test.ts` 的行格式为准(时间戳前缀 + 事件名 + 参数),六名玩家分两队,轮流造 `SPELL_DAMAGE` / `SPELL_HEAL` / `SPELL_CAST_SUCCESS`,末尾造一次 `UNIT_DIED` 再 `ARENA_MATCH_END`:

```ts
/** 确定性合成战斗日志:E2E 导入链路与性能预算的共同载荷。
 *  无真实玩家数据,可按 eventsPerRound 放大体积,同参数逐字节可复现。 */
export function synthArenaLog(opts?: {
  rounds?: number;
  eventsPerRound?: number;
  startMs?: number;
}): string {
  const eventsPerRound = opts?.eventsPerRound ?? 200;
  const startMs = opts?.startMs ?? Date.UTC(2026, 6, 19, 12, 0, 0);

  const players = [
    { guid: "Player-1-0001", name: "Alpha-Realm", flags: "0x511", team: 0 },
    { guid: "Player-1-0002", name: "Bravo-Realm", flags: "0x511", team: 0 },
    { guid: "Player-1-0003", name: "Charlie-Realm", flags: "0x511", team: 0 },
    { guid: "Player-1-0004", name: "Delta-Realm", flags: "0x548", team: 1 },
    { guid: "Player-1-0005", name: "Echo-Realm", flags: "0x548", team: 1 },
    { guid: "Player-1-0006", name: "Foxtrot-Realm", flags: "0x548", team: 1 },
  ];

  const ts = (offsetMs: number): string => {
    const d = new Date(startMs + offsetMs);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const p3 = (n: number) => String(n).padStart(3, "0");
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${p2(
      d.getUTCHours(),
    )}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(
      d.getUTCMilliseconds(),
    )}`;
  };

  const lines: string[] = [];
  const push = (offsetMs: number, body: string) =>
    lines.push(`${ts(offsetMs)}  ${body}`);

  push(0, "ARENA_MATCH_START,1505,41,3v3,1");

  // 每名玩家一条 COMBATANT_INFO(职责:让 l3 认出阵容/专精)
  players.forEach((p, i) => {
    push(
      10,
      `COMBATANT_INFO,${p.guid},${p.team},0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[],[],[],0,0,0,0,${
        70 + i
      }`,
    );
  });

  // 主体事件:攻击方轮转打对面,治疗方回自己人;位置随事件推进
  for (let i = 0; i < eventsPerRound; i++) {
    const t = 1000 + i * 100;
    const src = players[i % 6]!;
    const dst = players[(i + 3) % 6]!;
    const x = (1000 + (i % 50)).toFixed(2);
    const y = (-2000 - (i % 50)).toFixed(2);
    // advanced 参数尾巴:…,currHP,maxHP,…,x,y,…(位置供回放使用)
    const advanced = `${src.guid},0000000000000000,100000,100000,0,0,0,0,0,0,3,${x},${y},0,1.00,0,1.0,70`;
    if (i % 3 === 2) {
      push(
        t,
        `SPELL_HEAL,${src.guid},"${src.name}",${src.flags},0x0,${src.guid},"${src.name}",${src.flags},0x0,2061,"Flash Heal",0x2,${advanced},4500,0,0,nil`,
      );
    } else {
      push(
        t,
        `SPELL_DAMAGE,${src.guid},"${src.name}",${src.flags},0x0,${dst.guid},"${dst.name}",${dst.flags},0x0,133,"Fireball",0x4,${advanced},3200,0,4,0,0,0,nil,nil,nil`,
      );
    }
  }

  const victim = players[5]!;
  const endT = 1000 + eventsPerRound * 100 + 500;
  push(
    endT,
    `UNIT_DIED,0000000000000000,nil,0x0,0x0,${victim.guid},"${victim.name}",${victim.flags},0x0`,
  );
  push(endT + 500, "ARENA_MATCH_END,0,30,1500,1501");

  return lines.join("\n") + "\n";
}
```

**这段模板必然需要按真实 parser 调整**(字段顺序/数量、`COMBATANT_INFO` 的实际列数、advanced 参数位)。调整依据只有两个:`packages/parser/src/l1/parseLine.ts` 的解析逻辑,和 `packages/parser/test/fixtures/combatant_info_sample.txt` 的真实样例。改到 Step 4 的测试全绿为止——**测试是判据,不是模板**。

- [ ] **Step 4: 运行测试,确认通过**

```bash
npm test --workspace=packages/parser -- synthLog
```

Expected: PASS(4 passed)

- [ ] **Step 5: 全量检查 + 提交**

```bash
npm test --workspace=packages/parser && npm run typecheck && npx eslint packages/parser --quiet
git add packages/parser/src/testing packages/parser/test/synthLog.test.ts
git commit -m "test(parser): 确定性合成战斗日志生成器 —— E2E 与预算的共同载荷"
```

---

## Task 8: 解析速度预算(measure 模式)

**Files:**

- Create: `packages/parser/test/parseBudget.test.ts`
- Create: `packages/desktop/qa/budgets.ts`

**Interfaces:**

- Consumes: Task 7 的 `synthArenaLog`
- Produces:
  - `packages/desktop/qa/budgets.ts` 导出 `export const BUDGET_MS = { parse: number | null; firstPaint: number | null; coldStart: number | null }`——`null` = 尚未锁定(只测量不断言),Task 15 填真数字
  - 统一日志格式:`[budget] <name>=<ms>ms n=<samples>`,CI 日志即数据源

**为什么预算常量放 desktop 而 parser 测试要 import 它**:三个预算是同一套策略下的同一族常量,必须一处 export 两边 import(门规谓词即规范)。parser 包 import desktop 包会形成反向依赖——因此 `qa/budgets.ts` 只放**数值与策略**,不 import 任何 desktop 代码,parser 测试用相对路径深引:`../../desktop/qa/budgets`。若 lint/ts 对跨包相对引用报错,改为把 `budgets.ts` 放 `packages/corpus-tools` 之外的中立位置 `qa-budgets/budgets.ts`(仓库根),两边都相对引用。

- [ ] **Step 1: 写预算常量模块**

创建 `packages/desktop/qa/budgets.ts`:

```ts
/** 性能预算(measure-then-lock)。
 *
 *  策略:先只测量、不断言 —— 每次运行都打印 `[budget] name=…ms`;
 *  攒到真实 CI 数字后取 p95 × 1.5 写进本文件,此后越线即红。
 *  null = 尚未锁定。放宽任何一个值都要把理由写进 commit message。
 *
 *  三处消费:parse → packages/parser/test/parseBudget.test.ts
 *           firstPaint → packages/desktop/qa/visual/firstPaint.spec.ts
 *           coldStart → packages/desktop/qa/e2e/import.spec.ts
 */
export const BUDGET_MS: {
  parse: number | null;
  firstPaint: number | null;
  coldStart: number | null;
} = {
  parse: null,
  firstPaint: null,
  coldStart: null,
};

/** 统一的测量输出格式 —— CI 日志就是锁定预算时的数据源。 */
export function reportBudget(name: string, ms: number, samples: number): void {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${name}=${ms.toFixed(0)}ms n=${samples}`);
}
```

- [ ] **Step 2: 写解析预算测试**

创建 `packages/parser/test/parseBudget.test.ts`:

```ts
import { BUDGET_MS, reportBudget } from "../../desktop/qa/budgets";
import { GladLogParser } from "../src/api";
import { synthArenaLog } from "../src/testing/synthLog";

/** 大号载荷:约 20 万行,贴近一晚上的真实战斗日志量级。 */
const BIG_LOG = synthArenaLog({ eventsPerRound: 200_000 });

function parseOnce(text: string): number {
  const t0 = performance.now();
  const p = new GladLogParser({ timezone: "UTC" });
  let matches = 0;
  p.on("match", () => matches++);
  for (const line of text.split("\n")) if (line.trim()) p.pushLine(line);
  p.end();
  if (matches !== 1) throw new Error(`期望 1 场,实得 ${matches}`);
  return performance.now() - t0;
}

describe("解析速度预算", () => {
  it("大日志解析耗时在预算内(未锁定时只测量)", () => {
    const runs = [1, 2, 3].map(() => parseOnce(BIG_LOG)).sort((a, b) => a - b);
    const median = runs[1]!;
    reportBudget("parse", median, runs.length);
    if (BUDGET_MS.parse !== null) {
      expect(median).toBeLessThan(BUDGET_MS.parse);
    }
  }, 120_000);
});
```

- [ ] **Step 3: 运行,确认测量输出**

```bash
npm test --workspace=packages/parser -- parseBudget
```

Expected: PASS,输出里有一行形如 `[budget] parse=3140ms n=3`。若耗时超过 120s 超时,把 `eventsPerRound` 降到 100_000 并在注释里同步改掉「约 20 万行」的说法。

- [ ] **Step 4: 确认它进了 `npm test`**

```bash
npm test 2>&1 | grep "\[budget\]"
```

Expected: 至少一行 `[budget] parse=…`。这条测试是普通 vitest 测试,自然随 CI 的 `npm test` 跑,不需要新 job。

- [ ] **Step 5: 全量检查 + 提交**

```bash
npm run typecheck && npx eslint packages/parser packages/desktop/qa --quiet
git add packages/parser/test/parseBudget.test.ts packages/desktop/qa/budgets.ts
git commit -m "test(perf): 解析速度预算 harness(measure 模式,预算待 CI 数字锁定)"
```

---

# Phase 3 — E2E 三链路 + 冷启动

## Task 9: GLADLOG_E2E 环境开关(userData 重定向)

E2E 必须跑在干净的临时 userData 上,否则会读写用户真实数据、且每次跑结果依赖历史状态。**生产代码只加这一处开关**——对话框打桩与 AI 结果都从测试侧注入,不进生产分支。

**Files:**

- Create: `packages/desktop/src/main/e2eEnv.ts`
- Create: `packages/desktop/src/main/e2eEnv.test.ts`
- Modify: `packages/desktop/src/main/index.ts:22`

**Interfaces:**

- Consumes: 无
- Produces: `export function e2eUserDataDir(env: NodeJS.ProcessEnv): string | null`——`GLADLOG_E2E=1` 且 `GLADLOG_E2E_USER_DATA` 为绝对路径时返回该路径,否则 `null`。Task 10 的 launch 参数依赖这两个环境变量名。

- [ ] **Step 1: 写失败的测试**

创建 `packages/desktop/src/main/e2eEnv.test.ts`:

```ts
import { e2eUserDataDir } from "./e2eEnv";

describe("e2eUserDataDir", () => {
  it("未开启 → null", () => {
    expect(e2eUserDataDir({})).toBeNull();
    expect(e2eUserDataDir({ GLADLOG_E2E_USER_DATA: "/tmp/x" })).toBeNull();
  });

  it("开启且给了绝对路径 → 返回该路径", () => {
    expect(
      e2eUserDataDir({
        GLADLOG_E2E: "1",
        GLADLOG_E2E_USER_DATA: "/tmp/gl-e2e",
      }),
    ).toBe("/tmp/gl-e2e");
  });

  it("开启但路径缺失或非绝对 → 抛错(绝不回落到真实 userData)", () => {
    expect(() => e2eUserDataDir({ GLADLOG_E2E: "1" })).toThrow();
    expect(() =>
      e2eUserDataDir({ GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: "rel/path" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
npm test --workspace=packages/desktop -- e2eEnv
```

Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

创建 `packages/desktop/src/main/e2eEnv.ts`:

```ts
import { isAbsolute } from "path";

/**
 * E2E 模式下的 userData 目录。开关只做一件事:把状态目录挪到临时路径,
 * 让端到端测试跑在干净、可丢弃的状态上。
 *
 * 开启却没给合法路径时**抛错而不是回落** —— 静默用真实 userData 会让
 * 测试污染用户数据。
 */
export function e2eUserDataDir(env: NodeJS.ProcessEnv): string | null {
  if (env["GLADLOG_E2E"] !== "1") return null;
  const dir = env["GLADLOG_E2E_USER_DATA"];
  if (!dir || !isAbsolute(dir)) {
    throw new Error(
      "GLADLOG_E2E=1 需要 GLADLOG_E2E_USER_DATA 指向一个绝对路径",
    );
  }
  return dir;
}
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
npm test --workspace=packages/desktop -- e2eEnv
```

Expected: PASS(3 passed)

- [ ] **Step 5: 接进 main**

`packages/desktop/src/main/index.ts`:import 区加

```ts
import { e2eUserDataDir } from "./e2eEnv";
```

**位置至关重要**——`settings` 在模块顶层就用 `app.getPath("userData")` 构造(第 33-35 行),所以重定向必须在那之前。在 `app.setName("gladlog");`(第 22 行)之后紧接着插入:

```ts
// E2E:必须早于任何 app.getPath("userData") 调用(下方 settings 即是)
const e2eDir = e2eUserDataDir(process.env);
if (e2eDir) app.setPath("userData", e2eDir);
```

- [ ] **Step 6: 验证顺序正确**

```bash
npm test --workspace=packages/desktop && npm run typecheck
node -e "
const s=require('fs').readFileSync('packages/desktop/src/main/index.ts','utf8');
const setPath=s.indexOf('app.setPath(\"userData\"');
const getPath=s.indexOf('app.getPath(\"userData\")');
if(setPath<0||getPath<0) throw new Error('未找到预期调用');
if(setPath>getPath) throw new Error('setPath 必须早于第一次 getPath');
console.log('userData 重定向顺序正确');
"
```

Expected: `userData 重定向顺序正确`

- [ ] **Step 7: 提交**

```bash
npx eslint packages/desktop/src --quiet
git add packages/desktop/src/main/e2eEnv.ts packages/desktop/src/main/e2eEnv.test.ts packages/desktop/src/main/index.ts
git commit -m "feat(main): GLADLOG_E2E userData 重定向 —— E2E 跑在临时状态上"
```

---

## Task 10: E2E 链路 1(导入→报告)+ 冷启动计时

**Files:**

- Create: `packages/desktop/qa/e2e/import.spec.ts`
- Modify: `packages/desktop/package.json`

**Interfaces:**

- Consumes: Task 7 `synthArenaLog`;Task 9 的 `GLADLOG_E2E` / `GLADLOG_E2E_USER_DATA`;Task 8 的 `BUDGET_MS.coldStart` / `reportBudget`
- Produces:
  - npm script `test:e2e`
  - 供 Task 11/12 复用的启动样式(每个 spec 自带 `launchApp` 局部实现,避免过早抽象;第三个 spec 出现时再抽到 `qa/support/launch.ts`)

- [ ] **Step 1: 加 npm script**

`packages/desktop/package.json` scripts 追加:

```json
    "test:e2e": "electron-vite build && playwright test -c qa/playwright.config.ts --project=e2e",
```

- [ ] **Step 2: 写链路 1 测试**

创建 `packages/desktop/qa/e2e/import.spec.ts`:

```ts
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import { _electron as electron, expect, test } from "@playwright/test";

import { BUDGET_MS, reportBudget } from "../budgets";

test("链路1:导入日志 → 比赛列表 → 三视图都有内容", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  const t0 = Date.now();
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: {
      ...process.env,
      GLADLOG_E2E: "1",
      GLADLOG_E2E_USER_DATA: userData,
    },
  });
  const page = await app.firstWindow();

  // 冷启动:从 launch 到首屏可交互(空态引导可见)
  await expect(page.getByTestId("onboard")).toBeVisible({ timeout: 30_000 });
  const coldStart = Date.now() - t0;
  reportBudget("coldStart", coldStart, 1);
  if (BUDGET_MS.coldStart !== null) {
    expect(coldStart).toBeLessThan(BUDGET_MS.coldStart);
  }

  // 原生文件对话框无法自动化 —— 在主进程里换掉它,返回我们造的日志
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);

  await page.getByRole("button", { name: "导入历史日志…" }).click();

  // 入库后经 matchStored 事件进列表
  const rows = page.locator("[data-testid=match-list] li:not(.mlr-group)");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await rows.first().click();

  // 战报:生命曲线在
  await expect(page.getByTestId("rpt-timeline")).toBeVisible();

  // 回放:场地在
  await page.getByRole("button", { name: "回放" }).click();
  await expect(page.getByTestId("rpt-replay-field")).toBeVisible();

  // AI 分析:面板在(未配 key 时是空态/按钮,只断言面板存在)
  await page.getByRole("button", { name: "AI 分析" }).click();
  await expect(page.locator(".rpt-match")).toBeVisible();

  await app.close();
});
```

- [ ] **Step 3: 跑测试**

```bash
cd packages/desktop && npm run test:e2e
```

Expected: PASS(1 passed),输出含 `[budget] coldStart=…ms n=1`。

常见失败与对策:

- **窗口起不来/白屏**:确认 `electron-vite build` 真的产出了 `out/main/index.js`(`ls out/main/index.js`)。
- **点不到「导入历史日志…」**:空态分支要求 `wowDirectory == null`;临时 userData 是干净的,应当满足。若页面停在别的空态,先 `await page.screenshot({path:'/tmp/e2e.png'})` 看实际长相再调选择器。
- **列表始终为空**:说明合成日志没解析出对局。用 `npm test --workspace=packages/parser -- synthLog` 复核生成器——那里的断言才是判据。

- [ ] **Step 4: 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm run typecheck && npx eslint packages/desktop --quiet
git add packages/desktop/qa/e2e packages/desktop/package.json
git commit -m "test(e2e): 链路1 导入→报告 + 冷启动计时"
```

---

## Task 11: E2E 链路 2(finding→证据链)

AI findings 不打真 API——直接把 canned 结果写进分析缓存文件(与主进程写的是同一个文件、同一个 schema)。缓存带 `promptVersion` 校验,版本对不上会被丢弃,所以常量必须**共享而非硬编码**。

**Files:**

- Create: `packages/desktop/src/shared/promptVersion.ts`
- Modify: `packages/desktop/src/main/ai.ts:10`
- Create: `packages/desktop/qa/support/seedAnalysis.ts`
- Create: `packages/desktop/qa/e2e/evidence.spec.ts`

**Interfaces:**

- Consumes: Task 10 的启动方式;`analysis-v2.<lang>.json` 缓存约定(`src/main/analysis.ts:117-134` 写、`:609-625` 读)
- Produces:
  - `packages/desktop/src/shared/promptVersion.ts` → `export const PROMPT_VERSION = 12`(单源;`ai.ts` 改为 re-export)
  - `qa/support/seedAnalysis.ts` → `export function seedAnalysis(userData: string, matchId: string, findings: SeedFinding[]): void`
  - `export type SeedFinding = { eventIds: string[]; severity: "high" | "med" | "low"; category: string; title: string; explanation: string }`

- [ ] **Step 1: PROMPT_VERSION 提取为单源**

创建 `packages/desktop/src/shared/promptVersion.ts`:

```ts
/** 分析缓存的版本键:主进程写缓存、读缓存,E2E 播种缓存,三处共用同一常量。
 *  谓词单源 —— 硬编码副本会在版本变更时静默失效(缓存被丢弃、测试假绿)。
 *  v9: HP/短名;v10: 可教信号门 + owner 锚定 + 干净窗口留白;
 *  v11: 走位信号(第四类);v12: 进攻深挖(非死亡 finding) */
export const PROMPT_VERSION = 12;
```

`packages/desktop/src/main/ai.ts` 第 10 行的定义改为 re-export(保持所有既有 import 路径不变):

```ts
export { PROMPT_VERSION } from "../shared/promptVersion";
```

把原注释块移到 `shared/promptVersion.ts`(上面已含),`ai.ts` 里删掉重复注释。

- [ ] **Step 2: 验证没改坏**

```bash
npm test --workspace=packages/desktop && npm run typecheck
node -e "
const s=require('fs').readFileSync('packages/desktop/src/main/ai.ts','utf8');
if(/export const PROMPT_VERSION\s*=/.test(s)) throw new Error('ai.ts 仍有第二份定义');
console.log('PROMPT_VERSION 单源');
"
```

Expected: 测试全绿 + `PROMPT_VERSION 单源`

- [ ] **Step 3: 写播种助手**

创建 `packages/desktop/qa/support/seedAnalysis.ts`:

```ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { PROMPT_VERSION } from "../../src/shared/promptVersion";

export type SeedFinding = {
  eventIds: string[];
  severity: "high" | "med" | "low";
  category: string;
  title: string;
  explanation: string;
};

/**
 * 把 canned 分析结果写进主进程读的那个缓存文件,让 E2E 不打真 API 也有
 * findings 可点。写入格式与 src/main/analysis.ts 的 finish() 完全一致 ——
 * 包括 promptVersion(不一致会被 getCached 丢弃)。
 */
export function seedAnalysis(
  userData: string,
  matchId: string,
  findings: SeedFinding[],
): void {
  const dir = join(userData, "matches", matchId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "analysis-v2.zh.json"),
    JSON.stringify({
      schemaVersion: 1,
      promptVersion: PROMPT_VERSION,
      language: "zh",
      createdAt: Date.now(),
      result: { findings, dropped: 0, hadNarration: true, deepened: true },
    }),
    "utf-8",
  );
}
```

- [ ] **Step 4: 写链路 2 测试**

创建 `packages/desktop/qa/e2e/evidence.spec.ts`:

```ts
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import { _electron as electron, expect, test } from "@playwright/test";

import { seedAnalysis } from "../support/seedAnalysis";

test("链路2:点 finding 的「回放此刻」→ 切到回放视图", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  // 第一程:导入,拿到 matchId
  let app = await electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  let page = await app.firstWindow();
  await expect(page.getByTestId("onboard")).toBeVisible({ timeout: 30_000 });
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);
  await page.getByRole("button", { name: "导入历史日志…" }).click();
  const rows = page.locator("[data-testid=match-list] li:not(.mlr-group)");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });

  const matchId = await app.evaluate(async ({ app: a }) => {
    const { readdirSync } = await import("fs");
    const { join: j } = await import("path");
    return readdirSync(j(a.getPath("userData"), "matches")).filter(
      (n) => !n.startsWith("."),
    )[0]!;
  });
  await app.close();

  // 播种 canned findings,再启一程
  seedAnalysis(userData, matchId, [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "被集火秒杀",
      explanation: "E2E 播种的 finding,用于验证证据链跳转。",
    },
  ]);

  app = await electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await expect(rowsOf(page).first()).toBeVisible({ timeout: 30_000 });
  await rowsOf(page).first().click();
  await page.getByRole("button", { name: "AI 分析" }).click();

  // finding 卡片在,且带「回放此刻」
  await expect(page.getByText("被集火秒杀")).toBeVisible({ timeout: 30_000 });
  await page.locator(".rpt-finding-jump").first().click();

  // 跳转结果:回放 tab 变为选中,场地渲染
  await expect(page.locator(".rpt-view-tabs button.active")).toHaveText("回放");
  await expect(page.getByTestId("rpt-replay-field")).toBeVisible();

  await app.close();
});

function rowsOf(page: Page) {
  return page.locator("[data-testid=match-list] li:not(.mlr-group)");
}
```

顶部 import 区需要 `import type { Page } from "@playwright/test";`(与已有的 `expect, test, _electron as electron` 同一条 import 语句里加 `type Page` 也可以)。

- [ ] **Step 5: 跑测试**

```bash
cd packages/desktop && npm run test:e2e
```

Expected: PASS(2 passed——链路 1 与链路 2)。

若 finding 卡片不出现:先确认缓存文件真的被读到——`node -e "console.log(require('fs').readFileSync('<userData>/matches/<id>/analysis-v2.zh.json','utf8'))"`,再核对 `promptVersion` 与 `src/shared/promptVersion.ts` 一致(这正是把它做成单源的原因)。

- [ ] **Step 6: 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop --quiet
git add packages/desktop/src/shared/promptVersion.ts packages/desktop/src/main/ai.ts packages/desktop/qa
git commit -m "test(e2e): 链路2 finding→证据链;PROMPT_VERSION 提取为单源"
```

---

## Task 12: E2E 链路 3(教练闭环 + 重启持久化)

**Files:**

- Create: `packages/desktop/qa/support/launch.ts`
- Create: `packages/desktop/qa/e2e/coachLoop.spec.ts`
- Modify: `packages/desktop/qa/e2e/import.spec.ts`
- Modify: `packages/desktop/qa/e2e/evidence.spec.ts`

**Interfaces:**

- Consumes: Task 10/11 的启动与播种
- Produces:
  - `export async function launchApp(userData: string): Promise<{ app: ElectronApplication; page: Page }>`
  - `export function matchRows(page: Page): Locator`
  - `export async function importLog(app: ElectronApplication, page: Page, logPath: string): Promise<void>`
  - `export async function firstMatchId(app: ElectronApplication): Promise<string>`

第三个 spec 出现,启动样板已重复三次——现在抽,不早不晚。

- [ ] **Step 1: 抽公共启动助手**

创建 `packages/desktop/qa/support/launch.ts`:

```ts
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

export async function launchApp(
  userData: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  return { app, page };
}

export function matchRows(page: Page): Locator {
  return page.locator("[data-testid=match-list] li:not(.mlr-group)");
}

/** 打桩原生对话框 → 点导入 → 等第一行入列。 */
export async function importLog(
  app: ElectronApplication,
  page: Page,
  logPath: string,
): Promise<void> {
  await expect(page.getByTestId("onboard")).toBeVisible({ timeout: 30_000 });
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);
  await page.getByRole("button", { name: "导入历史日志…" }).click();
  await expect(matchRows(page).first()).toBeVisible({ timeout: 60_000 });
}

export async function firstMatchId(app: ElectronApplication): Promise<string> {
  return app.evaluate(async ({ app: a }) => {
    const { readdirSync } = await import("fs");
    const { join } = await import("path");
    return readdirSync(join(a.getPath("userData"), "matches")).filter(
      (n) => !n.startsWith("."),
    )[0]!;
  });
}
```

- [ ] **Step 2: 让前两个 spec 改用助手**

`import.spec.ts` 与 `evidence.spec.ts` 里的 `electron.launch(...)`、对话框打桩、`matchRows`、`firstMatchId` 都换成 import 助手函数。**注意 `import.spec.ts` 的冷启动计时必须保留在 spec 内**(它要测 launch 本身的耗时,不能藏进助手)——那里保留直接 `electron.launch` 调用,只把 `matchRows` 换掉。

改完跑:

```bash
cd packages/desktop && npm run test:e2e
```

Expected: PASS(2 passed),与重构前行为一致。

- [ ] **Step 3: 写链路 3 测试**

创建 `packages/desktop/qa/e2e/coachLoop.spec.ts`:

```ts
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import { expect, test } from "@playwright/test";

import {
  firstMatchId,
  importLog,
  launchApp,
  matchRows,
} from "../support/launch";
import { seedAnalysis } from "../support/seedAnalysis";

test("链路3:标记 finding → 战绩页聚合可见 → 重启后标记仍在", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  const first = await launchApp(userData);
  await importLog(first.app, first.page, logPath);
  const matchId = await firstMatchId(first.app);
  await first.app.close();

  seedAnalysis(userData, matchId, [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "目标选择",
      title: "爆发打进减伤",
      explanation: "E2E 播种的 finding,用于验证教练闭环。",
    },
  ]);

  // 第二程:标记「还在犯」
  const second = await launchApp(userData);
  await expect(matchRows(second.page).first()).toBeVisible({ timeout: 30_000 });
  await matchRows(second.page).first().click();
  await second.page.getByRole("button", { name: "AI 分析" }).click();
  await expect(second.page.getByText("爆发打进减伤")).toBeVisible({
    timeout: 30_000,
  });
  await second.page.getByRole("button", { name: "↻ 还在犯" }).first().click();
  await expect(
    second.page.locator(".rpt-finding-flags button.active"),
  ).toBeVisible();

  // 战绩页:错题本聚合出现该分类
  await second.page.getByRole("button", { name: "战绩" }).click();
  await expect(second.page.getByTestId("dash-notebook")).toContainText(
    "目标选择",
    { timeout: 30_000 },
  );
  await second.app.close();

  // 第三程:重启后标记仍在(持久化)
  const third = await launchApp(userData);
  await expect(matchRows(third.page).first()).toBeVisible({ timeout: 30_000 });
  await matchRows(third.page).first().click();
  await third.page.getByRole("button", { name: "AI 分析" }).click();
  await expect(
    third.page.locator(".rpt-finding-flags button.active"),
  ).toBeVisible({ timeout: 30_000 });
  await third.app.close();
});
```

- [ ] **Step 4: 跑测试**

```bash
cd packages/desktop && npm run test:e2e
```

Expected: PASS(3 passed)。

若「战绩」页的错题本不含该分类:`analysis.notebook()` 扫的是已分析对局的缓存,确认播种文件与 `findingFlags.json` 都落在 `<userData>/matches/<matchId>/` 下;标记写入是异步 IPC,必要时在切页前加一次对 `.rpt-finding-flags button.active` 的等待(上面已有)。

- [ ] **Step 5: 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm run typecheck && npx eslint packages/desktop --quiet
git add packages/desktop/qa
git commit -m "test(e2e): 链路3 教练闭环 + 重启持久化;抽出 launch 助手"
```

---

## Task 13: CI 接入 E2E

**Files:**

- Modify: `.github/workflows/test.yml`

**Interfaces:**

- Consumes: Task 6 的 `frontend-qa` job;Task 10 的 `test:e2e`
- Produces: 完整的 `frontend-qa`(visual + e2e),失败上传产物

- [ ] **Step 1: 在 frontend-qa job 追加 E2E 步骤**

在 `Visual regression + a11y` 步骤之后、`upload-artifact` 之前插入:

```yaml
# Electron 在无头 CI 里需要虚拟显示
- name: Build app bundle
  run: npm -w @gladlog/desktop run build

- name: E2E (three core journeys + cold start)
  run: xvfb-run --auto-servernum npx playwright test -c qa/playwright.config.ts --project=e2e
  working-directory: packages/desktop
```

`test:e2e` script 自带 `electron-vite build`,这里拆成两步是为了让构建失败与测试失败在 CI 日志里分得开。

- [ ] **Step 2: 提交并推**

```bash
git add .github/workflows/test.yml
git commit -m "ci: frontend-qa 追加 E2E 三链路(xvfb 无头 Electron)"
git push
```

- [ ] **Step 3: 确认 CI 绿并抓预算数字**

```bash
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
gh run view "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --log | grep "\[budget\]"
```

Expected: job 通过;日志里有 `[budget] parse=…` 与 `[budget] coldStart=…`。把这两个数字记下来——Task 15 要用。

若 Electron 在 CI 起不来(常见于缺 `libnss3` 等):`npx playwright install --with-deps chromium` 已装了绝大多数依赖;仍缺时在 build 步骤前加 `sudo apt-get update && sudo apt-get install -y libgbm1 libasound2t64`。

---

# Phase 4 — 首渲预算 + 预算锁定

## Task 14: 报表首渲预算(measure 模式)

**Files:**

- Create: `packages/desktop/qa/visual/firstPaint.spec.ts`
- Modify: `packages/desktop/dev/scenes.ts`
- Modify: `packages/desktop/dev/main.tsx`
- Modify: `packages/desktop/dev/fixtures/appShell.ts`

**Interfaces:**

- Consumes: Task 2 的场景机制;Task 8 的 `BUDGET_MS.firstPaint` / `reportBudget`
- Produces: 新场景 `"report-heavy"`——大号确定性合成局(运行时生成,不提交、不进截图基线)

- [ ] **Step 1: 加大号载荷场景**

`dev/scenes.ts` 的 `SCENE_NAMES` 追加 `"report-heavy"`。

**它只用于计时,不进截图基线**——`qa/visual/scenes.spec.ts` 必须跳过它。在该 spec 的循环前加过滤:

```ts
// report-heavy 是首渲计时专用的大号载荷,尺寸随机器/数据规模变化,不做像素基线
const SNAPSHOT_SCENES = SCENE_NAMES.filter((s) => s !== "report-heavy");
```

并把 `for (const scene of SCENE_NAMES)` 改为 `for (const scene of SNAPSHOT_SCENES)`,`ANCHOR` 的类型改为 `Record<(typeof SNAPSHOT_SCENES)[number], string>` 或直接 `Partial<Record<SceneName, string>>` 配合非空断言——以能过 typecheck 的最简写法为准。

- [ ] **Step 2: 生成大号 fixture**

`dev/fixtures/appShell.ts` 追加(浏览器端按种子放大现有真实样本,避免引入 parser 到浏览器包):

```ts
import type { StoredMatch } from "../../src/renderer/src/report/derive/types";

/** 首渲计时用的大号局:把真实样本的事件流按固定倍数复制并平移时间,
 *  形状与真实数据一致、规模放大 N 倍。确定性(无随机),但**不做截图基线**
 *  —— 它的价值是压出渲染耗时,不是锁定长相。 */
export function heavyMatch(base: StoredMatch, factor = 12): StoredMatch {
  const span = base.endTime - base.startTime;
  const units: Record<string, unknown> = {};
  for (const [id, u] of Object.entries(
    base.units as unknown as Record<string, Record<string, unknown>>,
  )) {
    const grown: Record<string, unknown> = { ...u };
    for (const field of [
      "damageOut",
      "damageIn",
      "healOut",
      "absorbsOut",
      "casts",
      "auraEvents",
      "advancedSamples",
    ]) {
      const arr = u[field] as
        Array<{ t?: number; timestamp?: number }> | undefined;
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const out: unknown[] = [];
      for (let k = 0; k < factor; k++) {
        for (const e of arr) {
          const shifted: Record<string, unknown> = { ...e };
          if (typeof e.t === "number") shifted["t"] = e.t + k * span;
          if (typeof e.timestamp === "number")
            shifted["timestamp"] = e.timestamp + k * span;
          out.push(shifted);
        }
      }
      grown[field] = out;
    }
    units[id] = grown;
  }
  return {
    ...base,
    endTime: base.startTime + span * factor,
    units,
  } as unknown as StoredMatch;
}
```

`dev/main.tsx` 的 `SCENE_VIEW` 追加:

```tsx
  "report-heavy": {
    fixture: heavyMatch(realMatch as unknown as StoredMatch),
    initialView: "report",
  },
```

(并在 import 区加 `import { heavyMatch } from "./fixtures/appShell";`)

- [ ] **Step 3: 写首渲计时**

创建 `packages/desktop/qa/visual/firstPaint.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { FIXED_NOW } from "../../dev/fixtures/appShell";
import { BUDGET_MS, reportBudget } from "../budgets";

test("大号对局的报表首渲在预算内(未锁定时只测量)", async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_NOW));

  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await page.goto(`/?scene=report-heavy&i=${i}`);
    await expect(page.getByTestId("rpt-timeline")).toBeVisible({
      timeout: 60_000,
    });
    samples.push(Date.now() - t0);
  }
  const median = samples.sort((a, b) => a - b)[1]!;
  reportBudget("firstPaint", median, samples.length);
  if (BUDGET_MS.firstPaint !== null) {
    expect(median).toBeLessThan(BUDGET_MS.firstPaint);
  }
});
```

- [ ] **Step 4: 跑一次**

```bash
cd packages/desktop && npm run test:visual:smoke
```

Expected: 全绿(7 张截图 + 1 条首渲计时),输出含 `[budget] firstPaint=…ms n=3`。

若 `report-heavy` 渲染超过 60s,把 `heavyMatch` 的 `factor` 从 12 降到 6,并在注释里同步改。

- [ ] **Step 5: 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop --quiet
git add packages/desktop/dev packages/desktop/qa
git commit -m "test(perf): 报表首渲预算 harness(大号确定性载荷,measure 模式)"
```

---

## Task 15: 用真实 CI 数字锁定三个预算

**Files:**

- Modify: `packages/desktop/qa/budgets.ts`
- Modify: `docs/verifiability-roadmap.md`

**Interfaces:**

- Consumes: Task 8/10/14 打印的 `[budget]` 行
- Produces: `BUDGET_MS` 三项从 `null` 变为具体毫秒数;路线图 C2 标记完成

- [ ] **Step 1: 推分支,让 CI 跑满 5 次**

```bash
git push
for i in 1 2 3 4 5; do
  gh workflow run test.yml --ref "$(git branch --show-current)"
  sleep 20
done
```

等全部跑完(`gh run list --limit 6`)。

- [ ] **Step 2: 收集样本**

```bash
for id in $(gh run list --workflow=test.yml --limit 5 --json databaseId --jq '.[].databaseId'); do
  gh run view "$id" --log | grep "\[budget\]"
done
```

Expected: 15 行左右(每次运行 3 个指标)。把每个指标的 5 个样本抄下来。

- [ ] **Step 3: 算 p95 × 1.5 并写死**

对每个指标:排序后取第 5 个样本(n=5 时的 p95 近似取最大值),乘 1.5,向上取整到百位。

例如 `parse` 五次为 3100/3240/3180/3900/3220 → 最大 3900 × 1.5 = 5850 → 写 **5900**。

`packages/desktop/qa/budgets.ts` 改为:

```ts
export const BUDGET_MS: {
  parse: number | null;
  firstPaint: number | null;
  coldStart: number | null;
} = {
  // 锁定依据:2026-07-19 CI(ubuntu-latest)5 次采样的最大值 × 1.5。
  // ×1.5 余量为 runner 波动而留;这三条抓的是数量级回退(例如意外的 O(n²)),
  // 不是 5% 抖动。放宽任何一个值都要把理由写进 commit message。
  parse: 5900,
  firstPaint: 4500,
  coldStart: 12000,
};
```

(三个数字换成 Step 3 实算的结果,不要照抄示例。)

- [ ] **Step 4: 验证断言真的生效**

```bash
npm test --workspace=packages/parser -- parseBudget
cd packages/desktop && npm run test:visual:smoke && npm run test:e2e
```

Expected: 全绿。再做一次**反向验证**——临时把 `parse` 改成 `1`,重跑 `npm test --workspace=packages/parser -- parseBudget`,确认 FAIL(证明断言不是摆设),然后改回。

- [ ] **Step 5: 更新路线图**

`docs/verifiability-roadmap.md`:

- 第 32 行 VISION 行的现状,把 `visual-regression (C2) + export (C3) remain` 改为 `C2 视觉回归已落地(Playwright,7 场景 linux 单源基线 + axe WCAG AA + E2E 三链路 + 性能预算);export (C3) remains`
- 第 100-102 行 C2 条目前加 ✅ 与完成日期 `_(done 2026-07-19)_`
- 第 121 行「Suggested order」的第 3 条改为 `~~C2~~ ✅ done 2026-07-19;C3(export)待做`
- 第 128-130 行「Next up」里的 C2 条目删除(已完成),C3 升为 next

- [ ] **Step 6: 全量检查 + 提交**

```bash
cd /Users/mingjianliu/code/gladlog
npm test && npm run typecheck && npm run lint
git add packages/desktop/qa/budgets.ts docs/verifiability-roadmap.md
git commit -m "test(perf): 用 CI 实测数字锁定三个性能预算;路线图 C2 收官"
git push
```

- [ ] **Step 7: 最终确认 CI 全绿**

```bash
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: `test` 与 `frontend-qa` 两个 job 都通过。

---

## 收尾检查清单

全部 15 个 task 完成后,逐条确认(每条都要有证据,不许凭印象):

- [ ] `npm test` 全绿,且日志里有三行 `[budget]`
- [ ] `npm -w @gladlog/desktop run test:visual:smoke` 本机全绿(7 场景 + 1 首渲,不产基线);CI 的 `frontend-qa` job 比对基线也全绿
- [ ] `npm -w @gladlog/desktop run test:e2e` 全绿(3 条链路)
- [ ] `npm run typecheck` 与 `npm run lint` 全绿
- [ ] CI 上 `test` 与 `frontend-qa` 两 job 均绿
- [ ] 故意改一处 CSS 颜色 → 推上去看 CI 的 `frontend-qa` 报 diff → 还原后恢复绿(证明视觉回归真的在守)
- [ ] `qa/__screenshots__/` 下 7 张基线图已提交,且肉眼审过
- [ ] `qa/axe-allowlist.ts` 里每条豁免都有具体理由(没有「暂时」「以后再说」这类空话)
