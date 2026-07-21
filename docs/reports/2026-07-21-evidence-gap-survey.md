# 证据缺口普查(2026-07-21)

**缘起**:用户反馈「基本没啥 evidence,很多被 gate 或者丢弃了」。本文把这个印象变成数字。

**语料**:`manifest-fullscale`,**1245 场,100% 治疗视角**(Mistweaver 334 / Disc 263 /
Preservation 181 / Resto Shaman 161 / Holy Priest 119 / Holy Paladin 97 / Resto Druid 90),
run `2026-07-20-postfix-anchor` @ `92f96d2`。

**方法警告(重要)**:按猜的字符串量段落覆盖率,**五次里错了五次**(详见 §4)。本文所有
数字要么核对过 emitter 源码里的字面量,要么从语料里反向提取。**接手时请沿用这个纪律。**

---

## 1. 真的缺证据(按影响排序)

| 缺口                              | 覆盖                | 根因         |
| --------------------------------- | ------------------- | ------------ |
| 敌方大冷却 `none tracked`         | **805 / 1245(65%)** | **已定位** ↓ |
| trinket 状态 `never observed`     | 1094 / 1245(88%)    | 未查         |
| `[MISSED PURGE OPPORTUNITY]` 为空 | 954 / 1245(77%)     | 未查         |
| `[CONTESTED]` 为空                | 1069 / 1245(86%)    | 未查         |
| `POSITIONING` 段缺失              | 429 / 1245(34%)     | 未查         |

### P1 —— 敌方冷却的不对称(根因已定位,机器现成)

```
友方:classMetadata 枚举整套技能组 → 没放过的标 [UNUSED]
      cooldowns.ts:514  classMetadata.find(c => c.unitClass === unit.class)
      cooldowns.ts:774  neverUsed: casts.length === 0

敌方:只列这一场真的放过的;一次没放 → 整个从名单消失 → "none tracked"
      enemyCDs.ts:115   for (const cast of enemy.spellCastEvents)   ← 纯观察驱动
      enemyCDs.ts:152   if (offensiveCDs.length > 0)                ← 空则丢弃整个玩家
      resourceSnapshot.ts:141-154  兜底打印 "none tracked"
```

友方长这样:

```
<cooldowns>Divine Shield [270s], Blessing of Protection [285s] [UNUSED],
           Blessing of Spellwarding [165s] [UNUSED], Avenging Wrath [116s, 2 Charges], ...
```

敌方长这样:

```
<cooldowns>none tracked</cooldowns>
```

**为什么这条最要紧**:对治疗教练,敌方最有价值的信息就是**「他还有什么没交」**。现在教练
能说「你的 Guardian Spirit 存着没用」,却说不出「他的 Trueshot 还在手上」—— 而后者才是
决定下一个窗口怎么打的那半。

**证据链闭合**:今晚 n=10 校准里,多个独立判官给 `sufficiency` 打 3 分,理由几乎一模一样
——「3 个敌人里 2 个 none tracked」。我当时把它记成**判官的观察**,没往上游追。它其实是
**产品的证据缺口**,被判官正确地抓到了。

**修法**:对称化 —— 敌方也走 `classMetadata` 枚举 Offensive 标签的技能,没观察到施放的
标 `[UNUSED]`。不需要新数据源,`enemy.spec` / `enemy.class` 就在同一行上。

**已知限制**:`classMetadata` 按**职业**而非专精索引,所以会列出该职业全部主 CD,包含
该专精可能没天赋的。友方现在就是这个精度,不是新问题,但值得在实现时决定要不要收窄。

---

## 2. 被截断(上限真的在切材料)

| 上限                    | 值  | 命中上限的场次      |
| ----------------------- | --- | ------------------- |
| `MAX_KILL_WINDOW_LINES` | 6   | **264 / 1245(21%)** |
| `MAX_CONTESTED_FACTS`   | 2   | 28                  |

`[KILL WINDOW]` 在五分之一的场次里**恰好卡在 6**,最大值就是 6 —— 说明有东西被砍掉了,
但砍掉的是不是有价值的,需要看一眼被丢的那部分再判。

另有 6 处硬编码截断未逐一核实影响面:

```
timelineHelpers.ts:878      .slice(0, 2)
candidateFindings.ts:409    .slice(0, 2)
criticalMoments.ts:790      .slice(0, 5)
crisisEvents.ts:42          .slice(0, 3)
buildExemplarLedPrompt.ts:15 .slice(0, 8)
dispelAnalysis.ts:1254      .slice(0, 8)
```

