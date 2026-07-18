# AI 分析页「关键时刻轴」重排 — 设计

日期:2026-07-18 · 状态:已获用户口头批准,待 spec 复审

## 问题

AI 分析页现为两栏(左:goals + 横向 TimelineStrip + findings;右:460px 固定
cohort)。用户反馈:结构化分析区太空、findings 区太小放不满;希望有一条以
关键时刻为骨架的叙事结构。

## 决策记录(用户逐项选定)

1. **轴的定位**:静态叙事轴,节点可点 → 切回放视图并定位(复用现有
   `onSeekEvent(tSeconds, unitNames)` 证据链跳转);AI 分析页不内嵌播放时钟。
2. **轴上内容**:死亡 + 爆发周期带、防御性投入(饰品/大防御/外套)、
   关键驱散 + 控制成功/被控。打断类不上轴(finding 引用时仍可见)。
3. **布局**:轴为脊柱,finding 卡与系统标注按时间左右交错;cohort 从右栏
   下沉为全宽底部区;右侧固定栏取消。
4. **刻度**:事件紧凑排列,时间只做节点标签;相邻节点时间差 >30s 插入
   「⏱ Ns 无关键事件」省略标。不做真比例刻度。

## 页面结构(自上而下)

```
[本场目标 goals + MatchHero]      ← 不动
[KeyMomentAxis 关键时刻轴]        ← 新,全宽,替换 AI 页内的横向 TimelineStrip
[整场观察]                        ← 无 t 的 finding(cd-waste 等)钉在轴下
[ProComparisonVerified cohort]    ← 全宽底部
```

## 数据层:`derive/keyMoments.ts`(纯函数)

```ts
export type KeyMomentKind =
  "death" | "burst-band" | "defensive" | "dispel" | "cc";
export interface KeyMoment {
  t: number; // 相对秒
  toT?: number; // burst-band 专用(带状)
  kind: KeyMomentKind;
  side: "friendly" | "enemy";
  title: string; // 如 "交饰品"、"Ice Block"、"Purify(Critical)"
  detail?: string; // 如 "未转化 · 0.52M on Priest"、"DR: Stun Full"
  unitNames: string[];
  jumpT: number; // 跳转秒(= t)
}
export function deriveKeyMoments(
  source: ReportSource,
  ownerId?: string,
): KeyMoment[];
```

来源全部复用 analysis 既有谓词(`toLegacySafe` 直调,谓词单源铁律):

| kind       | 谓词来源                                                                          | 密度口径                                                    |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| death      | unit.deathRecords(仅含 COMBATANT_INFO 的玩家)                                     | 全收                                                        |
| burst-band | `analyzeBurstLedger`(owner 与敌方双向)                                            | 全收;`isBurstConverted` 标转化                              |
| defensive  | `extractMajorCooldowns` 施放 + 饰品(trinketSpellIds cast)+ EXTERNAL_DEFENSIVE_IDS | 全收(本身量少)                                              |
| dispel     | `reconstructDispelSummary` allyCleanse/ourPurges                                  | 仅 Critical/High(F163 同源)                                 |
| cc         | `analyzePlayerCCAndTrinket` ccInstances(双向)                                     | 敌方被控:时长 ≥3s 或目标为治疗;我方被控:时长 ≥3s 或触发饰品 |

失败韧性:每类来源独立 try/catch,单类失败不拖垮整轴(candidateFindings 先例)。

## 组件层:`KeyMomentAxis.tsx`

- 输入:`moments: KeyMoment[]`、`findings: Finding[]`、`candidates`(解析
  finding 时刻)、`onSeek`。
- 归并:findings 取各自 eventIds 最早 t,与 moments 合并按 t 升序;无 t 的
  finding 归入「整场观察」由父组件渲染。
- 交错:节点顺序编号,偶数左/奇数右;burst-band 画在脊柱本体(色带),
  不参与交错。
- 节点渲染:m:ss + kind 图标 + title(+detail 次行);finding 卡复用现有
  卡片样式(时间 chip/跟进标记保留),色边表严重度(high 红/med 金/low 灰),
  不再按严重度排序。
- 间隔省略标:相邻 t 差 >30s 时脊柱上画细体「⏱ Ns」。
- 点击任意节点/卡 → `onSeek(jumpT, unitNames)`。

## 布局改动

- `MatchReport`:AI 视图去掉 `<aside class="rpt-ai-side">`,cohort 移到主栏
  尾部;`.rpt-ai-full` 改单列。
- `StructuredAnalysisPanel`:TimelineStrip 从 AI 页移除(其 activeEventIds
  高亮职责由轴节点选中态接替);goals/MatchHero/streaming preview 不动。
- TimelineStrip 组件保留(其他视图/测试仍在用则不删文件)。

## 测试

- `keyMoments.test.ts`:真实 fixture + 克隆注入(死亡/饰品/驱散)逐类断言;
  裁剪版 fixture 缺事件数组不抛(toLegacySafe 已保证,补断言)。
- `KeyMomentAxis.test.tsx`:归并排序、左右交错、间隔省略标、点击回调、
  无 t finding 不进轴。
- 现有 faithfulness/cohort 测试不受影响(表格未动)。

## 不做(YAGNI)

- 播放时钟联动、真比例/分段混合刻度、打断类节点、轴上筛选器。
