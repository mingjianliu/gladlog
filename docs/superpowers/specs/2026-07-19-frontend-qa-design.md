# 前端质检体系设计(C2 视觉回归 + axe + E2E + 性能预算)

日期:2026-07-19
状态:已批准(brainstorm 定稿)
关联:`docs/verifiability-roadmap.md` 的 C2(视觉回归),并前置性覆盖 C3/trust-chain 所需的 E2E 地基。

## 目标与范围

给 gladlog 前端建一座分层质检塔,每层的"合格"都是机器可判定的断言:

| 层         | 标准类型           | 标准                                      | 现状                           |
| ---------- | ------------------ | ----------------------------------------- | ------------------------------ |
| 数据忠实性 | 绝对(有真值)       | 渲染值 == 计算值,零容差                   | ✅ C1 `verify:vision`,本期不动 |
| 视觉回归   | 相对(人批准的基线) | 截图 == 基线,容差仅吸收抗锯齿             | 本期新建                       |
| 无障碍     | 绝对(业界规范)     | WCAG 2.1 A+AA(axe 规则集),违规 ⊆ 显式豁免 | 本期新建                       |
| 交互链路   | 清单(产品决策)     | 三条核心旅程全通                          | 本期新建                       |
| 性能预算   | 绝对(自定预算)     | 三指标不越线,预算 = 实测 p95 × 1.5        | 本期新建                       |

原则:**能用绝对标准的地方绝不用相对标准**。数字对不对归 C1 数据断言管;截图 diff 只负责布局/间距/配色/字体这些"长相"问题,两层互不兜底。视觉基线的权威永远在人——机器只保证"没人批准的情况下,像素不许变"。

非目标:回放拖动帧率预算(易 flaky,后续单独评估);云端视觉服务(Percy/Chromatic,确定性 fixture 下本地 diff 免费等效);Lighthouse/SEO 类(桌面应用无意义)。

## 总体架构

一个 Playwright 依赖,三个执行层,全部落在现有地基上:

```
质检层                执行器                        跑在哪
──────────────────────────────────────────────────────────────
视觉回归 + axe        Playwright browser 项目        dev:ui 测试台 (:5199)
报表首渲预算          同上(同批测试内计时)            dev:ui 测试台
E2E 三链路 + 冷启动    Playwright _electron 项目      electron-vite build 产物
解析速度预算          vitest 计时测试                packages/parser
```

新增文件集中在 `packages/desktop/qa/`:

```
packages/desktop/qa/
  playwright.config.ts     # 两个 project:visual(browser)/ e2e(electron)
  visual/                  # 场景截图 + axe + 首渲计时
  e2e/                     # 三链路 + 冷启动
  __screenshots__/         # linux 基线(唯一一套,提交进仓库)
  axe-allowlist.ts         # 显式豁免清单(规则 id + 选择器 + 理由)
```

不混入 vitest 的 `test/`。新脚本(`packages/desktop/package.json`):

- `test:visual` — 跑视觉 + axe + 首渲(本地经 docker,见基线单源)
- `test:visual:update` — docker 内 `--update-snapshots` 重生成基线
- `test:e2e` — 构建后跑 Electron E2E

### 基线单源

截图基线**只有 linux 一套**,由官方 Playwright docker 镜像生成,CI(ubuntu)即权威。mac 本地跑视觉套件 = 同一条 docker 命令,不产生第二套标准。与项目"谓词单源"哲学同构:一个事实(页面长相)只有一个判定谓词(linux 渲染 + 同一容差)。

## 视觉回归(C2)

### 场景清单

dev:ui 测试台新增 `?scene=` URL 参数,直达确定状态(不靠手点下拉/标签):

| scene           | 内容                           | fixture                     |
| --------------- | ------------------------------ | --------------------------- |
| `report-battle` | 战报视图(Meters/统计表/时间轴) | 匿名真实局(已提交)          |
| `report-replay` | 回放视图(场地/泳道)            | 匿名真实局                  |
| `report-ai`     | AI 分析视图(findings/对比)     | 匿名真实局 + 现有 mock 分析 |
| `report-synth`  | 战报(合成小样,另一数据形态)    | 合成局(已提交)              |
| `dashboard`     | 战绩仪表盘                     | 新增合成 metas fixture      |
| `settings`      | 设置页                         | fixtureBridge               |
| `matchlist`     | 比赛列表(含筛选)               | 新增合成 metas fixture      |

仪表盘/设置/列表目前不在测试台里,本期补成场景(复用 `fixtureBridge.ts` 的 mock 通道)。独立收益:run-ui 工作流以后能直接看这几页。

### 确定性措施

- 固定视口 1280×800;`toHaveScreenshot({ animations: "disabled" })`。
- Playwright clock API 冻结 `Date.now()` 到固定时刻;容器内钉死 `TZ` 与 locale——仪表盘的相对时间与 `toLocaleString()`(`StatsDashboard.tsx`、`dashboard.ts`)才稳定。
- 容差 `maxDiffPixelRatio: 0.01`,只用来吸收抗锯齿噪声,不用来放水。
- 图标无远程请求(`SpellIcon` 走本地 dataUrl),无需网络打桩。

### 基线更新流程(标准的权威在人)

CI 红 → 下载 diff 产物(expected/actual/diff 三联图)人眼裁决 →

- 意外崩坏:修代码;
- 有意改版:`npm run test:visual:update` 重生成基线,**基线变更与代码同一个 commit** 进审。

## axe 无障碍

`@axe-core/playwright` 挂在视觉场景的同一次页面加载上(截图后顺手扫),规则集 `wcag2a` + `wcag2aa`。

