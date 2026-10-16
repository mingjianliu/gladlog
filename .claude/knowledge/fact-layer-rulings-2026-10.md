# 事实层工单的裁决(2026-09-30 → 10-15,PV192 → PV401)

这两周是 [fact-layer-direction.md](fact-layer-direction.md) 那条方向落下来的样子:270 个提交,几乎全是「事实行怎么读、怎么写」。裁决原来只活在提交信息、`promptVersion.ts` 的版本说明和 `docs/predicate-index.md` 的 OPEN 条目里;这里按主题收一遍,每条带 PV 号,原文去 `docs/prompt-version-history.md` 查。**状态以代码为准**;裁决编号(A/D/U/B/P/R/X 系)是 triage / FT 工单内部的,仓库里没有总表。

两类批次要分开报,这是流程裁决本身:「facts only / NO CANDIDATE ADDED OR REMOVED」的批次只改事实行和 facts 字段;「CAN ADD / REMOVE … ROWS」的批次动指控集,605 文件 capture 的逐类增减写进提交信息。

## 1. 回合末是一道硬边界

- **一个回合末**(`roundEndMs`:单排的第一个玩家死亡,否则 combat 末)管所有窗口:CC / 未解控 / 治疗空档(PV275)、击杀窗口与 KILL ATTEMPTS 的括号(PV372、T12 ① d)、`[DMG SPIKE]` 桶、[OFFENSIVE WINDOW] 头(回合末之后开的窗没有头)、missed-purge 的 `unpurged for Ns`(PV377)、backlash、sync-window 进入(PV393)、[CONSEQ] 的沉默 / 踢、[CD PRIOR]、召唤物可达(PV388)。
- **3v3 菜单到第一个友方死亡为止**(`playableEndMs`,PV208,用户自己那场复盘的裁决)。
- 回合末被切断的光环**说「still up when the round ended」**,不把切口当时长(PV363、PV374);**回合末还在身上的增益不出 `[BUFF FADED]` / `[ENEMY BUFF END]`**(PV376)。
- 仍开着:事件类行(`[YOU] [CD]`、`[ENEMY DEF]`)回合末之后照印(predicate-index N4 F02b);`[SLACK]` 扫描还走 log 末(45-FT-98)。

## 2. 光环的生命周期只信日志

- **结束 = `SPELL_AURA_REMOVED`**;前面 1 s 内的 `BROKEN[_SPELL]` 是「什么打了它」,不是结束(PV338;冰霜新星类定身因此多算半秒)。
- **再广播 = 一个光环**:同技能同源同目标 REMOVED→APPLIED,先放宽到 ≤1 ms(PV337),后收回「两段必须精确相接」(PV386,codex 反例);还开着的 CC 被重新 APPLIED(群隐、持有者 flag 变化)是**同一次施加**(PV391、PV395)。
- **丢失的 REMOVED 按官方时长封顶**(PV303、PV392——再没有 50 s 的沉默);**`[ENEMY DEF]` 日志没见结束就印 `end not logged`**,KILL ATTEMPTS 跟着(D6,PV368)。
- **结束原因只写日志给的**:`dispelled by` / `stolen by` / `its target died` / `used up — absorbed Nk` / `ended at death`;剩下的是 `ended early — cause not logged`,不猜「取消」(PV339、PV340、PV346、PV373)。REMOVED 与控制免疫同毫秒 → `ended by their Bladestorm`(PV374)。
- **REFRESH**:同一控制跨 REFRESH 一行说明(PV373);但施法者 3 s 内重新施放造成的 REFRESH 是**新的一次 CC**,双方都另起一行、各自 DR(A51,PV276)。
- **每次按键读自己目标身上的那份副本**;同一单位上还在时再按一次是刷新,不单独出 FADED 行(PV398、PV399)。
- 持续类事实:进攻大招的跨度到**它的效果光环在玩家身上被看见结束**为止,不是 10 s 地板(A14,PV254 / PV295);在宠物 / 图腾 / 守护者身上的副本不算「还在开」(PV373)。

