# UI backlog #6–#11 细化研究(2026-07-17)

> 对 `app-feature-backlog.md` #6–#11 的代码级核实 + 设计决策记录。
> 每项先列**研究发现**(在两个仓里实际查证的事实,含反转 backlog 原假设的),
> 再列**设计决策**(有真选择的给选项和推荐)。实施时以本文为准,backlog 条目为索引。

## 横切发现(先读这个,三条都反转/修正了 backlog 里的架构假设)

1. **renderer 已经在 import `@gladlog/analysis`** —— `report/derive/casts.ts` 用
   `SPELL_CATEGORIES`,`UnitPanel.tsx` 用 `getTalentNames`(package.json dependencies
   只列 parser,走 workspace 解析 + Vite 打包,既成模式)。所以正确的架构规则不是
   「renderer 不能碰 analysis」,而是:**纯数据/纯函数 export(SPELL_CATEGORIES、
   名字表、图标表)renderer 可直接 import;吃 unit 结构的分析函数**(签名是
   parser-compat 旧 shape,renderer 的 doc 是新 parser shape)**必须 main 侧算完
   过 IPC**。谓词共享规则照旧:两侧都不许复制常量。
2. **#8 的证据链跳转已经存在一半**:findings JSON 就是结构化的
   `RawFinding{ eventIds, severity, category, title, explanation }`,事件菜单是
   `CandidateEvent{ id, type, t(秒), unitNames, spell?, facts }`
   (`analysis/src/analysis/types.ts`);`FindingsList` 已有 Evidence 按钮 →
   `activeEventIds` → `TimelineStrip`(24px 条,可点标记,title 带 `t`)。
   **缺的只是跨视图**:strip/Evidence → 切回放 + seek + 泳道高亮。工作量比
   backlog 预估小一半。
3. **#9 的真实成本是数据不是 UI**:图标管线已通(bridge → main `iconCache` →
   `wow.zamimg.com/icons/large/<iconName>.jpg`,磁盘缓存 + dataURL 返回),但
   **全仓不存在 spellId→iconName 映射** —— 现在只有天赋有 icon 名
   (`talentNames.ts`),UnitPanel 里 `t.icon` 是天赋不是技能;技能处 SpellIcon
   永远走首字母 fallback。#9 blocked on 一张挖掘表(走 update-wow-data /
   game-data pipeline,同 spellEffectGenerated 模式)。

## #6 死亡回顾 Death Recap

**研究发现**

- analysis 有 `deathOutcomeAnalysis.ts`(死亡时刻免疫技可用性判定,含 CDR/reset
  机制、LoS/距离谓词),prompt 侧死亡叙事在 `matchTimeline.ts` / death-trace 门规
  谓词已审计(0/3733)。recap 不需要发明任何判定,全部现成。
- 渲染测试 fixture `real-match-sample.json` **含 1 次死亡** —— dev:ui 可直接测。
- main 侧已有按场缓存模式:`analysis.ts` 的 `<matchesDir>/<matchId>/analysis.json`。

**设计决策**

- **计算位置**:main IPC(`report:deathRecap(matchId)`),内部 parser-compat 转换
  后走 analysis 谓词。(备选:renderer 从新 doc 现算 —— 否决,会诞生第二套死亡
  谓词,就是审计里的双谓词病。)
- **输出 shape**(v1,够用为准):
  ```ts
  interface DeathRecap {
    unitId: string;
    unitName: string;
    deathT: number; // ms
    events: Array<{
      t: number;
      kind: "dmg" | "heal" | "cc" | "def_used";
      spell: string;
      amount?: number;
      srcName: string;
    }>; // 死前 10s
    healerState: { name: string; ccdBy?: string; casting?: string } | null;
    defensivesUnused: string[]; // 可用而未按(deathOutcomeAnalysis 判定)
  }
  ```
