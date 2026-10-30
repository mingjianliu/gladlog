# 冷却模型与进攻大招追踪

## 容差单源

`cooldowns.CD_INSTANT_SLACK_S = 0.5`,时刻两侧都用(之后 0.5 s 内施放算已用;0.5 s 内转好算就绪)。`cdAvailableAt` / `isAvailableAt` / `resourceSnapshot` / `timelineHelpers.lastCastBefore` 全部共用。另有 `REACTION_WINDOW_S = 1` + `cdReadyInTimeAt`(用户「1 秒内转好的不要管」)**只给指控集**,回应集仍用状态版(见 [predicates-and-gates.md](predicates-and-gates.md))。

## GH #106 冷却模型三步

1. **静态修正**:冷却行 × PvpMultiplier(0 = PvP 关)、SpecializationSpells 专精被动、`PER_RANK_COOLDOWN_TALENTS` × COMBATANT_INFO 级数。
2. **proc 不算按键**:同名 id 只有自带冷却的才算按键(`isVariantPress` / `isPressOfCooldown`)。proc-only 的(某些翅膀)保留激活、否认就绪——**直接删条目会让它的 proc 从「队伍开没开爆发」里消失,造出 78 条假指控**。有的按键从不记日志,以 buff 为证(`AURA_IS_THE_PRESS_IDS`)。没有按键的能力不许被指控(`PROC_ONLY_ACTIVATION_IDS`,与 `AURA_ONLY_ACTIVATION_IDS` 分开:后者混着「结构上没按键」和「平时是按键、天赋另给 proc」两种形状)。
3. **三态就绪 + 动态 CDR**:`[RES]` 基于 `cdAvailableAt` + 天赋充能 + `cdSecondsUntilReady`;战斗中被缩短的冷却打印区间,地板来自 `cdRecastFloorGenerated.json`(`cdRecastFloorScan.ts`;地板规则:两半都复现 + hold-out 最小值在 0.1 内)。held-out「确定在 CD 却真按了」11.2% → 1.4%。

## 坑

- **单排准备阶段伪影**:回合单位带着下一轮的准备阶段(endTime 夹了但事件保留)→ 看起来像「天赋缩短冷却」。找天赋前先比短间隔内的自身事件(Arena Preparation 32727 重挂 = 100% 短间隔)。台账已丢弃 `combat.endTime` 之后的按键。
- 多级 vs 总值从无重置专精的重施**最小值**读;用来选分位的验证集已不是样本外,要报第三份不相交文件集上的数。
- 已知未建模:野性之心(Resto Druid 狂暴回复第二层充能),BACKLOG §58。

## 进攻大招

- 正典表 `spellDanger.OFFENSIVE_CD_SPELL_IDS`,三处「对面开大」判据共用 `isEnemyCdWindowSpell`(30–360 s 冷却界)。**刻意不收**的写在 `spellDanger.ts` 表头。正向扫描 `offensiveCdGapScan.ts`(runbook §7b)。
- **无按键的进攻效果**:只有光环为证的走 `utils/offensiveAuraOccurrences.ts`,进敌方爆发时间线 / crisis / hasOffensiveSpellActive;「事实」类发生放 `offensiveFacts`,**不进 `offensiveCDs`**,这样读爆发列表的下游都安全。
- 用户裁:Eye Beam 顺带的 Demonic「算小爆发」(权重 0,单独开不了窗、能凑对齐);狂怒 Berserk / 敏锐 Shadow Dance「应该不算」。
- 已知缺口:以无冷却副 id 记录的翅膀,敌方爆发窗口看不见它;目标身上的减益(巨人打击等)光环侧消费方看不见。

相关:[db2-data-semantics.md](db2-data-semantics.md)、[talent-data.md](talent-data.md)、[whitelist-rot.md](whitelist-rot.md)
