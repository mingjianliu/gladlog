# 战报明细 breakdown(backlog #11)— 设计

日期:2026-07-18 · 状态:用户已批准("做吧"),交互形态与列范围经 AskUserQuestion 选定

## 问题

战报 meters 只有每人总量一条,信息量不如老 wowarenalogs 的 detail 视图。
需要每人按技能/来源的具体分解。

## 决策记录(用户选定)

1. **交互形态 = 行内展开**:点 meter 行(条形/数值区)展开该玩家当前模式的
   分解表;名字按钮保留原「隐藏单位」职责;同一时刻只展开一人。
2. **列范围 = 核心列 + 暴击率**:总量/占比/次数/最大一击(+治疗过量%)+
   暴击%。未选:承疗按来源、打断/驱散/控制清单。

## 数据层:`report/derive/detailBreakdown.ts`(纯函数)

```ts
export interface BreakdownRow {
  key: string; // 聚合键(spellId 或 src:spellId)
  label: string; // 技能名;宠物行 "宠物名:技能";taken 行 "来源:技能"
  spellId: string; // SpellIcon 用
  total: number; // effectiveAmount 合计
  sharePct: number; // total / 全部行合计 × 100
  hits: number; // 事件数(含 dot tick)
  maxHit: number; // 单事件 effectiveAmount 最大值
  critPct: number | null; // 暴击事件占比;params 缺席 → null
  overhealPct?: number; // 仅 healing 模式:(amount−effective)/amount×100
  isAbsorb?: boolean; // healing 模式的护盾行
}
export function deriveDetailBreakdown(
  source: ReportSource,
  unitId: string,
  mode: "damage" | "healing" | "taken",
): { rows: BreakdownRow[]; critAvailable: boolean };
```

- **damage**:本人 + 宠物(`ownerId === unitId`)的 `damageOut` 按 spellId
  聚合。与 `derive/summary.ts` 的 `damageDone` 同事件源同求和口径
  (effectiveAmount)——单测断言 `sum(rows.total) === meterValue(总量)`。
- **healing**:`healOut`(本人+宠物)按 spellId 聚合 + `absorbsOut`
  (本人+宠物)按护盾 spellId 聚合(isAbsorb,无过量无暴击);对账
  `healingDone + absorbsDone`(= meterValue 的 healing 口径)。
- **taken**:`damageIn` 按 `srcName:spellId` 聚合;对账 `damageTaken`。
- rows 按 total 降序;`critAvailable` = 至少一行 critPct 非 null。
- 直接吃 native ReportSource 事件数组(GladHpEvent 自带 amount/
  effectiveAmount),不需要 toLegacy 转换。

## parser 侧:暴击解码单源

`packages/parser/src/l1/decoders.ts` 新增导出:

```ts
/** 从完整 params 提取 damage/heal 尾参并解码;非 hp 事件或参数不足 → null */
export function decodeHpTail(
  eventName: string,
  params: string[],
): { critical: boolean; amount: number; effectiveAmount: number } | null;
```

- 内部复用现有 `decodeDamage`/`decodeHeal` 与 parseLine 的尾参切片规则
  (SWING/_DAMAGE 的 findXIdx slice(-11/-10)、_HEAL 的 slice(-5));
  **parseLine 三处调用点改为调用同一 helper**,切片逻辑单源。
- 从 `@gladlog/parser` 包 index 导出,renderer 经此计算 critPct。
- 纯新增导出 + 内部等价重构,parser 输出不变(oracle parity 不受影响)。
- 裁剪 fixture / 旧 doc 事件无 params → null → critPct null → 列隐藏。

## 组件层

- `Meters.tsx`:行主体(bar/value 区)onClick 切换 `expandedUnitId`
  (局部 state,单开);展开行下方渲染 `BreakdownTable`。stats 模式不变。
  ShuffleReport 复用 Meters 自动获得。
- `BreakdownTable.tsx`(新):列 = 图标(SpellIcon)+ label + total(千分位)
  - sharePct + hits + critPct(critAvailable 才渲染该列)+ maxHit;healing
    模式追加过量%;**前 8 行 + 「其余 N 个(合计)」折叠行**(不可再展开,
    YAGNI)。空 rows → 「无数据」一行。
- 样式:`.rpt-breakdown` 表,复用 rpt-stats 表观感。

## 测试

- parser:`decodeHpTail` 合成 params 三形态(SPELL_DAMAGE 带/不带 advanced、
  SPELL_HEAL、SPELL_PERIODIC_DAMAGE)+ 非 hp 事件 null + 短参数 null;
  parseLine 重构后既有 parser 测试全绿。
- desktop:fixture damage/healing/taken 聚合正确 + 三模式合计对账
  meterValue;fixture 无 params → critAvailable=false;注入带 params 的
  合成事件 → critPct 正确;Meters 展开交互(点行出表/再点收起/点名字按钮
  只隐藏不展开)。

## 不做(YAGNI)

- 承疗按来源、打断/驱散/控制逐条清单、按目标二级分解、时间段过滤、
  折叠行展开。
