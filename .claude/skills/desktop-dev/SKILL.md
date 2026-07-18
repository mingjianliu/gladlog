---
name: desktop-dev
description: gladlog desktop(Electron)改代码的工程约定与坑。改 packages/desktop 的任何功能(renderer 组件/derive、main 服务/IPC、测试)之前读这个 —— 数据流模式、谓词单源、fixture 测试法、push 前检查清单都在这里。
---

# desktop 开发约定(2026-07 三轮 UI 迭代沉淀)

## 数据流:三条既定通路,别发明第四条

1. **renderer 直调 analysis(首选)**:`report/derive/*.ts` 里
   `toLegacySafe(source)`(`derive/legacySource.ts`)→ 调 analysis 的谓词函数。
   先例:vulnWindows / deathRecap / statsTable / dampeningSeries。
   **必须用 toLegacySafe 不能裸 toLegacyMatch**——裁剪版 doc/fixture 缺事件数组
   会直接抛,而外层 try/catch 会把整块 UI 静默吞掉(踩过:fixture 模式下
   analysis 派生 UI 全部消失,无报错)。
2. **main 服务 + IPC**:要落盘/扫目录/调 LLM 的走 main(analysis.ts 模式:
   服务函数 + ipc.ts handler + preload 两处)。进度/流式用 emit 频道
   (`gladlog:*:delta/progress` 先例)。
3. **纯数据 import**:SPELL_CATEGORIES、zoneMetadata、图标表等纯数据 export
   renderer 随便 import。

**谓词单源铁律的 UI 版**:同一个事实的两个消费者(main/renderer、prompt/UI)
必须 import 同一个函数/常量。跨进程共用的小函数放 `src/shared/`
(先例:findingKey——注意它的键用 eventIds 不用 title,title 是生成文本随语言变)。

## 跨视图交互模式

- **回放时钟是 ReplayView 局部 state,永远不要提升**(热 tick 会重渲三视图)。
  跨视图 seek 用 `seekReq {tMs, unitNames, nonce}` prop,nonce 防重复消费。
- 泳道闪金:chip 的 React key 混入 nonce 强制重挂载,CSS 动画才会重放。
- 时间单位:CandidateEvent.t / derive 输出 = **相对秒**;回放时钟/事件 timestamp
  = **绝对 ms**;换算只在 MatchReport 边界做一次。

## 测试法

- 真实 fixture `test/fixtures/real-match-sample.json`:匿名、裁前 90s、
  **无玩家死亡**、剥掉 healIn/absorbsIn/actionsIn/Out。测死亡/治疗类路径要
  **克隆 + 注入合成事件**(先例:report.deathrecap.test 注入死亡)。
- 组件测试的 bridge 桩:`(window as any).__gladlogFixture = {...}`;组件里访问
  bridge 面必须 try/catch + optional(桩经常缺面,别让挂载抛)。
- 想真眼看:用 run-ui skill(dev:ui 测试台)。

## push 前检查(CI 与本地不等价,连挂过三次)

```bash
npm test --workspace=packages/desktop \
  && npm run typecheck \
  && npx eslint . --quiet
```

- **lint 必须全仓 `.`**,不能只 `packages/desktop/src`:CI 的 Lint 步是全仓,
  test 文件/scripts 里一个 `console.log` 就能红(2026-07-18 实锤);

- CI 的 `tsc -p` 包含 **test 文件**,本地 vitest 不查类型;
- CI 有独立 **Lint 步**,error 级 no-unused-vars 会挡 merge;
- push 后 `gh run watch <显式 run id> --exit-status`(push 完立刻取 latest
  会抓到上一条 run);
- **复合命令里绝不 `cd`**:`cd packages/desktop && …` 会把 shell cwd 永久留在
  子目录,后续所有相对路径命令(git add、npm --workspace)静默错位(一个
  session 连踩三次)。要么绝对路径,要么单命令内 `(cd … && …)` 子壳。
- **`grep -c` 计数为 0 时退出码是 1**,放在 `&&` 链里会静默咬断后面的
  commit/push——检查用 `grep -c ... || true` 或单独跑。

## 数据表(spellCategories 等白名单)相关

改任何 spell-id 白名单前读 memory 的 whitelist-rot 教训:新增追踪先做
**语料实证**(SPELL_CAST_SUCCESS 挖掘 + per-spec 率而非绝对数),cd/时长
生成层没有的用语料实测(min inter-cast gap / aura applied→removed 中位数),
别拍脑袋。刷新流程见 docs/commands/update-wow-data.md。

## renderer 与 main 的 import 边界(v0.0.4 构建事故)

renderer/preload 从 `src/main/*` 只能 **type-only import**(`import type`,编译期擦除)。
值引入(常量也算!)会把整个 main 模块连同 `fs`/`path` 卷进 renderer 包 ——
dev 与 vitest 都不挡,只有 `electron-vite build`(生产打包)才炸。
跨界共享的常量放 `src/shared/`(protocol.ts / findingKey.ts 先例),main 侧可 re-export。
CI 的 test workflow 已加 electron-vite build 步兜底。
