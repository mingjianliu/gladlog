# C1 — VISION 数据忠实性(UI 不会说谎)设计

日期:2026-07-12
状态:待用户审阅

## 背景与目标

可验证性路线图(`docs/verifiability-roadmap.md`)Pillar C 第一子项目。把 PROMPT 层的 grounding 纪律搬到 UI:**每个渲染出的数字 / 条宽 / 时间轴标记都可证明地忠实于组件被给到的数据**,不能出现捏造、错配、错缩放。同时(路线图的双受众)每个检查须 **可被 agent 无头调用 + 产出机器可读 diff**,供 produce→verify→feedback 跨 agent 环用,不只是 CI 红绿灯。

范围:**Meters + cohort 面板(ProComparisonVerified)+ 时间轴(TimelineStrip)**。谐波器可扩展。

## agy debate 结论(仪式,conversation `44605150`,OPPOSE→采纳)

原「hybrid 源交叉校验」被驳:

- **METER 源重算 = 脆 + 越界**:`deriveSummary`(summary.ts:27-29)含**宠物**伤害 `sum(u.damageOut)+pets.reduce(...)`;朴素重算漏宠物 → 猎人/术士/DK 上对正确渲染误报。且重算 = 复制 deriveSummary = 把**聚合正确性**(LOG 层职责)混进 UI 忠实性。
- **COHORT 百分位重算 = 循环**:用同一分段线性公式(verifiedComparison.ts:23-38)从同一 p10/p50/p90 重算,= f(x)==f(x),证明不了渲染忠实。

**采纳 steelman:隔离视图层。** C1 只验证「渲染 == 组件被给到的值」+ 不重算的**结构不变量**。聚合/百分位/解析的**正确性**留给各自单测与 LOG/PROMPT 支柱。

## 组件一:选择器 = 单一真相源(`report/derive/`)

把内联 render-math 从组件抽成纯函数,组件退化为 dumb renderer:

- `meterRows(rows: UnitTotals[], mode): MeterRow[]` —— `{ unitId, name, classId, value, widthPct, label }`,含排序、`max`、`(v/max)*100`、四舍五入 + 千分位格式化。移出 `Meters.tsx`。
- `timelineMarks(candidates: CandidateEvent[], start, end): Mark[]` —— `{ id, t, leftPct, type }`(仅有 `facts.t` 的点事件;`leftPct = t/maxT*100`)。移出 `TimelineStrip.tsx`。
- `cohortDims(result): CohortDimRow[]` —— `{ key, value, percentile, verdict, p10, p50, p90 }`,格式化透传 compare 结果。

组件 JSX 里不再有算术。选择器有自己的单测(已知 fixture,手工核对期望)。

## 组件二:忠实性谐波器(`report/derive/faithfulness.ts`)

`checkFaithful(kind, renderedRoot, selectorOutput): Divergence[]`

- 遍历渲染后的 DOM(RTL container),按 kind 抽取每个渲染值(条宽 inline style、数字文本、标记 left%)。
- 对每个渲染值执行两类检查,收集 `Divergence`(空 = 忠实):

**(A) 视图忠实(rendered == given):** 渲染值 == 选择器输出对应字段。Meters 的条宽/数字文本、cohort 的 value/percentile 文本、timeline 的 left%。

**(B) 结构不变量(非循环,不重算聚合):**

- Meters:每条 `widthPct ∈ [0,100]`;`widthPct` 与 `value` **单调同序**;最大 value 那条 == 100%;**格式往返**:把渲染文本 `"1,234"` 解析回数 == `Math.round(value)`(抓格式/locale/错列 bug)。
- Cohort:`percentile` 与 value 相对 p10/p50/p90 的**序一致**(`value ≥ p90 ⟹ pct ≥ 90`;`value ≤ p10 ⟹ pct ≤ 10`;p10<value<p90 ⟹ 10<pct<90)。抓「值低却显示高百分位」这类错配,**不重算**精确百分位。
- Timeline:每标记 `t ∈ [start,end]`;`leftPct == t/maxT`(容差 1e-6);`id` 映射到 candidates 里真实事件。

## 组件三:跨 agent 输出

`Divergence = { component, element, rendered, expected, invariant, sourceRef }`(JSON 化)。

- **CI/单测**:每组件一个 vitest,用既有 report fixture 渲染,断言 `checkFaithful(...) === []`。
- **agent 可跑**:`npm run verify:vision`(desktop 脚本)对 fixture 跑全部 checkFaithful,打印结构化 diff,有分歧则非零退出 —— 修复 agent 拿到精确定位、复核 agent 可复算。

## 数据流

fixture match → 选择器算展示值 → 组件渲染 → 谐波器抽 DOM → (A)rendered==selector +(B)结构不变量 → Divergence[](空=过)。

## 错误处理

- DOM 抽取失败(缺元素/空文本)→ 记 `Divergence{invariant:"missing"}`,不静默过。
- `max=0`(全 0 meter)→ 选择器 `widthPct=0`,不变量放行(0∈[0,100],单调平凡成立)。
- cohort `value=null`(N/A 维)→ 跳过该维序一致检查(无值可比)。

## 测试策略(vitest)

- 选择器单测:`meterRows`/`timelineMarks`/`cohortDims` 对已知 fixture 输出手工核对(排序、widthPct、格式、leftPct)。
- 谐波器单测:每组件用 report fixture 渲染 → `checkFaithful` 返 `[]`。
- **有牙齿证明(关键)**:注入一个**故意撒谎**的渲染(如把某条 widthPct 乘 2、把 cohort percentile 与另一维互换),断言 `checkFaithful` **必须**捕获并产出对应 `Divergence`。证明检查不是空过。
- 现有 desktop 套件不回归(组件改为读选择器,行为等价)。

## 范围外

- 聚合/百分位/解析的**正确性**(deriveSummary 求和、verifiedComparison 百分位、parser)—— 各自单测 + LOG/PROMPT 支柱,非 C1。
- 视觉回归(截图,C2)、导出忠实(C3)—— 后续。
- Meters/cohort/timeline 之外的组件(谐波器可扩展,后续)。

## 未决事项

无(强度=视图忠实+结构不变量;范围=Meters+cohort+timeline;已确认)。
