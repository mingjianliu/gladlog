# 高手对局深度对比 —— 设计(2026-07-17)

> 用户反馈:现在的高手对比只有四五个指标,太笼统。
> 现状:`ReferenceCell`(spec × bracket × archetype × buildGroup)聚合
> `IHealerMetrics` 七个全场标量(offensiveIndex/ccDensity/reactionLatency/
> burstResponseCoverage/defensiveOverlapRatio/effectiveCastRatio/
> ccAvoidanceRate),2300+ 语料,p10/50/90 + exemplarCrises。
> 只覆盖治疗,且全是**全场均值** —— 丢掉了情境。

## 一、"笼统"的根因:标量对比 vs 情境对比

你和 2400 分的 ccDensity 可能一模一样,差别在**高手的 CC 全落在 kill
window 里**。全场标量抹平了这件事。要变细,不是加更多标量,而是把对比
锚定到**局面**上:同样的爆发窗口、同样的敌方阵容、同样的 dampening 阶段,
高手做了什么。

## 二、三层扩展(由浅入深,全部有现成谓词)

### P1:DPS 指标组进 cell ✅(2026-07-17 完成)

> computeDpsMetrics 7 维(谓词=账本三件套)→ perMatchRecord 友方 DPS 记录 →
> cell 聚合;全量重建 2300+ ×3600 场 → 387 cells(262 DPS/27 专精,最大
> n=1885);UI key 通用零改动,ProComparisonVerified 按记录者角色选指标。
> 重建入口 corpus:build-reference(LOG_CACHE_DIR 缓存);周度 launchd 自装
> 命令见 collect-logs.md。

爆发账本三件套(`analyzeBurstLedger`/`auditWindowTargeting`/`analyzeKickAudit`)
是确定性纯函数,直接对高分语料的 DPS 记录者跑,聚成分布:

| 指标                                  | 谓词来源                   | 教练话术示例                      |
| ------------------------------------- | -------------------------- | --------------------------------- |
| 爆发转化率(窗口内目标净掉血≥20% 或死) | burstLedger                | 你 1/4,2400 分 Sub 贼 p50 = 2.5/4 |
| 打进免疫/减伤的爆发占比               | defensivesHit              | 你 50%,高手 p90 才 15%            |
| 协同爆发占比                          | allyCDsOverlapping         | 你全单开,高手 p50 = 70% 协同      |
| kill window 命中目标伤害占比          | targetAudit                | 你 35%,高手 p50 = 72%             |
| kick 命中率 / 被骗率                  | kickAudit                  | 你 1/5 落地,高手 p50 = 3/4        |
| 开场到首次爆发秒数                    | burstLedger[0].fromSeconds | 高手 8s 你 25s                    |

治疗侧同理可加:驱散延迟中位、被断学派锁总秒数、外置响应延迟
(healer-depth 文档的确定性项)。

实现:`perMatchRecord` 对非治疗记录者跑三件套 → `cellAggregator` 聚合
(MetricDist 结构复用);`ProComparisonVerified` 走既有 claimChecker
管线渲染新行 —— 引用不实自动丢弃的机制原样适用。
语料:`npm run logs:fetch-public -- --bracket 3v3 --min-rating 2400 --count 300`
(minRating 修好后高分段可抓;记录者 spec 天然分桶)。

### P2:对阵 comp 维度(情境化的第一步)

cell key 加**敌方 comp 签名**(specId 升序,同战绩页 comps 口径):
"2400 分惩戒骑 vs 法牧贼:平均 2:10 结束、67% 先杀牧师、开场爆发
p50 在 12s"。样本量是主要约束 —— 只对高频 comp 出 cell(n≥20),
其余回退 spec×bracket 总分布;`insufficient` 标记机制已有。
先杀谁/时长这类新聚合量是 meta 级统计,perMatchRecord 加字段即可。

### P3:exemplar 对局 ——「看高手怎么打你这套阵容」(杀手级,零新分析)

公开日志本来就是完整原始日志 → **直接导进应用**,回放/爆发账本/统计表
全套可用。串联:

1. 战报页加「找高手同局面」:按 我方 spec + 敌方 comp 签名 检索高分公开
   对局(feedClient 已能查)→ 下载 → 以对局身份入库(标记 `exemplar`);
2. 用户用我们自己的回放+账本复盘高手那场:他的爆发全协同、kick 3/3、
   开场 8 秒进场 —— 比任何 p50 数字都直观;
3. prompt 侧(后续):高手场的账本摘要作为对照块进 AI 上下文,
   "你 3 次爆发 1 次打进免疫;同 comp 高手场 0 次" —— 走 /eval-ab。

## 三、审慎项

- **样本量**:维度每加一层 n 掉一个量级;insufficient 门槛 + 回退链
  (comp cell → spec cell)必须先行。
- **公平性标注**:用户 1800 对比 2400 基准,差距要写成"高手参照"而非
  "你不达标";rubric 的 labelBias 教训适用。
- **exemplar 隐私**:公开对局本来公开,但入库要打来源标记、不进用户战绩
  聚合(dashboard 按 playerName 分桶天然隔离,exemplar 场 playerName
  是高手角色名)。
- **成本**:P1 一次性跑 300 场语料的分析在本机分钟级;cell 是离线产物,
  应用只读。

## 四、建议顺序

P1(DPS 指标扩容,1 个 datagen 式离线任务 + UI 新行)→ P3(exemplar
导入,管线串联为主)→ P2(comp 维度,等 P1 语料攒够看样本量)。