## 3. 真最低点与渲染网格(D7,PV368)

- 凡是**声称「窗口最低血量」**的数字——`[DMG SPIKE]` low、[CONSEQ]、爆发台账目标行、`[BURST ANSWERED]` bottomed at、kick-eaten ourLow / theirLow、STAYED IN min、slow-defensive pressuredHpPct——读**真实最低点及其发生的秒**(`hpTroughInWindow`)。
- **每个门、每个判决、每个 [STATE] 读数仍在整秒网格上**;[STATE] 有图例:在该秒开头读,该秒的事件在它之后,缺席的单位不是 100%。
- 按键行的 HP 是**按压瞬间**(`hpAtPress`,A21,PV296)——这是 CLAUDE.md 的签字例外,已写进去。
- 没动的:`[CD PRIOR]` 的 bottomed(predicate-index WP-E 条目)。

## 4. 免疫与自保的措辞

- **完全免疫只有三个**:冰箱、圣盾、灵龟(`FULL_IMMUNITY_IDS`,F-BI-full / F-K9b-B,PV268 / PV274)。斗篷、保护祝福、守护祝福是「目标开了大防」,不是免疫。
- **学派受限的保命**(BoP / Spellwarding / 斗篷 / AMS)只在它覆盖**瞄准目标的伤害 ≥50%**(落地 + 被盾吃,按学派)时算「挡住 / 就绪」(A29、U-KA2、B3a:PV298 / PV310 / PV330)。
- **假死、烧灼、欺诈、自然守护是它们自己**(吸收 / proc),不是 `immune`;KILL ATTEMPTS 写 `self-saved (X)`(D8,PV368)。
- **敌方非墙类自保写它做了什么**——`(absorb Nk, Ts)` / `(heal)` / `(dodge)` / `(spell reflect)` / `(rewind)` / `(redirect)`——**永远不写 `(self-save)`**;KILL ATTEMPTS 写 `popped X`(PV376)。
- 已经开着的免疫只在**日志看见它结束**时算(按官方时长封顶的不算,P-FU-b8,PV312);潜地 / 消失 / 群隐开着时算免疫,DoT 跳、范围伤、第一秒的一下不是反证(U-KA3)。
- 牺牲咆哮自己按:先 `(redirect)`(PV376),语料分割证实后改回官方 `(25%, Ts)` 并注明不是墙(PV377)。

## 5. 「那一刻能不能按」(cannot-cast)

- **踢锁按学派、按技能问**(D 系 option B,PV367;再到 DB2 的沉默位 PV390):被反制术锁了奥术的法师仍能冰箱;沉默只挡 DB2 说能挡的(风暴打击、致死打击、审判、树皮在沉默下照放)。消费方:cd-hoarded ownerFreeS、sync-window readyCds / holderCc、kick-eaten ccInWindowS、[DEFENSIVE AVAILABLE]、漏驱 / 漏偷的锁定测试、[CD PRIOR]、死亡块选项标签。
- **缴械挡需要武器的技能**(PV393);Faerie Swarm、Sticky Tar Bomb 是缴械(PV389)。
- **自己的飞行(深呼吸、永恒之息、梦境飞行)= 不能施法**,像晕一样(用户「深呼吸算是不能施法」「飞行不能施法」,PV386 / PV393);日志没见结束按官方时长关(PV387)。
- **宠物放的技能问宠物自己的封锁**,不问主人(PV372;只限 `Pet-` GUID 的受控宠物)。
- **晕中可按走 DB2 的免疫路线**(U-T1,PV311):圣盾、冰箱、冰封坚韧,物理晕下自己的 BoP;圣盾 / 冰箱永不出现在 `cheaper available:`(成本规范签字册)。低温症 / 自律读自身光环(PV373 / PV352)。
- **被拒绝的按键是事实,不是豁免**:GCD 拒绝算一次尝试(C1,PV213);`attempted` / `otherAttempts` / `refusedInLock` / `[UNUSED — pressed N×, refused: …]`(B1、PV378、PV384);拒绝原因用 prompt 的语言写,不抄客户端文本(Q6-2,PV386)。
- 「1 秒内转好的不要管」只给**指控集**(`cdReadyInTimeAt`),回应集仍用状态版——见 [predicates-and-gates.md](predicates-and-gates.md)。

