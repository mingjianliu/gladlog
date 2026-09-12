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
npm run presubmit    # = lint + typecheck + 全 workspace test + verify:vision + electron-vite build
```

这一条覆盖 CI `test` workflow 里 `static` + `unit` 两个 job 的全部 5 步(CI 把单测拆到并行 runner 上跑)。**别再手敲那三件套**(旧清单只有
test/typecheck/lint,漏掉后两步):

- `npm test` 必须是**全 workspace**,不能只 `--workspace=packages/desktop`
  —— analysis/parser 的用例也在 CI 的 `npm test` 里;
- `verify:vision`(数据忠实度)与 `build`(生产打包)是**本地唯二能抓、
  但三件套抓不到**的两类:后者专抓 renderer 值引入 `src/main/*`
  (v0.0.4 首包双平台实锤),dev 与 vitest 都不挡。

CI 还有一个 `frontend-qa` job,**本地不要跑**:

- `test:visual` 截图基线是 CI(linux)单源生成的,本机跑必然假红;
- E2E 需要 xvfb,macOS 上环境不等价。

改了 report UI 的话,`report-*` 视觉基线会变 —— 完整配方(2026-07-25 单日跑 6 轮):

```bash
gh workflow run visual-baseline.yml --ref main
# 轮询完成(gh run watch 会提前退出,不可靠 —— 用循环查 status)
RUN=$(gh run list --workflow visual-baseline.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run download $RUN -n visual-baselines -D /tmp/bl
for f in /tmp/bl/scenes.spec.ts/*.png; do n=$(basename $f);   cmp -s "$f" packages/desktop/qa/__screenshots__/scenes.spec.ts/$n || echo "DIFF $n"; done
# DIFF 的逐张 Read 人审(变化必须能用本次代码改动解释),cp 覆盖后 commit
```

- test.yml 的 run 要**按 headSha 选**,push 后立取 latest 会抓到上一条
- 开着 PR 时每次 push 触发 push+pull_request **两条** run,红的可能是另一条

## 只在 CI 红的 flaky 测试(GH #26,2026-09-02 根因)

- **绝不制造整机负载复现**(14 个 `yes` 死循环 + 并发全量 vitest 把机器搞死一次,load 248)。
  复现不了就写「未能本机复现」+ 按机理改,让用户决定。
- 先拿**失败那次**的日志:`gh run view <id> --attempt 1 --log-failed`(重跑后默认只给绿的那次)。
  RTL 失败信息里的 DOM 快照比「超时」字样有信息量:`aria-expanded="false"` 说明点击发生了又被撤销,
  是状态竞态,不是慢。
- 两处已知根因同构:**「挂载即 setState / 只翻一次的值」的被动 effect 排在交互之后**,React 在渲染
  交互更新前先刷被动 effect,复位把交互静默撤销;高负载下 RTL 的 `setTimeout(0)` 与 React 的
  `setImmediate` 先后翻转才暴露。修法是渲染期派生(`prevRoot` state)或依赖用户动作计数(`langSwitches`),
  不是加 `act()` / 抬 `asyncUtilTimeout` / 加重试。
- 确定性复现帮手 `test/support/untilDom.ts`:设 `IS_REACT_ACT_ENVIRONMENT=false`,用 `createRoot().render`
  挂载,在 MutationObserver 微任务里交互;范例 `test/devpanel.jsonTree.race.test.tsx`。
  同形状再红 = 还有第三个这样的 effect,按这个模式找。

## 大数据文件纪律(2026-07-25 图标事故)

生成数据 >1MB 必须走 `.json` 文件(vite 已配 `json.stringify` → JSON.parse
装载,对象字面量会复踩 22s 首屏);且受 **firstPaint 预算** CI 约束 ——
13.8MB 全表被预算实拦,收敛到观测宇宙 1.5MB 才过。新增大表先估首渲成本。

**但 firstPaint 这条门长期坐在自己的噪声带里**,已经三次(2026-08-04 / 08-18 / 08-23)
记录到同型失效:同一个 SHA 的两次尝试能跑出相差 1000ms+ 的 floor,主 chunk 回到改动前
体积照样红。所以 frontend-qa **只**挂 firstPaint 一项时,默认动作是**同 SHA rerun**,
不是回滚改动、更不是随手抬门。

- 当前数值与它的完整判据在 `qa/budgets.ts` 的注释里 —— **动它之前先读那段**,那是单源;
- 真要抬门,合法路径是**用记录下来的 floor 分布重锁**(从 CI 日志的
  `[budget] firstPaint samples=` 逐条抓最小值,给出样本量与分位数,并说明 headroom
  倍率为何是这个数),不是拍一个能过的数;
- 反过来,判断一个改动对首屏是好是坏也只能实测多轮取分布:2026-08-22 的动态载入把
  主 chunk 从 3,494 降到 3,135 kB,firstPaint 反而更差,已回滚(`50b50001`)。

- **lint 必须全仓 `.`,且从仓库根跑**:CI 的 Lint 步是全仓,test 文件/scripts 里一个
  `console.log` 就能红(2026-07-18 实锤)。`eslint .` 的 `.` 是**当前工作目录**,不是仓库根 ——
  前面 `cd` 进过子包(或子代理的 cwd 就在子包)时它只扫那个子包、本地全绿而 CI 红。
  门禁里写绝对路径:`npx eslint /Users/mingjianliu/code/gladlog`,或先确认 `pwd`;

- CI 的 `tsc -p` 包含 **test 文件**,本地 vitest 不查类型;
- CI 有独立 **Lint 步**,error 级 no-unused-vars 会挡 merge;
- push 后 `gh run watch <显式 run id> --exit-status`(push 完立刻取 latest
  会抓到上一条 run);
- **watcher 退出 0 不等于绿**(2026-08-11 误报事故):后台 watcher 可能在 run 真正结束前
  或对着**另一条 run** 退出。报状态前必须读它的输出文件,并核对三样:run id 是不是你等的
  那条、`headSha` 是不是你 push 的那个 commit、结论行是不是 `success`。三样对不上就重查,
  别把「命令退出 0」当成 CI 绿;
- **门禁链里绝不给 typecheck/test 加管道**:`npm run typecheck | tail -1 && …`
  的退出码是 tail 的,tsc 红了链条照样绿(2026-07-18 实锤:漏放一个 TS2322
  过了本地门禁,靠 agy 复核抓回)。要裁输出就先跑完存变量,退出码单独查。
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

**给 desktop 加一个 `@gladlog/*` 工作区依赖时,必须同时改 `electron.vite.config.ts`
的 `externalizeDepsPlugin({ exclude: [...] })`**,main 与 preload **两处**都要加。
`externalizeDepsPlugin` 默认把已声明依赖转成运行时 `require`,而 workspace 包的
`main` 指向 `src/index.ts`(TS 源码)—— 打包产物里就会 `require` 一个 `.ts`,
运行时炸窗口、E2E 全灭。声明依赖与 exclude 是**成对**的,少一半比两边都没有更糟
(没声明时 vite 会直接把它编进包,反而能跑)。配置里那两段注释就是这个约束。