---

## 3. 被折叠

`[MINOR DISPELS] ... (low-priority, folded)` —— **5079 行,1238 / 1245 场(99%)**。
`matchTimeline.ts:1868-1925`:F163 滤掉的 low/medium 驱散不逐条上时间轴,按
(来源, 驱散法术) 折叠成一行。

**判断前需要看**:折叠掉的到底是什么。如果全是无关紧要的小驱散,折叠是对的(它本来就是
为了降噪);如果里面混着可教的漏驱散,那就是在丢证据。**本次未展开。**

---

## 4. 看起来坏了、其实没坏(别去追)

普查中五次差点报错东西,全部靠核对数字/源码拦下。逐条记下来省得下一个人重走:

| 现象                                                                                             | 看起来            | 实际                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MISSED PUSH` 0/1245                                                                             | 死特性            | **DPS 定位检测器跑在纯治疗语料上** —— 要求「你有进攻 CD 可用却脱离」,治疗基本不具备触发条件                               |
| `OFFENSIVE CD OUT OF RANGE` 0/1245                                                               | 死特性            | 同上                                                                                                                      |
| rotScan 的 `SPELL_DISPEL` 列报 69 个未归类,含 `Purify`/`Dispel Magic`/`Greater Purge` 等核心驱散 | 白名单大面积腐烂  | **扫错了目录** —— `dispelAnalysis.ts` 用的是**按专精的驱散能力表**(谁能驱什么类型),不走 `SPELL_CATEGORIES` 的法术 id 查表 |
| rotScan 的 `SPELL_AURA_APPLIED` 列报 386 个未归类                                                | CC 目录大面积腐烂 | 榜首是 `Flame Shock` 5765 次、`Judgment` 5326 次 —— **DoT/debuff 本来就不该进 CC 目录**;需逐 id 人工过才知道有没有真缺口  |
| `KILL SEQUENCE` 0/1245                                                                           | 段落从不出现      | **我的搜索串加了方括号**;真实表头是 `KILL SEQUENCE`(`timelineHelpers.ts:911`),实际 250/1245                               |

**教训**:段落覆盖率必须从**语料反向提取**或**核对 emitter 字面量**,不能按记忆猜。
本文 §1–§3 的数字都是这么来的。

---

## 5. 段落覆盖率(从语料反向提取的顶格标题)

```
MATCH TIMELINE               1245/1245  100%
PURGE RESPONSIBILITY         1245/1245  100%
MATCH FACTS                  1245/1245  100%
KILL SEQUENCE                 250/1245   20%
DEATHS WITH MISSED OPTIONS    165/1245   13%
ABILITIES INTO IMMUNITY/DR    112/1245    9%
```

低覆盖的三个不一定是缺陷 —— `DEATHS WITH MISSED OPTIONS` 只在「有人死且当时有可用
救人手段」时才出现,13% 可能就是真实发生率。**需要与 oracle 对照才能判**,本次未做。

---

## 6. 没查的(留给下一轮)

- **finding 级的门**:`candidateFindings.ts` 有 22 处 `filter`/`return []`/`continue`,
  生成了多少候选、活下来多少,没有量过。要量需要插桩。
- **目录静默漏失**:`spellEffectData` / `isOffensiveSpell` 查不到就 `continue`
  (`enemyCDs.ts:119-121`),漏多少无声无息。rotScan 不适合测这个(见 §4)。
- **`MIN_CD_SECONDS = 30` / `MAX_CD_SECONDS = 360`** 把多少真 CD 挡在外面。
- §3 折叠内容的抽样审阅。

---

## 6.5 逐项处理结果(2026-07-21 夜,按「一个一个修」推进)

### P1 敌方技能组 —— ✅ 已修并上线(`bf17ccf`)

| 判据                     | 修前            | 修后           |
| ------------------------ | --------------- | -------------- |
| 含 `none tracked` 的场次 | 805 / 1245(65%) | **1 / 1245**   |
| 敌方技能条目 丢失 / 新增 | —               | **0 / +15073** |
| token p50                | 6486            | 6553(+1%)      |

Layer A 三道门复跑全绿。**中途做错一次**:首版直接替换而非并集,丢了 1418 条进攻爆发
CD(`Frozen Orb` 203、`Army of the Dead` 109、`Shadow Dance` 84…),是逐条对照**内容**
才发现的 —— 只看 `972 → 1` 那个漂亮数字会带着隐形回归上线。

### P2 `[KILL WINDOW]` 上限 —— ❌ 不用改

264 场卡满上限,其中 235 场真有省略,共省略 595 个窗口 —— **全部有聚合 rollup 兜底**:

```
[+N more windows omitted (least free time): your damage Xk total, CC cast in M of N]
```

保留规则是按 `ownerFreeSeconds` 降序(空闲最多 = 最可教),中位数只省略 2 个。
上限设计合理,**不是静默丢证据**。

### P3 trinket `never observed` 88% —— ⚠️ 根因已定位,**但修法是产品决定,未动**

排除了两个假设:

- **不是目录缺口** —— 实测 228 名玩家 100% 是 Gladiator(`336126`),而它本来就在
  `PVP_TRINKET_SPELL_IDS` 里。(`getTrinketStateAtTime` 确实漏了 Adaptation `195756`
  和 Relentless 的「无主动饰品」语义,但语料里这两类占比为 0,不咬。)
- **不是缺证据** —— `[OPPORTUNITY]` 只在饰品**不可用或未知**时才发出;饰品可用时
  `killWindowTargetSelection` 主动 `continue` 跳过(可用 = 人家一交就出来,不算机会)。

**真根因是推断,而且又是 P1 那个不对称**:

```
友方(matchTimelineSections.ts):lastUse === undefined  →  可用
敌方(getTrinketStateAtTime)   :lastUseSeconds === null →  null(未知)
```

竞技场开局冷却重置,「本场没观察到使用」应当推出「饰品在手上」。若这个理解成立,
那些机会**根本不该报**。

**影响面 —— 这就是没动的原因**:

```
[OPPORTUNITY] 总计 1491 行
  trinket on CD(有确证)      67 行
  state unknown(靠未知支撑) 1424 行  = 95.5%
