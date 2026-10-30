# 正式数据优先,但官方表也要实测

## 判据优先走官方 DB2

用户 2026-07-25 两次明确要求「用正式的数据而不是推测」。

- **Why**:手工表会腐烂([whitelist-rot.md](whitelist-rot.md)),行为启发式有误杀 / 漏放两个方向的错误;官方 DB2 字段(`PvpTalent.OverridesSpellID`、`SpellCategories.DiminishType / DispelType / Mechanic` 等)是事实源。
- **How**:新判据先查 wago.tools DB2 有没有对应字段(datagen 管线 `fetchTable` 现成)。但官方表**也要在真实语料上验两个方向的错误率**再上——SkillLineAbility 在 12.x 缺现代 trait 技能(Cleanse / Penance / Blur 都不在),纯官方门误杀 20+ 真按键,被实测否决(设计史在 `casts.ts` 注释)。
- 终局常是:**官方数据为主 + 语料实证兜底 + 逐条证据的小 curated 层**。
- DR 表已官方化(2026-07-25),只有 disarm / knockback 两类无 DB2 字段,保留手工。

## 官方数据答不了「日志里看不看得见」

奥术涌动施放 241 次、光环事件 0 条(DB2 里没有 aura 行)。「过期 / 存在」类判据只能用**日志真相**(友方身上出现过 APPLIED / REMOVED)。

## 真值集必须双向

`reachesAlly` 当天返工:87 个 ImplicitTarget 里 18 个是**目的地标记**不是友方标记,误判 405/965(旋风斩、火雨、奉献)。根因是真值集里**没有敌方对照类**,加 `MUST_NOT_REACH_ALLY` 后才抓出来。**单向真值只能证伪不能证全。**

## 三值标签撑不住「这技能干什么」

`SpellTag` 只有 Defensive / Offensive / Control 三值,48 个 Defensive-tagged CD 里 11 个(22.9%)完全没有减伤 / 吸收 / 免疫(绝望祷言只能自愈却被要求救队友;保护祝福纯物理免疫却被推荐躲自然系控)。地基已改成官方六维(`spellTargeting`、`spellSchools.immunityCoversSpell`、`abilityProfile.isSurvivalWall`、`cooldowns.canHelpAnotherUnit`),都登记在 predicate-index。

## 语料清洗必须确定性

用户 2026-08-29 裁:「把数据先自己洗干净,不要用概率去猜」。一次循环聚类研究里三处「打法差异」全是数据伪影(id 分裂 / 被动 / 跳动),概率阈值会把伪影洗成「发现」。确定性层的例子:

- `TraitDefinition / PvpTalent.OverridesSpellID` 改名合并,附逻辑约束(同一人同一轮两个名字都按过 = 两个键,因为 OverridesSpellID 包含跨专精的动作条换位);
- 同名同刻 ≤0.1 s = 一次按键;同名 `EffectTriggerSpell` 父键 15 s 内 = 跳动;`SpellMisc.Attributes_1 & 0x44` 引导时长内同名 = 跳动;`SpellCooldowns ≥ 20 s` 无充能冷却内同名 = 非按键。
- 被动触发(复用 / 回响副本等)DB2 关系表里没有,只能人工确认登记;候选扫描只产清单给用户确认。
- 天赋改名(闪现 ↔ 闪光术)合并成一个键,天赋只做标注。

## 种族技能:只能被动确立

战斗日志**没有种族字段**(COMBATANT_INFO 只有职业 / 专精 / 天赋 / 装备)。观测到施放 = 拥有;种族谓词永远不得给出 "no"。解控种族与 PvP 饰品**共享 30 秒跨锁**(DB2 的 CategoryRecoveryTime 里没有,语料最小间隔 30.1 s;逃脱术不共享)。表在 `packages/analysis/src/data/racialAbilities.ts`。发现新种族 id:语料扫「跨 ≥4 职业施放且不在 classMetadata」。

相关:[db2-data-semantics.md](db2-data-semantics.md)、[season-data-refresh.md](season-data-refresh.md)、[talent-data.md](talent-data.md)
