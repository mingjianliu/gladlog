# 信号研究的结论(别重推、别复活)

在产 / 退役状态的权威是 `packages/analysis/src/data/candidateTypeRegistry.ts`(status × surface)与 `candidateDiagnostics.ts`,不要凭记忆。这里只留「为什么」。

## 结论表

- **行为先验**(2026-08-28,`behaviorPriorScan.ts`):危险时高手**主要靠自疗**(≥15% maxHP 占 60–76%),个人减伤只 19–36%;3v3 分段差最大的是「三秒内什么都没按」32% → 12%。death-unused-defensive 已退役。
- **七条老信号结果对照**(2026-08-30,`signalOutcomeProbe.ts`):cd-hoarded 危机不交时死亡率 2.5×,也是盲评里**唯一「教到东西」**的类型;healing-gap 看队友最低血量,不看空窗秒数;cd-spent-idle 无代价已退役;kick-eaten 代价真实(可教的是假读条)。
- **盲评台**(2026-08-30,43 张卡):2v2 67% 无影响;cd-hoarded 9/9 具体;kick-eaten / cc-locked / wasted-trinket / position-mistake = 早知道、价值低。两张假卡都是教练**看不见对手的反制**。不要再让用户评同专精同教练的卡,下一批换专精 / 换人。
- **crisis-no-response**(治疗 v1):价值门第一版(top-10% 参照)被否,改结果参照 + 承伤下限;**分数线彻底不用**(「不要用分数界定」);DPS 版指控不发(任何门槛拉不开)。共享谓词 `crisisDecisionPoints`,改谓词必须重生成参照表。
- **队友危机**(GH #95):两条指控 2026-09-19 退役(「这个指控太难定义了」),开关 `teammateCrisis=false`,判定 / 表 / 门规保留;`[STACKED DEFENSIVES]` 事实行保留。
- **选择重合度**:三后端类型级 Jaccard 0.672 → 不做跨类型权重;测的是确定性不是正确性。
- **技能占比**:占比看不出手法,施法率 + 充能闲置才看得出;未接线。
- **治疗语料**:溢出治疗率四档全平,**不区分水平,别做判据**;随分数涨的按键几乎全是工具键(驱散 / 打断 / 位移)。赞美诗时机、饰品解第一个控、被控占比都不区分胜负(= 风格,不是败因)。
- **mana 两候选**:用户判废话(「脱离被迫性的蓝量建议都是废话」)。
- **种族 / 天赋分层的治疗构成判断**:用户「太复杂,难分好坏」,不立项。

## 救人 CD 名单的判据

「适用」= 在 40% 危机、3 秒响应窗里按下去能不能改变目标生死;放大器算(量落在 5 秒窗内);门 = `saveCdImpactScan.ts` 的 Δ ≥10 pp **或** 10 秒阵亡率差 ≥5 pp,n ≥100;30 秒核心治疗不进;签字裁决(`curatedAbilityFacts.ts` 的 `save_role` / `not_save_role`)优先于门。名单是生成物(`healerSaveCdGenerated.json`),**赛季初重跑**(id 会变)。手写目录曾漏了 23/53。

## 外部教练语料映射到候选类型

映射器必须拿每个类型的**操作性定义**(`buildFindingsPrompt.ts` 里的真谓词),不能只给 slug:只给名字时 46% unmapped,喂真谓词后 71%。只认「同一事件」不认「同一话题」;「教练关心」≠「有判别力」。

## 不做的

死亡时免疫可用(已有事实段)、锥形技能打空、17c 换时机反事实(永久不做)、回放朝向刻度、法力 / 次级资源信号、2v2 新指控。

相关:[metrics-and-discrimination.md](metrics-and-discrimination.md)、[value-gate-first.md](value-gate-first.md)、[coaching-rulings.md](coaching-rulings.md)