## 6. 击杀尝试与击杀窗口

- **「手里有墙」= 账本里有、没按过的 20–99% 墙**(R08 b,PV379):目标或「更软目标」持有 `[UNUSED]` 墙就不是 PRIME 而是 gated;天赋授予的按键按 DB2 `VisibleSpellID` 证明所有权(PV381,圣疗术 / 壮胆酒 / 十字军 …)。
- **`defenseless` 跨度在目标自己开的墙处切断**,也在它收到的外援处切断(A24 / A25 / PV380);群隐不切(P-b8)。
- **失败原因是「尝试内开的或开始时已在的保命」**,不是击杀宽限里按的;饰品只在解了本次尝试的控制时算;饰品 + 免疫两个都写;**自保 + 外援两个都写**(A29、B16b,PV298 / PV325)。
- 窗口到目标死亡为止(D1);一个死亡只记一条 KILL;尝试遇到我方自己的旋风写 `target in your team's Cyclone a–b`;救赎之魂形态下没有窗口也没有括号(PV379);**我方神圣骑士的复仇之怒不锚定击杀尝试**(B15c-U10,PV326),敌方那边不变(A27)。
- 起手打有饰品的人不指控(2026-09-22 裁决仍在);敌人坐在我方可打破的控制里不是「更软目标」(PV304)。

## 7. 爆发窗口与回应

- **被压的友方 = 爆发打到且在窗口内先死的那个,否则最低血**(n37「按你的建议走」,PV400);「被打到」= 落地或 IMMUNE(PV389),爆发引擎与 POSITIONING 共用这一个谓词(PV393)。死了的被压友方死后没有自保、不从尸体上风筝(PV401)。
- **控制算回应,只当它的目标(或其宠物)在窗口内打了被压的人**(D3,PV368);回应要落地(自身光环 / 效果光环 / 打断的 SPELL_INTERRUPT,PV272);被压者死后按的不记(PV368);团队外援(灵魂链接、屏障)算回应(PV188)。
- **距离量到「这段里打你最多的那一个敌人」**(D2):STAYED IN / KITED / position-mistake。
- 每个 [OFFENSIVE WINDOW] 头后跟一整行 `[RES]`(B14b,PV333);`[DMG SPIKE]` 只挂重叠的窗、每个尖峰一次、top-5 上限写明(D4)。
- 2v2 减益:**回合内第一条记录的层数往下一格**是起点(D11 的用户读法,PV369——实现者先交了「没数」的读法被纠正)。

## 8. 踢

- **JUKED by fake X** = 踢之前目标开始的最后一条读条,且它既没放出来也没人打断;**可能被控制 / 沉默 / 击退打断的读条不算假读**(A′17 的证据腿,PV373);0.5 s 内自己停的引导也算 JUKED(B7a,PV315)。
- 锁内列的拒绝只收日志说「not ready」的;同一技能成功后 0.3 s 内的 not-ready 是连点(PV249);读条开始后锁定学派的读条结束踢锁(PV389);锁超过 5 s 列出锁内每一次按键(PV388)。
- `outRangeable=yes` 要踢人者站得比「读条期间按 7 yd/s 能走进来」还远(X3,PV327);踢人者在硬控 / 沉默里不算(PV251)。
- 上限 2 + 2:有死亡或危机血线事实的踢单独一组(A34,PV256)。
- 踢的冷却读官方(镇压 / 沉默 / 反制 20 / 30 / 25 s,PV355);Coldthirst / 日光之怒按次减(PV356);打断了什么都没打断的踢写日志的 miss 类型(PV354)。
- 没动的:「不就绪」在锁内是锁还是自身冷却,日志同一个理由(predicate-index I01)。

