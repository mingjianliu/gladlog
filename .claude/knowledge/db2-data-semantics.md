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

## 外部数据源

- wago.tools CSV **不含 hotfix**(`hotfixes=` 参数被忽略)。SimC `midnight` 分支的 `sc_spell_data.inc` 带热修数组(field 27 = PvpMultiplier),已做成叠加层 `packages/analysis/scripts/datagen/fetchSimcHotfixes.ts`。
- SimC 可借的已收完(hotfix 数组、属性名表、枚举名表——aura 31 是移速不是加速、种族名单)。TrinityCore 行为层是逆向近似,只借减伤叠加公式。
- **外部 GPL 代码只借事实进数据表、只借思路,不抄代码**(本仓 MIT / clean-room)。
- 没有可借的竞技场模拟器:SimC 是 PvE 木桩(无治疗 / CC / DR / 走位),私服 bot 全是旧版本。「能不能借 X」先量覆盖率交集(`observedSpellIdsGenerated`)、字段有无、与语料对拍。

相关:[official-data-first.md](official-data-first.md)、[season-data-refresh.md](season-data-refresh.md)、[talent-data.md](talent-data.md)、[cooldown-model.md](cooldown-model.md)
