# 子项目 3:战报 UI(combat report)设计

日期:2026-07-10
状态:待用户审阅
上游文档:roadmap(`2026-07-10-clean-rewrite-roadmap-design.md`)、桌面壳 spec(`2026-07-10-desktop-shell-design.md`)

## 目标与范围

原创设计的对局战报界面,消费 `GladMatch`/`GladShuffle`,渲染在桌面壳 renderer 中并成为**正式主界面**(对局列表侧栏 + 战报主区;现调试页降级为开发者视图)。

**范围内**(已确认):

- 比分头:双方阵容(职业色 + spec 名 + 评分)、胜负、时长、地图(zoneId 文字)、bracket
- 仪表盘(meters):按单位的伤害/治疗/吸收输出条形对比,承伤视图可切换
- 战斗时间轴:HP 曲线(advancedSamples)+ 死亡标记点,悬停查看时刻详情
- 单位详情面板:选中单位的施法序列、光环事件、天赋/装备/评分(CombatantInfo)
- Shuffle:场级汇总头 + 回合 tab 导航,每回合一份完整战报
- 视觉:暗色数据密集风,**原创**(不参考旧版布局/像素)
- 壳 renderer 重构为 列表+战报 主界面;开发者视图(监控状态/诊断)收进独立入口

**范围外**:走位回放(advanced x/y 已在数据里,留 v2)、法术图标(等子项目 5)、亮色主题、AI 分析面板(子项目 4 挂接点预留即可)。

## 已确认的用户决策

| 决策     | 选择                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| v1 面板  | 比分头+仪表盘、时间轴、单位详情(走位留 v2)                                         |
| 视觉     | 暗色数据密集风                                                                     |
| 游戏数据 | v1 无图标:spellName 文字 + 职业色硬编码映射                                        |
| 入口形态 | 正式主界面,调试页降级为开发者视图                                                  |
| 架构     | 方案 A 经 debate 修订:renderer 内 report 模块 + fixture 模式 + d3-scale + 手写 SVG |

**方案取舍**:最初的独立 report-ui 包被 debate 判定为过早模块化(见辩论记录)——修订为 renderer 内模块 + mock bridge 的 fixture 模式,浏览器迭代与壳内视觉天然一致;recharts 类图表库仍排除(暗色定制受限、依赖重),坐标数学交给 d3-scale 微原语。

## 包结构

```
packages/desktop/src/renderer/src/
  report/                 # 战报模块(经 debate:不拆独立包;若子项目 4 出现第二消费方再抽包)
    derive/               # 纯函数派生层(战报正确性核心,严格单测,不依赖 Electron/DOM)
      types.ts            # StoredMatch = GladMatch 去 rawLines(壳落盘形状);派生结构定义
      summary.ts          # 单位聚合:伤害/治疗/吸收 out 合计、承伤、DPS/HPS、宠物并入主人
      timeline.ts         # 每单位 HP 序列(advancedSamples)+ 死亡标记 + 时间范围
      casts.ts            # 施法序列(casts+petCasts 按时间合并)、光环事件序列
      roster.ts           # teamId 分组、玩家过滤(kind=Player)、胜负方标注
    components/
      MatchReport.tsx     # 组装:头/仪表/时间轴/详情;派生按可见回合/选中单位 useMemo 惰性执行
      ShuffleReport.tsx   # 场级头 + 回合 tab → 每回合 MatchReport
      ReportHeader.tsx  Meters.tsx  Timeline.tsx  UnitPanel.tsx
    data/gameConstants.ts # classId→官方职业色/名称、specId→spec 名(公开事实硬编码,子项目 5 后替换)
  fixtureBridge.ts        # fixture 模式:VITE_FIXTURE_MODE 下注入 mock window.gladlog,
                          # 从本地 JSON 供对局——纯浏览器(vite dev)迭代视觉,与壳内渲染同一份代码
  App.tsx                 # 重构:对局列表侧栏 + 战报主区 + 开发者视图入口(原调试四栏整体保留)
```

图表:坐标数学用 `d3-scale`(仅 scaleLinear/scaleTime,微依赖 MIT);SVG 标记(path/rect/marker/tooltip)全部手写,保持暗色数据密集视觉的完全控制。

## 关键设计点

### 派生层(derive)契约原则

