# 战斗日志解析的坑与字段布局

任何绕开 `@gladlog/parser` 自己写解析的场合都会再踩。逐行读原始 log 能抓出预设口径统计测不出来的 bug,聚合数字看上去一切正常。**字段布局要实测,不能照文档或直觉写**——下面有好几条一开始就猜反了。

## 解析陷阱

1. **时间戳的时区偏移没有分隔符**。`23:02:36.8108` = 810 ms + UTC+8;`20:12:04.937-4` = 937 ms + UTC−4。毫秒恰好 3 位,正则必须写 `\.(\d{3})`;写 `\.(\d+)` 会把 8108 读成 8.108 秒,而且每行加的量不同 → 事件顺序乱掉。
2. **无目标施法的 destName 是不带引号的 `nil`**。前缀正则若写 `,"([^"]*)",` 会整条丢掉——图腾 / 宁静 / 光环掌握等几乎所有大 CD 都是无目标。写成 `,"?([^",]*)"?,`。
3. **单排每轮重新分队并重发 COMBATANT_INFO**。队伍归属按 `(round, guid)` 存;按 `guid` 存会用最后一轮的分队解释前 5 轮,敌我全反。天赋同理要按轮取(多轮玩家约 1/3 轮间改过天赋)。敌我判定走 `sideOfUnit`(teamId 锚定),别用 reaction flags(心控期间 flags 真会翻)。
4. **advanced 参数描述的是 index 11 的 infoGUID**:SPELL_DAMAGE 时是受害者,SPELL_CAST_SUCCESS 时是施法者。按 source / dest 位置读血量会混。伤害 / 治疗数值在 index 30,溢出 / 过量在 32;SPELL_ABSORBED 有 swing / spell 两种长度,用负索引。
5. **伤害符号约定**(全量审计里最大的数据 bug):原始伤害事件的 effectiveAmount 是**负数**(SPELL_DAMAGE / PERIODIC / SWING),SPELL_ABSORBED 为正。`Math.max(0, eff)` 只累加了吸收。写任何 damageOut / damageIn 过滤先看符号。
6. 中文客户端日志的法术名是中文,查法术按 spellId grep。grep `,<id>,` 会撞伤害数值,先看事件类型列。

## 「一次按键 ≠ 一条 SPELL_CAST_SUCCESS」

① 回响复制体 / 套装触发;② **引导跳动**(神圣赞美诗、宁静、虚空冲击——判据是同轮相邻间隔 ≤1.05 s;阈值不能放到 1.4,有些真按键就是 1.4 s;赞美诗虚高 5 倍);③ **同刻记两条**(能量灌注给队友时同时记给队友和自己,按 (t, spellId) 去重)。另有被动以施法事件出现(Reclamation 占神圣骑士全部施法的 24%,不滤掉整张循环表作废)。

## 事件字段(都是实测过的)

- **SPELL_INTERRUPT**:index 11 = 被打断的法术 id,**index 13 = 被锁的学派掩码**(不用查表)。
- **SPELL_AURA_BROKEN_SPELL**:打断者就是 src。
- **SPELL_CAST_START**:目标 GUID 恒为 0,读条目标在落地前不可知。
- **SPELL_CAST_FAILED**:只记录录日志的那个人,而且不带目标、不带位置。所以停读条 / 被拒施法数据只有录制者有。
- **资源**(`decodeAdvanced` 的 `powers`):锚在自动探测的 x/y 对之前;一次可能报多种资源,管道分隔(`13|0`),必须按列表解。ENERGIZE 尾部 = 获得 / 溢出 / 类型 / 上限;施法快照在扣消耗之前。
- **missType**:`ABSORB` 与同刻的 `SPELL_ABSORBED` 是同一发伤害的两条记录,再加一遍就重复计;独有的只有 IMMUNE / REFLECT。
- **DAMAGE_SPLIT**:src **不是攻击者**,是被转移伤害的人;只能进 `dest.damageIn`。全局只占入伤 0.4%,但对涉及的单位是自身承伤的 p50 10.9%——聚合小、个体大。
- **充能等级(EMPOWER)**:不能并进 `casts`(本来另有 SPELL_CAST_SUCCESS,会双计)。
- **SPELL_HEAL_ABSORBED**:前缀描述的是吸收不是治疗;也不是 HPS 漏算——`SPELL_HEAL.amount` 已经是扣治疗吸收后的净值。
- **高级块槽位**:maxHp 与 powerType 之间 6 槽;+9 = 剩余伤害吸收、+5 = 智力、+6 = 护甲,+4 / +7 无法命名,+8 恒 0。
- **朝向**:弧度,θ 指向日志坐标 `(cos θ, sin θ)`;只按 `advanced.actorGuid` 归属;同毫秒的行没有先后。

## absorbsIn 的两层(别混)

- L3 `GladUnit.absorbsIn` 按**攻击者**键,**故意保留**:`convert.ts` 把它并进 `damageOut`,攻击者键在那里才对。
- compat `ICombatUnit.absorbsIn`(所有 analysis / desktop 消费者拿到的那层)按**受害者**键。`victimId` 必须在 collect 时落到事件上(瘦身会清掉原参数)。
- 要「某单位承受的吸收」→ 读 compat `absorbsIn` 或 `incomingPressureEvents`(`utils/incomingPressure.ts`:伤害 + 被盾吃掉的整发;整发被吸收的伤害根本不进 `damageIn`,漏的比例按专精 1%–35%)。

## 召唤物归因走来源 GUID

同名召唤物归因走**事件自带的来源 GUID**(`sourceId` → `timelineHelpers.resolveSummonOwner`),不用「按边过滤」的小改(残留失败与原 bug 同形)。门规 `checkPetCreditSide`。NPC 被杀读 `nonPlayerUnitKill`(首个 overkill > 0 的 damageIn;宠物目标的 effectiveAmount 会被清零,所以 overkill 是独立字段)。

## 「没读过的事件」清单要先核产品侧

一次照研究侧提取器写的「8 条缺口」动工前逐条核对 parser / analysis:2 条落空(产品早有)、1 条部分已有、5 条坐实。**别照研究侧的缺口清单直接动工。** 玩家口头讲解 / 录像可以用来校准提取器,但给的是线索,判据仍要实测;录像是发现工具,不是数据源。

相关:[log-observability.md](log-observability.md)、[whitelist-rot.md](whitelist-rot.md)、[fact-layer-direction.md](fact-layer-direction.md)
