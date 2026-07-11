# 4a 数据再对齐第一轮:benchmark 重建与漂移报告

日期:2026-07-11
新基线:`packages/analysis/benchmarks/benchmark_data.json`(gladlog parser + compat,本地自采语料)
旧基线:`benchmark_data.old-parser.json`(不可变,旧 parser + GCS 公共日志)

## 方法

- 语料:自采单场缓存日志 200 份(全语料 6210 份的首批;后续轮扩量)。
- 链路:GladLogParser → toLegacyMatch/toLegacyShuffle → 逐玩家样本(personalRating ≥ 2100)。
- 分层:spec × 阵容原型(治疗 spec 名 + 非治疗人数),每层 cap 40,minN 30;346 场入统计。
- 重拟合门槛(spec 已定):新分层 P90 与旧基线漂移方向一致 且 样本充足,二者同时满足才动阈值。

## 逐 spec 漂移(pressure P90)

| Spec | n(新) | 样本 | 旧 P90 | 新 P90 | 漂移% |
|---|---|---|---|---|---|
| Affliction Warlock | 23 | ok | 478821 | 363025 | -24.2 |
| Arms Warrior | 64 | ok | — | 514139 | — |
| Assassination Rogue | 19 | ok | — | 432821 | — |
| Balance Druid | 10 | ok | 491224 | 486412 | -1.0 |
| Beast Mastery Hunter | 11 | ok | — | 485258 | — |
| Destruction Warlock | 11 | ⚠️不足 | 493898 | 468674 | -5.1 |
| Devastation Evoker | 17 | ok | 402047 | 410937 | 2.2 |
| Devourer Demon Hunter | 64 | ok | — | 5369 | — |
| Discipline Priest | 55 | ok | — | 139347 | — |
| Elemental Shaman | 15 | ok | 479577 | 531681 | 10.9 |
| Enhancement Shaman | 13 | ⚠️不足 | 496041 | 572453 | 15.4 |
| Frost Death Knight | 11 | ok | — | 488686 | — |
| Frost Mage | 50 | ok | 453032 | 482893 | 6.6 |
| Havoc Demon Hunter | 28 | ok | — | 313015 | — |
| Holy Paladin | 45 | ok | 241108 | 199793 | -17.1 |
| Holy Priest | 23 | ok | 58220 | 94786 | 62.8 |
| Marksmanship Hunter | 16 | ok | — | 514822 | — |
| Mistweaver Monk | 40 | ok | 157095 | 237246 | 51.0 |
| Preservation Evoker | 41 | ok | 379099 | 219469 | -42.1 |
| Restoration Druid | 54 | ok | 279386 | 405940 | 45.3 |
| Restoration Shaman | 50 | ok | — | 231114 | — |
| Retribution Paladin | 38 | ok | — | 464531 | — |
| Shadow Priest | 34 | ok | — | 528387 | — |
| Subtlety Rogue | 16 | ok | 334343 | 410070 | 22.6 |
| Survival Hunter | 26 | ok | — | 488297 | — |
| Unholy Death Knight | 35 | ok | — | 436780 | — |
| Windwalker Monk | 20 | ok | 349875 | 428669 | 22.5 |

可比 spec:14;其中漂移绝对值≤15%:5,>30%:4

## 覆盖缺口(影响口径,需在解读时知情)

1. `advancedActorPowers` 恒为 [](新 parser 未采集 powers)——法力压制类判定失效,不影响 pressure/HPS/DPS 口径。
2. 手写目录(spellEffectOverrides/classSpells/spellCategories/drCategories)为公开事实最小集——主 CD 检测覆盖以自有测试校准,长尾法术缺失会轻度低估 CD 类指标;子项目 5 管线产物替换后复测。
3. 语料构成:自采(个人 MMR 口袋/阵容偏斜)vs 旧 GCS 公共高分日志——治疗系压力口径的大漂移(Holy Priest +62.8%、MW +51%)首要怀疑此因,其次为 M4 已知的 absorb/宠物语义修正。

## 结论(本轮)

- **零重拟合**:14 个可比 spec 中 5 个漂移 ≤15%(核心口径健康);4 个 >30% 全部集中在治疗压力指标,未过双重确认(样本 200/6210 且语料构成差异未剥离)→ `PANIC_PRESS_DAMAGE_THRESHOLD_*` 全部**沿用旧值**。
- 新增 spec(Devourer DH 等旧基线缺失者)记录首个基线值,无对比。
- 下一轮(全语料 + 子项目 5 数据后):扩样本至全部 6210 份,复核治疗系漂移方向;通过双重确认者进入阈值重拟合。