## 9. 驱散

- 16 条签字的驱散裁定(A41-签,PV236):签过的 id 按签字格渲染,没签的 `verdict=unsigned`。
- **有自己作用域的清除工具**(碎裂投掷:只对免疫盾;奥术洪流 / 切割永不出行)按各自冷却与射程算(P-P5b,PV244)。
- **敌方宠物打破的 CC 是被伤害打破**,不是未解控窗口(BROKEN 行的 source 就是打破者,PV396);队友的牺牲祝福、持有者自己的时间膨胀一样(40-FT-97)。
- 占用谓词一个(`occupancyWithin`:硬读条 ∪ 终极苦修自光环 ∪ 喝水,A43,PV234);窗口内起手的读条不豁免、改话术(2026-08-23 裁决仍在)。
- 反噬:同类反噬 debuff 进 `coRemovesBacklash`(A44);反噬沉默锁住驱散者(PV273);敌方的反噬沉默是 `[SILENCE]` 行(PV373)。
- 未驱散 / 漏偷 / 反噬窗口里一次再广播 = 一次施加(PV389)。

## 10. 冷却账本的所有权

- **天赋不明(没有 COMBATANT_INFO 行,或 blob 解不开)→ 不断言任何没证明的冷却**;树内天赋解开了按天赋,树外按 PvP 天赋选取或激活证据,专精基线防御按 `BASELINE_DEFENSIVE_BY_SPEC`(40-FT-74,PV380)。
- 专精基线防御**没按也留在账本**(loadout / [RES] / [UNUSED] / cd-hoarded 就绪集),只有 cd-hoarded 可以点名(C4,PV302)。
- **只按键、不就绪**的两类行(option ②,PV361 / PV362):敌方印 [ENEMY DEF] 的保命(治疗石、介入 …)和敌方印 [ENEMY CD] 的 12 个进攻大招,按了出按键行 / 账本行 / [RES] 条目,但不进任何 `ready` 列表、不被 missed-sync-window 点名。
- 群隐 cd-hoarded 可指控、cd-waste 永不点名(PV203 / PV205);假死只做回应(`RESPONSE_ONLY_DEFENSIVE_IDS`,PV204);一个充能池的多个按键 = 一行 cd-waste(PV378)。
- proc 不是按键(Radiant Glory 的复仇之怒、恶魔变形读 `(proc k of N)`,PV348);天赋替掉的按键印 `[PASSIVE]`。
- 新上账本的行:死亡契约(防御)、巫妖之躯(仅账本)、烟雾弹(非防御)、冠军之矛(Utility;1271980 的再按不是第二次)、战栗图腾 / 消失(Utility)(B15a / B16c / PV374 / PV388)。

## 11. 伤害读数