- 组件**只吃派生结构**,不直接遍历 GladMatch 原始事件;派生函数全部纯函数,输入 `StoredMatch`(= 壳 `match.json` 的 `data`,即 `GladMatch` 去 `rawLines`)。
- 单位聚合:宠物/守卫(`ownerId` 非空)的输出并入主人行(与 parser 原生模型"宠物独立单位"解耦);金额一律用 `effectiveAmount`。符号约定以 parser 原生模型为准(计划阶段用 fixture 实证核对,不沿用 compat 的取负惯例)。
- 时间轴:`advancedSamples` 为 HP 主源;无 advanced 日志的对局(`hasAdvancedLogging=false`)时间轴退化为仅事件标记,不做 hp 估算(YAGNI)。
- shuffle:`GladShuffleRound` 即 `GladMatchBase`,每回合复用同一套派生+组件;场级头显示 6 回合胜负序列与玩家总战绩。

### 壳侧集成

- IPC 面不变:`matches.list()` 建侧栏,`matches.get(id)` 取 `data` 喂 `<MatchReport/>`/`<ShuffleReport/>`。
- 开发者视图:现调试页四栏(监控状态/诊断)整体保留,挪到独立入口(顶部小按钮或菜单),不再是首屏。
- fixture 模式:`VITE_FIXTURE_MODE=1` 时 `fixtureBridge.ts` 注入 mock `window.gladlog`(list/get 从本地 JSON 供数),`vite dev` 纯浏览器跑同一份界面代码迭代视觉。

### 视觉与合规

- 实现阶段按 frontend-design + dataviz 技能产出**原创**视觉;禁止查看旧 fork CombatReport 源码、截图或布局;"meters/死亡时间轴/回合分段"是领域通识概念,可用。
- 职业颜色为暴雪公开色板(如战士 #C69B6D 等)、spec 名称为公开事实,硬编码 ~40 条;文件头注明来源与"子项目 5 后由管线产物替换"。
- fixture 模式的对局 JSON 用自采语料生成(壳的 `match.json` 直接拷贝),不进 git 的部分走 `GLADLOG_FIXTURES` 惯例;可 checked-in 一份脱敏小样(玩家名替换)供 fixture 模式与组件测试。

## 测试策略

沿用工作方式(契约 Claude 写、agy 实现、Claude 独立验证;TDD):

- **derive 层**:严格单测——用小型合成 GladMatch(手工构造事件)断言聚合数字精确值;再用真实 fixture 对局断言关键量(如总伤害与 meters 一致、死亡数与 deaths 长度一致)。
- **组件**:vitest + jsdom + @testing-library/react 轻量 smoke(渲染不炸、关键数字出现在 DOM);视觉不做快照测试(噪声大)。
- **视觉验收**:fixture 模式人工迭代 + 截图交用户确认;最终在壳里(dev + 打包)端到端过一遍真实对局。

## 设计决策辩论记录(agy debate 仪式)

2026-07-10,Gemini 3.1 Pro (High),conversation `0214a9db`。初始 **OPPOSE** → 一轮回复后 **CONCEDE**("The revised spec eliminates premature boundaries and correctly targets UI performance constraints")。

**让步 1(已改设计)**:独立 `packages/report-ui` 包被判过早模块化——无第二消费方、双份构建管线、workspace 链接开销。修订:report 模块进 desktop renderer 内,视觉迭代用 fixture 模式(mock `window.gladlog`)在现有 Vite dev server 跑,与壳内渲染同一份代码;derive 层保持纯函数,desktop 包现有 vitest 直接单测,可测性无损;子项目 4 出现第二消费方再抽包。

**让步 2(已改设计)**:手写坐标数学(domain→pixel、responsive viewBox、指针→时间反演)必然重造有 bug 的图表库。修订:引入 `d3-scale` 微原语,SVG 标记仍全部手写保持视觉控制。

**让步 3(机制采纳,程度存疑)**:全量急切派生 6 回合 shuffle 有 GC 停顿风险。修订:派生按可见回合/选中单位 `useMemo` 惰性执行。我方保留"O(n) 求和量级本身很便宜"的判断;采纳惰性是因其成本为零。

## 未决事项

- 单位详情里光环 uptime 是否做成汇总条(倾向:v1 只列事件序列,uptime 留后续)。
- 比分头评分变化(rating delta)——日志内 CombatantInfo 只有赛前 rating,v1 只显示赛前值。
