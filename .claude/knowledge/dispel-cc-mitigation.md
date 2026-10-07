# 驱散、控制、减伤与反事实

## 驱散:两半,腐烂风险不同

- **「能否驱散」干净**:`getDispelType` 直读官方 DB2 dispelType。算「驱散缺口」必须先走 `dispelKind` 过滤(`utils/dispelKind.ts`,deliberate / proc / rider)——否则变形解控会被算成驱散(缺口 6.4% 其实是 0.8%,照原框架「观测回填」会直接制造假指控)。驱散类判断要同时扫 `SPELL_DISPEL` 和 `SPELL_STOLEN`(法术吸取记在后者)。
- **「优先级」是手工白名单**:`dispelAnalysis.getPriority` 只认减伤白名单(→ Critical)与 `spellCategories`(→ High / Medium),都没有就是 Low,而漏驱散分析只收 Critical / High——**没登记 = 永远看不见**(寒冰护体、真言术盾就是这么漏的)。
  - 高价值增益登记 buffs_defensive / offensive;官方时长 3600 s 的赛前团队增益进 `PURGE_BLOCKLIST`;HoT / proc / 短位移增益不登记(会灌爆话题)。
  - 上下文相关目标用「门」不用固定档(自由祝福:`COMP_DEPENDENT_PURGE_TARGETS`,我方无猎人 / 法师判 Low)。
  - 注意 `bigDefensiveSpellIds` 加进去会连带把技能变成 Critical 驱散目标。
- **missed-cleanse 三层**:官方 dispelType → 语料实证被驱过 → 用户签字裁定册 `dispelVerdicts.ts`(角色 × 递减)→ 时机门 `threatActiveAt`。
- 门要装在候选层(`canDefensiveCleanse`),见 [predicates-and-gates.md](predicates-and-gates.md)。
- **责难类 feature 的正确形状**:可行性门(站位 / 被控 / 踢锁)拦不可行的 + 价值注解(DR 链)只降级措辞;三态铁律(无位置 = null 不改判)。

## 控制与 DR

- 控制时长读官方 DB2(`ccFullDurationSeconds`),见 [season-data-refresh.md](season-data-refresh.md)。
- DR 窗口 `drResetMsAt(epochMs)` 按时代 16 s / 20 s。
- **定身不进 DR_CATEGORY_MAP / ccSpellIds**,别再提「加 root 进 DR 表」;定身的价值用 `[ROOT]` 事实行表达(被定的人从那个位置够不够得到目标:近战 12 码、治疗 / 远程 40 码 + LoS,≥3 s)。
- Bull Rush 没有 DiminishType,别照 War Stomp 手加。
- 解控种族与 PvP 饰品共享 30 秒跨锁(`trinketCooldownRemainingMs`);解控种族绑定到它解掉的 CC(`trinketState="racial_break"`)。
- 免疫覆盖 `immunityCoversSpell` 三态,缺数据 = 未知。

## 减伤表

- `MITIGATION_TABLE`(DB2 aura 87 生成 + 策展覆盖)+ `NO_MITIGATION_IDS`;值读 PvP(× PvpMultiplier)。
- **positional 硬契约**:`IMitigationEntry.positional?: true`(如黑暗)只对站在区域内的单位生效,消费方必须结合 advanced 坐标判定,不判定不得计入(漏读会方向性高估);日志判不了的条件宁缺。
- `pctOnOthers` + `mitigationPctFor()`(某些减伤给别人的比例不同)。
- **减伤表与治疗裁定册(`healingVerdicts.ts`)都是用户签字册**:新条目必须有用户签过的裁定,不能代签;碰到就改走不需要签字的路径。治疗裁定册的由来:系统此前**没有**「加血大技能」这个归类。

## 反事实

`packages/analysis/src/utils/counterfactual.ts` 单源(10 s 窗、三档谓词);decisive 只在「几乎必真」时开口。时序重排反事实永久不做。

## 救人 CD 名单

判据与生成方式见 [signal-research-conclusions.md](signal-research-conclusions.md)。

相关:[whitelist-rot.md](whitelist-rot.md)、[coaching-rulings.md](coaching-rulings.md)