- **UI 落点**:右侧抽屉卡(overlay),不占常驻布局 —— 战报视图点 `Timeline` 死亡
  标记打开;回放视图阵亡 ✕ 也可开(v2)。卡底「回放此刻」→ `setView("replay")` +
  seek(deathT − 8s)(seek 机制见 #8,两项共用)。
- **不缓存**:recap 计算是毫秒级,按需算,不落盘。
- **测试**:main 单测(fixture 那次死亡断言 defensivesUnused)+ dev:ui 手测。

## #7 对局列表富行

**研究发现**

- meta 在 `MatchStore.store()` 铸造,**彼时完整 GladMatch 在手**(units 带
  spec/class/rating —— `deriveRoster` 就是从同一 doc 取的)→ 加字段零额外 IO。
- 索引 = JSONL 追加 + 逐目录 `meta.json` 兜底重建路径已存在(`init()` 里)。
- zone 名:`ARENA_MAPS` 有 15 张图的包围盒但**名字只在注释里**;旧仓
  `zoneMetadata.ts` 是 17 条 `{id, name, ...}` 全表,名字直接搬。
- spec 图标:旧仓 `CombatStubList/bits.tsx` 的 `TeamSpecs`→`PlayerIcon` 用
  specId→zamimg 图标名静态表 —— 表可搬,加载走现成 iconCache(和 #9 同管线,
  但 spec 表只有几十行,**不等 #9 的挖掘管线,先行**)。

**设计决策**

- **meta 新字段(全 optional)**:`durationS: number`、`avgRating?: number`
  (己方队均)、`teams?: [Array<{specId: string}>, Array<{specId: string}>]`
  (只存 specId,渲染时查表;不存名字/rating 明细,行内用不上)。
- **旧数据兼容**:渲染回退(无 teams → 现纯文本样式);**不做自动迁移**——
  DevPanel 加「重建索引」按钮(读各目录 match.json 重铸 meta,一次性、用户主动)。
  (备选:init 时自动迁移 —— 否决,启动 IO 风暴不可控。)
- **行布局**:两行 —— 上行 胜负色条 + 地图名 + 时长 + 评分 badge;下行
  己方 spec 图标组 vs 敌方组。shuffle 行 kind badge 保留。
- **测试**:`App.pagination.test.tsx` 旁补缺字段回退断言 + store() 新字段单测。

## #8 证据链跳转 + KILL WINDOW/VULNERABLE 标注

**研究发现**

- 见横切发现 2:AI 视图内闭环已通,`CandidateEvent.t` 是秒,`unitNames` 是名字
  数组(不是 unitId —— 跨视图高亮要做 name→unitId 匹配,ReportSource 单位有名字,
  场内重名概率忽略)。
- **回放时钟 `t` 是 `ReplayView` 的局部 state**(`useState(startTime)`,连同
  playing/speed/selUnits),不在 `MatchReport`;视图切换状态 `view` 在 MatchReport。
- KILL WINDOW 数据:main 已 import analysis(`analysis.ts` 构建 prompt 时同一
  转换管线),`computeOffensiveWindows` 输出 `bursts` + span,2026-07-17 重设计后
  span 短而诚实(p50 14s)。

**设计决策**

- **seek 机制**:`MatchReport` 持 `seekReq: { t: number; nonce: number } | null`,
  传给 `ReplayView`,其 `useEffect` 按 nonce 消费(setT + 暂停)。
  (备选:把整个播放时钟提升到 MatchReport —— 否决,热路径 state 提升会让
  三视图全部随 tick 重渲。)
- **入口**:(a) `TimelineStrip` 标记 active 态加「跳到回放」小按钮;(b) findings
  卡的 Evidence 点击后同位置出现同按钮。点击 → `setView("replay")` + seek(t) +
  `setSelUnits(由 unitNames 匹配)`。
- **泳道高亮**:`GcdSwimlane` 收可选 `flashT?: number`,渲染时对 |chip.t − flashT|
  < 2s 的 chip 加 flash 类,几秒后淡出(纯 CSS animation,不加状态机)。
- **窗口色带**:main IPC `report:windows(matchId)` →
  `{ vulnSpans: [{from,to,targetName}], bursts: [{from,to,targetName,damage}] }`
  (main 用 `computeOffensiveWindows`/`KW_*` 算好,renderer 只画);画在
  **回放 scrubber**(主)+ TimelineStrip 背景(次)。burst=金色半透明,
  vulnerable=灰红;hover title 带 target + 团伤。
- **测试**:seek nonce 消费单测;fixture 上 Evidence→回放跳转集成测试(dev:ui)。

## #9 GCD 泳道技能图标

**研究发现**

- 见横切发现 3:管线通、映射缺。`CastRow`/`UnitEvent` 无 icon 字段;iconCache
  按 icon 名取 zamimg,有磁盘缓存 + 失败集 + fetch 上限。

**设计决策**

- **前置数据项**:`update-wow-data` 管线加产物 `spellIconsGenerated.ts`
  (spellId→iconName)。范围控制:SPELL_CATEGORIES 全部 id + 语料 top-N 施法 id
  (N 取渲染需要,预计数百行,不追求全量 DB)。这是 #9 的第一个 PR,UI 是第二个。
- **渲染**:`deriveCasts` 补 `icon?: string`(查生成表);`GcdSwimlane` chip 宽度
  ≥ 阈值渲染 icon+名,否则 icon-only;`SpellIcon` 的首字母 fallback 保底缺表项。
- **性能**:renderer 侧 memo `Map<iconName, Promise<dataURL>>`(bridge 已有磁盘
  缓存,这层防的是同名几百次 IPC round-trip)。
- **测试**:泳道渲染测试补「无 icon 名 → 首字母块」断言。

## #10 统计表(打断/控制/驱散)

**研究发现**

- 判定全在 analysis(interrupts 分类——2026-07-17 刚补 7 个 id、CC 时长逻辑
  `ccSecondsInWindow` 模式、`dispelAnalysis`),签名都是旧 unit shape → main 侧。

**设计决策**

- **IPC**:`report:statsTable(matchId)` → 每玩家一行
  `{ unitId, kicksDone, kicksTaken, ccTakenS, ccTakenPct, ccDoneS, dispels, purges }`
  (含 /min 由 renderer 算,别在两处存冗余)。
- **UI 落点**:`Meters` 卡榜单模式段控(伤害/治疗/承伤)加第四项「统计」,切换时
  整卡换 `StatsTable.tsx`;列结构照抄旧仓 `CombatCC` 那张表(53 行,已验证的信息
  密度)+ 驱散列。
- **明细展开推迟 v2**(行点开该玩家打断/被控明细,时间戳接 #8 seek)。
- **测试**:IPC 表单测(fixture 断言打断行数值)。

## #11 回放三小件

**研究发现**

- **(a) dampening**:`getDampeningPercentage(bracket, units, ts)` 在
  `analysis/utils/dampening.ts`,吃旧 unit shape → 不能 renderer 直调。它是 prompt
  渲染值(门规相邻)→ 谓词共享要求单一来源。
- **(b) 施法条**:**parser src 无 SPELL_CAST_START** —— 新 doc 的 casts 只有
  SUCCESS。真施法条(进行中读条)**做不了**,需 parser L2 先吐 cast-start 事件。
- **(c) HP 数字**:回放插值采样已有(replay.ts 的 samples 带 hp),纯渲染。

**设计决策**

- **(a)**:main IPC `report:dampening(matchId)` → 1s 网格序列 `[{t, pct}]`,
  renderer 控件条角落显示当前值(播放时钟查最近点)。不在 renderer 重推 aura
  stack(第二套谓词禁令)。
- **(b) 降级或推迟**:v1 用 SUCCESS 事件做「施法闪现」(cast 瞬间单位头顶 icon
  flash 1s)—— 有信息量、零 parser 改动;真读条条 = parser spike 单列(吐
  SPELL_CAST_START/STOP 进 doc,评估体积),**不阻塞本项**。
- **(c)**:直接做,血条旁 9px 等宽 HP%。

## 实施结果(2026-07-17,全部完成)

#7 `8772f4f` → #8 `60d9707`+`b825184` → #6 `3501c76` → #9 `b2fc00f` →
#10 `f32a4d2` → #11 `c03731f`。**与设计的一处偏离**:#6/#10/#11a 定的
「main 算好 → IPC」改为 renderer derive 直调 analysis(toLegacySafe 垫片
+ StructuredAnalysisPanel 先例)——谓词仍单一来源,少一层 IPC 面;垫片
顺带修好裁剪 fixture 下 analysis 派生 UI 静默消失的问题。#11b 施法条
确认做不了(parser 无 SPELL_CAST_START),降级为施法闪现,真读条 spike
单列。

## 实施顺序(研究后修订)

1. **#7 富行**(全独立,半天级)
2. **#8 seek 机制 + 窗口色带**(提前:比预想小,且 #6 的「回放此刻」依赖 seek)
3. **#6 死亡回顾**(复用 #8 的 seek)
4. **#9 数据 PR(spellIconsGenerated)→ UI PR**
5. **#10 统计表**
6. **#11c HP 数字(顺手)→ #11a dampening → #11b 施法闪现**

依赖关系:#6 依赖 #8 的 seek;#9 UI 依赖其数据 PR;其余独立。
