# 天赋数据

## 用户的态度

2026-09-13:「反复说让你把天赋读明白,到现在都没读明白」;2026-09-26:「通读所有天赋,仔细研究每一个对目前所有技能的影响」「不光是冷却,还有被动触发、额外效果、加充能」「不明白的直接问我」。先理数据,消不消费由用户看清单后定;修一类要列全这类所有情形。

## 接入架构(GH #96)

不做统一大表:共享天赋证据清单(按 SpellEffect.ID 存行)→ 冷却 / 持续 / 减伤各自类型化编译 → 每个事实一个取值函数,吃完整上下文(施法者、承受者、专精、来源、时间),算不清返回不确定。覆盖门槛维持 30%。

## 所有权判定

- **判天赋修正一律用 `talentModifierOwnershipOf`**。`talentOwnershipOf` 第 6 步把「不在本专精树里」当基线 = yes,拿来判修正会让所有专精「点了」别专精的天赋。两套持有口径(`playerTalentIdSets` vs `talentModifierOwnershipOf`)仍不一致。
- 专精被动另走 `specPassiveOwned`(与 `applyCdModifiers` 共用)。任何新的「天赋修正」消费者,先问它拿什么 id 去查所有权。
- **级数读 COMBATANT_INFO,不从算术推**(每级 vs 满级总值在不同天赋间不统一);二选一节点 id2=0 不是全选;门槛内但零宽区间对不上期望值 = 模型错,不能靠容差放行。
- proc / 防致死天赋的兄弟 id 先验「自施 + 低血」两条。

## 时长修正(GH #65)

- 天赋修正有两种编码:class mask(aura 107/108)与 SpellLabel(aura 218/219)。很多当初「没有天赋能解释」的语料补丁其实是 label 修正。
- 找证据:腿 (a)+(b) 用 `talentEffectInventoryGenerated.json`(`misc0` = SpellModOp,1 = 时长;`targets[].via` = mask / label),**不要用目录的 modsRaw**(只有 mask);腿 (c) `buffDurationScan` / `durationTalentScan --candidates`;基值用 DB2 原值;两种编码都排除后问「谁挂上的」(`auraProducerScan.ts`、`totemLifetimeScan.ts`)。
- 施放参数定时长:`CAST_PARAM_DURATIONS` + `castParamAt`。
- **挂账**:大多数 `buildAuraIntervals` 调用方不传施法者,天赋层 / 施放参数到不了它们(BACKLOG §53)。
- 规则本体已写进 CLAUDE.md 的 Game-Behaviour Rule。
- SpellModOp 23 = 第 3 条效果数值;天赋描述里的「致命一击」是暴击。

## 全天赋 × 技能影响审计(2026-09-26)

结构化静态冷却 / 充能已全接入;真问题在**脚本型按事件减 CD**、**多级天赋按级乘**、**消费端绕过天赋模型**(读基础值)。没接住的全在 `docs/talent-coverage-gaps.md`(由 `packages/eval/scripts/talentCoverageDoc.ts` 生成,修完天赋相关的东西要重跑)。遇到天赋类误判先查它。总表脚本 `packages/eval/scripts/talentCatalog.ts`。

## 二选一节点

戒律的「终极苦修 / 真言术:障」是二选一节点,两个分段的选择率一样 = 不是水平信号,别做成判据(曾误读成「删了屏障」,被用户纠正)。

相关:[cooldown-model.md](cooldown-model.md)、[db2-data-semantics.md](db2-data-semantics.md)、[range-los.md](range-los.md)
