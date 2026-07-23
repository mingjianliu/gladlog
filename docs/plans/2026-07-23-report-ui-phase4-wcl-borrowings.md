# Report UI 第四阶段 —— WCL/WoWAnalyzer 四项借鉴(v0.1 大版本)

分支:`release/0.1`。来源:2026-07-22/23 对 WCL 帮助文档 + WoWAnalyzer 全库
(~/code/wowanalyzer,CodeGraph 索引)的架构调研。四项按依赖排序:
①时间窗联动 → ④光环区间集/uptime 条 → ②events 视图 → ③确定性 mistake 引擎(#8)。

## ① 时间窗联动(地基)

**目标**:Timeline 上拖选时间段 / phase 下拉选窗口,聚合面板全部重算到该窗口。
WCL 的对应物是「一切视图 = (事件流, 时间窗, 过滤器) 的查询」;WoWAnalyzer 靠
对子区间重跑整个解析管线 + 把跨界状态物化成 fabricated 事件(FilterCooldownInfo /
prepull applybuff)。我们不用那么重 —— 数据形状允许两条更便宜且各自正确的路:

- **瞬时事件聚合(Meters/summary/明细分解)→ 事件层裁剪**:damage/heal 事件是
  瞬时的,无跨界状态。`clipSource(source, range)` 浅克隆 units、按 timestamp 过滤
  事件数组,derive 零改动(toLegacySafe 的 WeakMap 缓存对新对象自然生效)。
- **有状态事实(statsTable 的 CC 实例/kick 审计/驱散账目/两面板)→ 事实层过滤**:
  derive 照常在全量流上算(状态推理不受窗口污染),然后按事实的 tS/fromSeconds
  过滤到窗口;跨界的时长类事实(CC 持续段)按重叠部分计入。**绝不能对这类 derive
  做事件层裁剪** —— aura applied 在窗口外、removed 在窗口内的 CC 会整段消失,
  开局重置类推断(饰品)也会被窗口起点污染。
- **不吃窗口的**:HP Timeline(永远全场,窗口画成高亮选区)、WindowList、
  死亡回顾、爆发账本(本身就是窗口锚定的)、回放。

**UI**:Timeline 拖选(mouseDown/mouseMove 在 SVG 上,已有 bands 的坐标换算可复用);
phase 下拉的选项 = 全场 + `deriveVulnBands` 的每个 band(击杀窗/脆弱窗,标签复用
WindowList 文案);清除按钮;当前窗口显示在 rpt-head 一行。
状态:MatchReport 局部 `timeRange: {fromS, toS} | null`,不进全局(与回放时钟同理)。

**验收**:窗口内 Meters 总和 = 全场明细中 tS∈窗口 的事件加总(守恒测试);
statsTable 窗口计数 ≤ 全场计数;视觉基线加一个「选中窗口」场景。

## ④ 光环区间集 + uptime 条

共享 builder(WoWAnalyzer 的 Auras/getBuffStacks 模式):auraEvents 配对
applied→removed、refresh 合并(BuffRefreshNormalizer 的 buffer 思路)、开局已挂
推断段打 `inferred` 标。CC/DR/关键增益 uptime 条从同一区间集渲染;现有 ccWindows
路径逐步迁移消费它(谓词单源,不允许出现第二套配对逻辑)。

## ② events 视图(兼 B2 溯源容器)

结构化过滤(类型/来源/目标/技能/时间窗),不做表达式 DSL;杀手锏是「锚定到窗口」
下拉(现成的击杀窗/压力窗/CC 链即 WCL `IN RANGE FROM..TO` 的 90% 用例)。
finding 卡片加「查看原始事件」→ 预置过滤跳转。虚拟滚动(事件量 ~万级)。

## ③ #8 确定性 mistake 引擎

抄三样:规则 = 数据对象(`{actual, isGreaterThan:{minor,average,major}}` 三档);
规则表可枚举 → purgeWhitelist 式防腐测试(每条规则要么语料里能触发、要么进豁免表);
mistake 逐事件标注到 Timeline/泳道(seek 管线现成)。起步规则搬 candidateFindings
六类 + kickAudit + 漏 purge/漏解,全部已是确定性谓词,缺的只是不经 LLM 的 UI 通道。

## 借鉴但另行排期

归一化留痕(`__fabricated`/`__modified` 标记进 parser-compat 的隐式修补)、
法力曲线(要先扩 parser 的 advancedSamples 提取 power 字段,过 A1 oracle)。
