# DB2 数据语义

## PvpMultiplier(用户 2026-09-04 裁:PvP 值为官方值)

`SpellEffect.PvpMultiplier` 乘在 `EffectBasePointsF` 上才是竞技场数值(致死之伤 −50 × 0.5 = −25%、圣疗术 100 × 0.75、压迫咆哮 50 × 0.6 = 30%);`SpellMisc.PvPDurationIndex` 同理。任何从 EffectBasePointsF 派生的数值都要乘它,新生成器加这一步。冷却行同理:× PvpMultiplier(0 = PvP 关)。光环掌握用户裁 24%。减伤叠加实测后刻意不建模。

## 天赋 / 被动的数值效果

天赋自己的 spell id 通常不带效果光环,数值挂在 tooltip 引用的另一个法术上。正确谓词 = **zhCN tooltip 文本 + 顺着 `$<id>s<n>` 占位符解析**(`packages/analysis/scripts/datagen/genTalentMitigation.ts` 是范例:tooltip 命中数下限 + 双正控守卫)。受益者用就近指代(牺牲咆哮的减伤给盟友,宠物只是载体)。title 占位符也要 interpolate。

## SpellMisc 属性位

先查命名表,别穷举:SimC `sc_spell_info.cpp` 的属性名表(全局序号 = 组 × 32 + 位)+ TrinityCore SharedDefines(晕 163 ∪ 378、恐惧 177、混乱 178)。一次穷举选出的位其实是「遭遇战结束重置冷却」,把 213 个长 CD 误标成晕中可用。签字锚点也可能错,命名位 + 语料双证据才动。

## 充能技能的两个数

DB2 对充能技能有两个数(按键间隔 / 回充)。`cooldownSeconds ?? recharge` 内联 11 处取了间隔 → 某些大招过不了 30 s 门。统一用 `effectiveCooldownSeconds`(`spellEffectData.ts`)。冷却先读充能分类(痛苦压制 180 s 在 SpellCategory)。

## 踢技没有时长字段

DB2 踢技是 Effect 68,无锁定时长。`kickLockoutSeconds` 读语料表 `kickLockoutObservedGenerated.json`(`kickLockoutScan.ts`:打断后受害者首次同学派施法间隔的众数);法术反制用户裁 6 s。「保守兜底」要算方向:锁定偏短 = 少豁免 = 多冤枉。

## 专精被动

`SpecializationSpells` 有专精被动(约 50 行,如治疗饰品 90 s)。「没有修正能解释」时要同时问 SpecializationSpells,不只天赋 + PvP 池。

## 受疗修正与减疗(恢复德鲁伊研究 2026-10-28 实测)

- 受疗光环:118 全部治疗,259 只作用于周期治疗,283 / 462 只作用于**光环施放者自己**的治疗并须对上 class mask。
- **减疗(负的 118 / 259)不叠乘,只取最强的一个**:同时挂两种减疗的治疗跳,按乘积预测 ±5% 内只有 8.8%,只取最强 83.2%(10,247 跳)。毒蛇之血 1291471 是加深致伤药膏,照常相乘。
- **减疗数值由施加者的天赋决定**:施加者 aura 107(加值)/ 108(百分比)行,SpellMod op 对应被改的效果(3 → #0,12 → #1),同 SpellClassSet、class mask 覆盖该减益,× 施加者本回合 COMBATANT_INFO 的 rank。毒药大师 378436 让致伤药膏 +20%(每层 −8 × PvP 0.5);感染伤口 58180 的减疗在 DB2 里是 0,全部来自野蛮爪击 203242(−8 / 层,+1 层上限)。致死打击 PvP −25%。
- 「DB2 class mask 覆盖到」≠「实际生效」:德鲁伊长者之唤 319454 的 +30% 不作用于恢复的治疗;石皮 197061 只作用于铁木树皮自己 aura 283 掩码里的 HoT。都要拿残差验证。
- SimC 热修叠加层漏了法强系数(field 9)和 ImplicitTarget_1(field 25),热修改系数时看不见——GH #162。
- 按最大生命值百分比的治疗(织雾金创药 428439,PvP 7.5%)吃减疗,但不吃正向受疗被动(仙鹤之赐 388811 +6%,aura 118)和 aura 504(希望之球):织雾研究 2026-10-29 实测(带上被动 0/914 跳在 ±5% 内,去掉 848/855),机制未识别,只验证了这一个法术。
- SpellEffect `Variance`(如 0.05)= 每次命中在 ±5% 内均匀随机;伤害转治疗会继承触发那一下的随机。拿单跳数值反推系数 / 修正时,先看该效果的 Variance,别把随机当成机制。
- **正向的「DB2 为 0、施加者天赋填」也有,op 不止 3 / 12**(织雾研究 2026-10-29,GH #170):树皮术 22812 #3 受疗由翠绿之心填 +20%(约 2% → 83.4%,3,564 跳);源能魔法 369459 #2(aura 136)由 Potent Mana 418101 以 op 23 填 +3%。完整映射 3 → #0、12 → #1、23 → #2、32 → #3、33 → #4(SimC P_EFFECT_1..5)。施加者读光环自己的来源 GUID,不是同局任何人。宠物 / 守护者的治疗不吃主人身上的 aura 136。
- **光环效果自己 tooltip 不写、只被天赋 tooltip 用 `$<光环>s<n>` 引用 = 该天赋开关**:青龙下凡 322118 #8 / #9 的 +5% 只有 Restore Balance 442719 提到,没点的人语料里不吃(保留 57.0% vs 去掉 84.8%),点了的人吃。KB 的 `via` 是法术级的,不能当逐效果门。
- 实测与 DB2 不符、来源未识别(FLAG):「死亡」327095 每层 −6%(DB2 −5);仙鹤之赐 388811 +4%(DB2 +6)。

## 外部数据源

- wago.tools CSV **不含 hotfix**(`hotfixes=` 参数被忽略)。SimC `midnight` 分支的 `sc_spell_data.inc` 带热修数组(field 27 = PvpMultiplier),已做成叠加层 `packages/analysis/scripts/datagen/fetchSimcHotfixes.ts`。
- SimC 可借的已收完(hotfix 数组、属性名表、枚举名表——aura 31 是移速不是加速、种族名单)。TrinityCore 行为层是逆向近似,只借减伤叠加公式。
- **外部 GPL 代码只借事实进数据表、只借思路,不抄代码**(本仓 MIT / clean-room)。
- 没有可借的竞技场模拟器:SimC 是 PvE 木桩(无治疗 / CC / DR / 走位),私服 bot 全是旧版本。「能不能借 X」先量覆盖率交集(`observedSpellIdsGenerated`)、字段有无、与语料对拍。

相关:[official-data-first.md](official-data-first.md)、[season-data-refresh.md](season-data-refresh.md)、[talent-data.md](talent-data.md)、[cooldown-model.md](cooldown-model.md)