政策:**修或显式豁免,不许静默**。豁免写进 `axe-allowlist.ts`(规则 id + 选择器 + 一行理由),测试断言"违规集合 ⊆ 豁免集合",新增违规即红。首扫预期会报一批(深色游戏风 UI 的对比度问题典型),逐条裁决:能修的修,接受的进豁免——豁免文件本身就是可见的技术债清单。

## E2E 三链路 + 冷启动

Playwright `_electron.launch()` 驱动 `electron-vite build` 产物(接近发布形态,不是 dev 模式),CI 上 `xvfb-run`。

### 隔离与打桩

生产代码**只加一处开关**:`GLADLOG_E2E=1` 时把 `userData` 重定向到临时目录(每次干净状态,持久化断言也在里面做)。开启却没给合法路径时抛错而非回落——静默用真实 userData 会污染用户数据。

其余打桩全在测试侧,不进生产分支:

- **AI 分析**:把 canned 结果直接写进主进程读的那个缓存文件(`<userData>/matches/<id>/analysis-v2.zh.json`),不打真 API。缓存带 `promptVersion` 校验,所以该常量必须提取为单源(`src/shared/promptVersion.ts`),播种助手与主进程 import 同一份——硬编码副本会在版本变更时静默失效、测试假绿。
- **文件对话框**:`app.evaluate` 在主进程里替换 `dialog.showOpenDialog` 返回合成日志路径(原生对话框无法自动化,标准做法)。

### 链路清单(核心旅程,产品决策定稿)

1. **导入→报告**:打桩对话框指向合成日志(走真 parser)→ 比赛列表出现该场 → 点开 → 三视图各断言一个内容锚点(生命曲线在 / 回放场地在 / AI 面板在)。
2. **finding→证据链**:AI 视图点 finding → 断言跳到回放/时间轴对应时刻(选中态 + 时间值)。
3. **教练闭环**:标记 finding 有用/无用 → 仪表盘聚合变化 → 应用内重启(关窗重开)→ 标记仍在。

前提:导入链路要吃**原始 `.txt` 日志**,而现有提交物是解析后的 JSON(`real-match-sample.json`)。做法是写一个**确定性合成日志生成器**(`packages/parser/src/testing/synthLog.ts`),而非裁剪匿名一份真实日志:

- 无 PII 风险,可安全提交生成器本身(生成物运行时产出,不入库);
- 同参数逐字节可复现,消除一类 flaky 来源;
- 体积可参数化放大,同一个生成器顺带喂饱解析速度预算。

代价是它不覆盖真实日志的野生怪癖——但那本就不是 E2E 的职责:parser 保真度归 A1(差分预言机)与 A2(不变量)管,E2E 只回答「这条链路还通不通」。

### 冷启动预算

链路 1 顺带计时 `launch()` → 比赛列表可交互,断言低于预算(阈值见下节政策)。

## 性能预算(measure-then-lock)

不拍脑袋定数字。三个指标统一政策:harness 先落地**只测量不断言**;CI 上跑 5 次取样,**预算 = p95 × 1.5**,写成常量提交,此后越线即红。

| 指标     | 测法                                                | 载荷                                                                   |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| 解析速度 | vitest 内计时 parser 解析,断言中位数 < 预算         | `synthLog` 生成的大号合成日志(约 20 万行,运行时生成)                   |
| 报表首渲 | dev:ui 场景加载→关键选择器可见耗时(Playwright 计时) | 真实样本按固定倍数确定性放大的大号局(`report-heavy` 场景,不做截图基线) |
| 冷启动   | E2E 链路 1 计时                                     | 同 E2E                                                                 |

×1.5 余量是为 CI 机器波动留的;预算抓的是**数量级回退**(意外的 O(n²)),不是 5% 抖动。放宽任何预算需要理由写进 commit message。

## CI 集成与失败处理

`test.yml` 新增 `frontend-qa` job,与现有 `test` job **并行**(不拖慢快反馈):

1. 装 Playwright 浏览器(带缓存)
2. 起 dev:ui → 视觉 + axe + 首渲
3. `electron-vite build` → `xvfb-run` E2E + 冷启动

解析预算是普通 vitest 测试,自然进现有 `npm test`,不需要新 job。

**失败即产物**:任何 Playwright 失败自动 `upload-artifact` 上传 HTML report + diff 三联图——没有 diff 图就没法人工裁决,这是视觉回归闭环的关键一环。

**分级语义**:

- 视觉 diff 红 = 未经批准的像素变更 → 人裁决:修代码或更新基线;
- axe 红 = 新增违规 → 修或进豁免清单;
- 预算红 = 性能回退 → 原则上只修不放宽。

## 实施顺序(实现计划按此拆阶段)

1. **dev:ui 场景化 + 视觉回归 + axe** — 地基最少、收益最快;
2. **解析预算** — 独立,随时可插;
3. **E2E 三链路 + 冷启动** — 需要 `GLADLOG_E2E` 开关与合成日志生成器,最重;
4. **首渲预算 + 全部预算锁定** — 等 ①③ 的 harness 都在,统一 measure-then-lock。

每阶段独立可合入,CI 逐步变严。

## 风险与对策

- **截图 flaky**(字体/抗锯齿/时序):linux 单源基线 + 冻结时钟 + 关动画 + 小容差;若仍抖,优先查确定性漏洞而不是加大容差。
- **Electron 在 CI 无头环境起不来**:`xvfb-run` 是成熟路径;打包坑已有先例可循(见 memory:打包坑)。
- **首扫 axe 违规过多**:政策允许全量进豁免清单起步,清单公开可见,后续逐条消化,不阻塞落地。
- **CI 时长膨胀**:并行 job + 浏览器缓存;视觉场景 7 个、E2E 3 条,量级可控。
