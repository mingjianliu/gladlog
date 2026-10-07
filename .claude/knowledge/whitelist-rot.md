# 白名单腐烂的三种形态

规则本体在 CLAUDE.md 的 Curated-List Completeness Rule;这里留形态、例子和工具。

## 形态 1:施法 id ≠ 光环 id

`SPELL_AURA_APPLIED` 用光环 id,白名单历史上收的是施法 id(Shockwave 46968 → 132168、Storm Bolt 107570 → 132169、Fear 5782 → 118699 等),aura 侧 CC 管线 + DR 链整体失明。**覆盖门与 coverage manifest 共享同一白名单,两边同时失明,门规永远抓不到。** 新增 CC / 白名单条目必须核对施法 / 光环双 id。

## 形态 2:串联白名单

多层闸门串联时,上游任一层不认识某 id,下游写了也白写,而且语料里「没发生过」和「结构上发不出来」长得一模一样(进攻驱散发射端 9 条里 7 条被上游先滤掉)。修法不是往发射端加 id,而是写测试断言「白名单每条要么真能过上游、要么登记在显式豁免集合里,且豁免集合不许留已修好的条目」——模板 `packages/analysis/src/context/matchTimeline.purgeWhitelist.test.ts`。

## 形态 3:赛季换号 / 删技能

spell id 跨资料片不稳定,零出现条目 = 改号或已删。死 id 的测试比没测试更坏。例:被动过滤表 8 个名字只剩 1 个还活着;救人名单里圣疗术 633 → 471195。

## 「加进表 ≠ 看得见」

- 加 id 后要量**每个消费方**,不能只量候选层就报「看得见」。施法 id 无时长 → 零长度窗口。
- 登记一个 CC id 会牵动多个消费者(破控 / 驱散渲染 / 漏驱 / 治疗被控覆盖),验收要同时抓 findings 哈希、逐类计数和关键词上下文行。
- 改进攻大招成员后要登记 sync-window / burst-window 参照表过期。
- 「表里有」要连运行时的**所有权判定**一起查:专精被动在 reach 表里是死的,因为 `talentModifierOwnershipOf` 对不在天赋树 / PvP 池的 id 答 "no"(见 [range-los.md](range-los.md))。

## 工具(runbook §7b,每季跑)

`curatedIdRegistry.ts`(所有手工 id 表必须登记)+ `curatedRotScan`(反向:零出现条目)+ `drGapScan`(CC 正向)+ `dispelCompletenessScan`。按「出现对局数」排序天然沉底 DoT 噪声;时长用 applied → removed 实测中位。坑:`observedSpellIdsGenerated.json` 是数组,`Object.keys` 拿到的是下标。

## 用日志自身的冗余查不变量

某技能存 3 层(层数移除)vs 白名单只认 2 个名字 → 抓出 4 个新 id。同法适用于任何白名单驱动的 feature(驱散、打断、CC)。

## 赛季体检的量级

12.1 首周:宇宙缺口 44%;错 id 14 处 + 已删技能 22 个清出 19 张表;`ccSpellIds := 手工 cc ∪ 官方 DR 的 stun / incapacitate / disorient`(沉默不并)。测量法:`ccSpellIds` 的消费点都是 call-time `.has()`,同一进程里增删 Set 元素即可跑双臂。

相关:[official-data-first.md](official-data-first.md)、[dispel-cc-mitigation.md](dispel-cc-mitigation.md)、[cooldown-model.md](cooldown-model.md)