- **effectiveAmount = amount − overkill**(A38,PV260,推翻裁定 #13):日志的 amount 已经扣了吸收,再减一次把 25.9% 的部分吸收打低了。
- **被盾吃掉的一下是对被打的那个单位的伤害**,不是盾主的(PV259——治疗给队友套盾曾被当成「目标」)。
- **时间膨胀 / Stretch Time 只是延迟的伤害算一次**,在真正掉血时(option B,PV344);`[ENEMY DEF] … +Dk deferred`。
- 近战:只有 `SWING_DAMAGE_LANDED` 的挥击也是伤害事件(FT-T01「走 A」,PV335);**挥击以受害者侧那行为准**,两行不一致时血量跟 LANDED(FT-T02c,PV336)。
- 队友的再分配(灵魂链接、Void Leech)不是入伤 / 压力(A22,PV265 / PV307);伤害来源的阵营按名册,被魅惑的单位按名册算(PV265)。
- ABILITIES INTO IMMUNITY/DR 列 ≥5% 的技能——之前因符号反了列的是 <5%(PV345)。

## 12. 语言、标签、数字的写法

- 玩家用名册标签(`3(AWarrior)`),不用角色名(PV358);召唤物叫日志说的那种——`'s totem` / `'s pet`(仅 Pet- GUID)/ `'s guardian`(PV349);宠物的打破是宠物的(`N(Spec)'s pet's X`)。
- 半秒以下印 `<1s`,精确零才 `0s`(PV363 / PV372);`[RES]` cd 剩余 floor 到网格(PV352)。
- 「did not answer it by this measure」,不写「did NOTHING」(A48,PV223);图例只在那行印出时才印;图例互相引用只引真印了的行(PV394)。
- 不写日志分不清的:读条停了不叫「cancelled / moved」(`[CAST STOPPED]` 只说日志怎么显示它结束的,PV371);SPELL_CAST_FAILED 只有录制者有;停读条 ≠ 假读。
- 面向用户的 `cheaper available:`、`[DEATH] Unused:` 都读 cd-hoarded 的学派规则(B3a,PV330)。

## 13. 一个决定一张卡

- external-unused 的受害者死亡 5 s 内的 cd-hoarded 卡丢掉(R11 = B,PV200)。
- 菜单 ≤3 个事件时要求「up to N findings,每个事件最多一条」;引用完全相同事件 id 的后一条 finding 被审计丢掉(PV379)。
- 引用规则写在菜单头:「只有可引用的事实」,不是「provably happened」(D5,PV368)。

## 14. 日期门与解析器事实

- **按日志日期取值**的游戏数字:Storm Conduit 热修(2026-08-18)前 4 s / 后 2 s,锁定 ×0.35 / ×0.6;旧值只在距切换点 14 h 以外才取(没有带符号 UTC 偏移的行可能早 14 h,45-FT-101,PV376–378);一个比较函数 `logIsFrom`。
- 行自述时刻 `logLineInstantMs`(东半球偏移不带符号);日期门还读解析器日期(OPEN)。
- 施法消耗读 `SPELL_CAST_SUCCESS` 行自带的 `powerCosts`(PV378):是减免前的标称消耗,百分比类 = 基础法力 250,000 × 百分比;只做「买不买得起」的事实,**法力信号不做**(2026-09-20 裁决仍在)。
- 近战双行(`swingTwins`)、充能开始 / 中断(`SPELL_EMPOWER_START / _INTERRUPT`)只在新解析的文档里有——评测一律从 raw.txt 重解析。

## 15. 流程上的裁决

- 「facts only」批次与「动指控集」批次分开;**每批写 605 文件逐类增减**,不动的写「no candidate added or removed」。
- 新事实行先给**真实对局样本**再落(D15 的 (a)–(d) 都是看过样本后「按你的建议来」);小项攒着「把后续那些小项也都先给我做了」一次做。
- 审查:codex / agy post-hoc 逐批;审查发现的反例修了要钉测试(`reviewFixesBatches*.test.ts`);审查者的「推翻性结论」自己复核(agy 40-FT-100 一类是对的,也有过前提错的)。
- 参照表过期登记到 GH #115,攒着批量重跑(PV334、PV382 两次);重跑用被替换表的同一语料。
- 残余错误三分(模型错 / 输入错 / 日志给不了)——self-review(PV395 上 51 份,WRONG 48 → 15)之后那 15 条**还没分类**。

相关:[coaching-rulings.md](coaching-rulings.md)、[predicates-and-gates.md](predicates-and-gates.md)、[fact-layer-direction.md](fact-layer-direction.md)、[cooldown-model.md](cooldown-model.md)、[dispel-cc-mitigation.md](dispel-cc-mitigation.md)
