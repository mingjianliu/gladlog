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