```

修这个推断会**删掉整段的 95%**。方向与「证据太少」的诉求相反,而且依据是我对竞技场
冷却重置机制的理解、不是代码里的事实 —— **这是产品判断,不是 bug 修复,留给人定**。

但也不能装作没事:若推断成立,那 1424 行是在**暗示一个并不存在的机会**,比缺证据更糟。
`[CONTESTED]` 同样受影响(unknown 151 / on CD 46 / available 7)。

### POSITIONING 缺失 34% —— ❌ 不是 bug,是覆盖边界

429 场无 POSITIONING 段,**其中 424 场有坐标派生的距离数据**(只有 5 场真无高级日志),
且**没有任何一场是「无爆发窗口」**。所以不是数据问题。

根因是 `CLOSE_RANGE_YARDS = 12`:STAYED_IN / KITED 只对**爆发开始时已在 12 码内**的
owner 分类。治疗打得好本来就该在 20–40 码,于是既不算「留在里面」也不算「拉开了」,
不产事件。

**这是正确行为,但「全程保持了距离」目前不被表述为任何东西** —— 要不要把它作为正面
证据说出来,是产品增强,不是修 bug。

### `[MISSED PURGE OPPORTUNITY]` 空 77% —— ✅ 修了确定的一半(`2f1954c`),另一半是产品决定

「77% 为空」这个数字本身是**误导性的**。拆开:

| 分类                       |    场次 | 性质                                          |
| -------------------------- | ------: | --------------------------------------------- |
| owner 自己没有进攻驱散工具 | **702** | B117 有意门掉,**正确** —— 只报 owner 能做的事 |
| owner 能驱散、有输出       |     288 | 正常                                          |
| owner 能驱散、白名单没命中 | **255** | ← 真缺口                                      |

所以真缺口是 255 场(20%),不是 954 场。

**根因是四道闸门,第四道最紧,而且是坏的。** 一条漏驱散要走到 prompt 得过:

```
① spellEffectData[id].dispelType === "Magic"      (DB2 挖掘 3560 条里只覆盖 123 条)
② SPELL_CATEGORIES[id].type → Critical/High       (未收录 → Low → 丢弃)
③ canOffensivePurge(owner)                        (B117,正确)
④ HIGH_VALUE_PURGEABLE_BUFFS.has(id)              (matchTimeline.ts:183 手写 9 条)
```

**逐条核这 9 条,7 条根本到不了发射端** —— ①② 会先把它们滤掉:

| 白名单条目                                                           | dispelType | 分类            | 能发出? |
| -------------------------------------------------------------------- | ---------- | --------------- | ------- |
| Power Infusion                                                       | Magic      | buffs_offensive | ✅      |
| Blessing of Protection                                               | Magic      | immunities      | ✅      |
| Blessing of Freedom                                                  | Magic      | **无**          | ❌      |
| Dark Soul ×2 / Combustion / Icy Veins / Temporal Shield / Alter Time | **无**     | 部分有          | ❌      |

这解释了全语料 1245 场只见过 Power Infusion 与 BoP 两种法术。**语料里看不出区别 ——
「没发生过」和「发不出来」长得一模一样**,靠读代码才抓到。

这就是 CLAUDE.md 那条规则的原型:**同一个事实(「这个增益可驱散且值得报」)被三份
清单各自断言,没有共享谓词**,分头腐烂而没有任何门规会响。

**已修**(`2f1954c`):Freedom / Sacrifice 的 `dispelType=Magic` 本来就来自 DB2(权威),
只缺分类标签,补上。10 日志 211 场样本 **103 → 205 行**,连带把 20 条 `[ENEMY PURGE]`
和 13 条 `[PURGE]` 从折叠汇总里提成一等公民,门规全绿。同时加
`matchTimeline.purgeWhitelist.test.ts`:白名单每条要么真能发、要么进豁免名单,
且豁免名单不许留已修好的 —— 静默腐烂变成测试失败。

**没修的**:剩 6 条缺 `dispelType` 数据本身。缺失 ≠ 不可驱散,只是 DB2 没挖到;
我没有权威依据判定 Combustion / Icy Veins 是否真能被驱散,**猜着补会造出假机会**,
比缺证据更糟。登记在 `PURGE_WHITELIST_DATA_BLOCKED` 等数据刷新。

**留给人定的**:要不要把常驻增益(HoT / 护盾)也纳入。实测扩到 Wild Growth /
Rejuvenation / Riptide / Enveloping Mist / Earth Shield 这一类:

```
211 场样本   103 → 892 行(8.7×),含该段场次 37 → 87
其中 59% 是常驻 HoT(Wild Growth 201、Enveloping Mist 112、Rejuv 82、Riptide 80、Lifebloom 52)
```

跟一个治疗说 201 次「你没驱散对面的回春」不是证据是噪声 —— B117 当初就是为压这个写的。
但也有几条明显该进而没进的**离散主动 CD**:Blessing of Sanctuary、Innervate、
Nether Ward、Time Stop、Tip the Scales、Nature's Swiftness、Spiritwalker's Grace。
**这是策展判断,不代做。**

### `[CONTESTED]` 空 86% —— 与 P3 同根,一并留给人定

unknown 151 / on CD 46 / available 7 —— 同一个 `getTrinketStateAtTime` 返回 `null` 的
不对称。P3 怎么定这里就怎么定。

### 折叠的 5079 行小驱散 —— ⚠️ 里面 26% 是打得好的证据

展开 1238 场的折叠内容,8696 个条目:

| 类别                                               |     条目 |    占比 |
| -------------------------------------------------- | -------: | ------: |
| **我方完成的进攻驱散**                             | **2262** | **26%** |
| 位移/变形自带解控(Phantasm、Disengage、Bear Form…) |     1865 |     21% |
| 其余(低优先级防守净化等)                           |     4569 |     53% |

后两类折叠是对的。但第一类 —— Dispel Magic 493、Greater Purge 465、Spellsteal 424、
Tranquilizing Shot 353、Consume Magic 349 —— 是**队伍真的把敌方增益摘掉了**,却因为
被摘的那个增益不在目录里而判成 low-priority、折进汇总行。

**所以目录太薄不只是漏报机会,连打得好的证据一起丢。** 这一条与上面的策展决定同源:
目录一旦补齐,这些会自动升为一等公民(`2f1954c` 已经能看到 33 条这样的提升)。

---

## 7. 建议顺序

1. **P1 敌方冷却对称化** —— 覆盖 65% 的场次,根因清楚,机器现成,单一改动可单独量前后
   数字(`none tracked` 行数 → 0)。
2. **P2 `[KILL WINDOW]` 上限** —— 先看被砍掉的第 7 条起是什么,再决定是抬上限还是换排序。
3. **P3 trinket `never observed` 88%** —— 对治疗来说 trinket 是最关键的 CC 反制,状态未知
   等于这一整块没法教。
4. 其余按 §6 逐个展开。

**注意耦合**:任何改动都会变动每一份 prompt,今晚 Layer A 的三道门数字与校准基线都是在
当前形态上测的。Layer A 三道门重跑便宜(全自动),校准贵(80 件)。建议 P1 落地后先重跑
Layer A 确认没引入新违规,校准留到 `HANDOFF-2026-07-20-judge-variance.md` 那条线收口后一起做。
