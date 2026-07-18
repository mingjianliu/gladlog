# 本地 UI 试验台 (`dev:ui`)

纯浏览器渲染战报 report 组件的 dev harness —— **免 Electron、免真实客户端、带 HMR**。
用来快速迭代/复审战报 UI(战报 / 回放 / AI 分析 三视图)。

## 跑起来

```bash
cd packages/desktop
npm run dev:ui          # vite dev server → http://localhost:5199/
```

浏览器打开 `http://localhost:5199/`,顶部有 fixture 切换(真实 3v3 / 合成小样)。
改任意 `report/**` 组件或 `styles.css`,页面热更新。

## 原理

`dev/main.tsx` 直接渲染 `<MatchReport source={fixture} />`,并注入一个假的
`window.__gladlogFixture`(analysis / compare mock)让 AI 视图有内容。**绕开了
App.tsx 的比赛列表 / IPC / preload**,所以不受 Electron 侧 fixture 预览损坏的影响
(见 `docs/plans/2026-07-12-report-ui-review-handoff.md`)。

- 数据源:`test/fixtures/real-match-sample.json`(匿名裁剪的真实 3v3)与
  `report-match.json`(合成小样)——用真实走位/技能数据检验渲染。
- **压测样本池**(gitignored:`dev/local/stress-*.json` + `stress-index.json`
  清单):从千场野生语料挑的渲染边界样本——CN 客户端原名、shuffle 回合、
  5–10 分钟长局(最大 227MB;正式 app 存超长对局也是这个量级,全量
  JSON.parse 是已知优化点)。生成:`make-report-fixture.mjs --keep-names
[--kind shuffle --round N]`;headless 冒烟(跑全部核心 derive):
  `npx tsx packages/desktop/scripts/smokeStressFixtures.ts`。
  试验台按需加载,大文件不拖慢默认启动。
- 组件:`src/renderer/src/report/**`,样式全在 `src/renderer/src/styles.css`。

## 文件

- `index.html` / `main.tsx` —— harness 入口(fixture 切换 + AI mock bridge)。
- `harness.css` —— 顶部工具条样式(与 app chrome 无关)。
- `vite.config.mts` —— 纯 vite 配置(root=dev,react 插件,端口 5199)。

`dev/` 不进 `tsconfig`(include: src/test)也不进 electron-vite 构建,是隔离的 dev-only
工具,不影响 `build` / `test` / `typecheck`。
