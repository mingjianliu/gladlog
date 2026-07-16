# App 功能 backlog

> 桌面 App 侧的功能需求(区别于 prompt 质量类改动,不走 /eval-ab;UI/交互改动直接实现 + 常规测试)。

## 1. AI 分析语言切换(中文 / English)⬜(用户提出 2026-07-11)

**需求**:在 AI 分析生成处(AIAnalysisPanel 的"分析"按钮旁)加一个语言切换按钮,可选中文或英文,控制教练回复的输出语言。

**实现要点(盘点自现状)**:

- **UI**:`packages/desktop/src/renderer/src/report/components/AIAnalysisPanel.tsx` — 生成按钮旁加 中文/EN 二态切换;选择持久化。
- **设置**:`packages/desktop/src/main/settingsStore.ts` 加 `aiLanguage: "zh" | "en"`(默认 `"zh"`,与现有 UI 中文一致);IPC 走既有 settings 通道。
- **请求**:`packages/desktop/src/main/ai.ts` 的 stream 调用**目前没有 system prompt**(messages 只有 user)——加 `system` 字段:教练角色设定 + 输出语言指令("Respond entirely in Simplified Chinese" / "Respond in English")。这同时是把 responder 角色提示词固化进产线的机会(eval responder 模板可对齐)。
- **缓存**:每场缓存是单文件 `<matchesDir>/<matchId>/analysis.json`,doc 里需加 `language` 字段;`getCached` 匹配当前语言不符时视为未命中(或文件名分键 `analysis.<lang>.json`,可同时保留两种语言的结果——推荐后者)。
- **注意**:语言属请求参数而非 prompt 构建器改动,`PROMPT_VERSION` 不需要 bump;时间轴 prompt 本体保持英文结构(spell 名中英混排问题单列,见 #2)。

## 2. 时间轴 spell 名统一(机会项,随 #1 顺带评估)⬜

中文客户端日志的时间轴里技能名中英混排(妖术/分筋错骨 vs Hammer of Justice)。`getEnglishSpellName` 已能把大部分名字转英文;可评估:prompt 全英文化(对模型更稳)+ 回复语言由 #1 控制。属 prompt 构建器改动,若做需走 /eval-ab(目标维度 accuracy)。

> 注(2026-07-13):下面 #3/#4/#5 的**最终形态经过整体重设计**(顶层段控 tab、
> 删单位侧栏、竞技场重绘 + 真实地图、GCD 泳道、AI 双栏等)。现状见
> [`2026-07-13-report-ui-current-state.md`](./2026-07-13-report-ui-current-state.md)。

## 3. AI 分析拆成独立 Tab(脱离右侧窄栏)✅(2026-07-12 实现,branch `worktree-report-ui-backlog`)

**需求**:AI 分析现在挤在右侧 `rpt-side` 侧栏里,当作 `sideTab` 的一个二态(单位详情 / AI 分析)。文本量大时太窄。要把 AI 分析提升为顶层的独立 Tab,给足横向空间。

**现状**:`packages/desktop/src/renderer/src/report/components/MatchReport.tsx` —— 布局是 `rpt-body` 里 `rpt-main`(伤害/治疗/承伤 meter + 时间轴)+ `rpt-side`(`SideTab = "unit" | "ai"`,窄 aside)。`ai` 分支渲染 `StructuredAnalysisPanel` + `ProComparisonVerified`。

**实现要点**:

- **顶层 Tab 结构**:在 `MatchReport` 顶部(`ReportHeader` 下)加一层视图切换 —— 例如 `View = "report" | "ai"`(甚至预留 `"replay"`,见 #5)。`report` 视图保留现有 main+side 布局但 side 只剩「单位详情」;`ai` 视图用**整幅宽度**渲染 `StructuredAnalysisPanel` + `ProComparisonVerified`。
- **退化 SideTab**:AI 移出后 `rpt-side` 不再需要 `unit/ai` 二态切换,`SIDE_TAB_LABEL` / `sideTab` 状态可删或改成纯「单位详情」标题;注意 #4 会给单位详情加自己的玩家筛选控件。
- **CSS**:`rpt-side` 是固定窄列;AI 全宽视图需要一套新容器样式(可复用 `rpt-main` 的宽度或新建 `rpt-ai-full`),让结构化分析的长文本、对比表能铺开。
- **状态保持**:切 Tab 不应丢失已生成的分析(缓存在 `<matchesDir>/<matchId>/analysis.json`,本就是持久化的,组件重挂载会重新命中缓存,确认无重复请求)。

## 4. 单位详情增强:合并施法+重要光环 & 玩家筛选 ✅(2026-07-12 实现;重要=`@gladlog/analysis` SPELL_CATEGORIES 内)

**需求**:侧栏「单位详情」概念好但当前不够用 —— (1) 施法(`施法`)和重要光环(`光环事件`)是两张分离的表,应合并成一条按时间排序的统一事件流,且光环要**只留重要的**(防御 CD、控制、大增益),而不是全量 aura 噪声;(2) 面板被时间轴点击选中的单一 `unitId` 驱动,应允许用户在面板内直接**按玩家筛选/切换**。

**现状**:`packages/desktop/src/renderer/src/report/components/UnitPanel.tsx` —— 分别调 `deriveCasts` 和 `deriveAuraEvents`(`report/derive/casts.ts`),渲染两张独立 `<table>`。`AuraRow.auraType` 只有 `"BUFF" | "DEBUFF"`,没有「重要性」维度。单位由 `MatchReport` 的 `unitId` 传入,面板自身无选择控件。

**实现要点**:

- **合并事件流**:新建一个 derive(如 `deriveUnitTimeline`)把 `CastRow` 与筛后的 `AuraRow` 合成 `{ t, kind: "cast" | "aura", ... }[]` 并按 `t` 排序;UnitPanel 渲染单张表,施法/光环用图标或列区分。
- **重要光环白名单**:目前无「重要」判定 —— 需要一份重要 aura 的 spellId 白名单(防御/免疫/控制/爆发增益),或按类别推断。可放进 `report/data/` 旁的常量,先覆盖高价值技能,后续扩。这是本项主要工作量。
- **玩家筛选控件**:UnitPanel 内加一个玩家下拉(数据源 `source.units`,可按 `deriveSummary` 顺序或队伍分组),`onChange` 回 `setUnitId` —— 与时间轴点击共用同一 `unitId` 状态,两处联动。
- **注意**:与 #3 相关 —— AI 移出侧栏后单位详情独占 side,有空间放筛选控件和更宽的合并表。

## 5. 回放 Tab(2D 模拟)✅(2026-07-12 v1 实现;坐标可行——advancedSamples 带 x/y/hp,做真实走位插值)

**需求**:缺一个「回放」Tab —— 把这场比赛做成 2D 俯视模拟,随时间轴推进重演单位位置、施法、死亡等,便于直观复盘。

**实现要点(需先探明数据可行性)**:

- **数据前提**:2D 回放需要**位置坐标**。先确认解析后的事件是否带坐标(WoW combat log 的部分事件含 `x/y/facing`,但覆盖不全、精度有限)。若坐标稀疏,回放可能退化成「事件时间线动画」而非精确走位 —— 需先在 `packages/desktop/src/renderer/src/report/derive/` 与底层 parser 里核实字段可得性,这是本项的最大不确定点。
- **落点**:作为 #3 引入的顶层 `View` 的第三个值 `"replay"`,与报告/AI 平级。
- **渲染**:一个随时间轴 scrub 的 canvas/SVG 俯视图 —— 单位为点、阵营着色、施法/控制/死亡以标记或高亮表示;复用现有 `deriveTimeline` 的事件序列做时间驱动。
- **范围**:体量最大、最不确定的一项,建议先做 spike 验证坐标数据,再决定是精确走位还是事件动画。

---

> 下面 #6–#11 来自 2026-07-17 与旧仓 wowarenalogs UI 的逐项对比(`~/code/wowarenalogs/packages/shared/src/components/CombatReport/` 15 个 tab 逐个过)。
> 结论:三视图段控结构**优于**旧仓 15 平铺 tab,保持不动;缺的是旧仓已验证有用的**内容**,以及新仓独有的**证据链跳转**机会。
> 通用架构事实(实现前先记住):renderer 只依赖 `@gladlog/parser`(新 parser doc,`u.deaths`/advanced 采样带 x/y/hp);**main 进程已依赖 `@gladlog/analysis`**(`src/main/analysis.ts` 构建 findings prompt)。所以凡是要用 analysis 谓词/白名单的功能,首选「main 算好 → IPC 给 renderer」,不要在 renderer 重抄常量(门规谓词即规范)。
>
> **2026-07-17 细化研究**:代码级核实 + 每项设计决策见
> [`2026-07-17-ui-backlog-research.md`](./2026-07-17-ui-backlog-research.md)——
> 其中三条横切发现**修正了本节的架构假设**(renderer 其实已 import analysis 纯数据
> export;#8 证据链在 AI 视图内已存在一半;#9 卡在 spellId→icon 映射这张数据表上),
> 实施以研究文档为准。实施顺序也修订为 #7→#8→#6→#9→#10→#11。

## 6. 死亡回顾 Death Recap ✅(2026-07-17 实现 `3501c76`:点死亡标记 → 死前 10s 事件流 + 可用未按保命 + 回放此刻;覆盖双方死亡;renderer derive 消费 analysis 谓词——研究文档定的 IPC 方案改为渲染层直调,因 StructuredAnalysisPanel 先例)

**需求**:竞技场复盘工具的第一用例。点 HP 曲线上的死亡标记(或战报视图新增「死亡」列表)→ 打开该次死亡的回顾面板:死前 ~10s 的承伤事件流、治疗在干嘛(被控/在读条/在跑位)、死者自己的防御 CD 用没用(可用而未按 = 高亮)、附「跳到回放该时刻」按钮。

**旧仓对应**:`CombatDeathReports/index.tsx`(128 行)——按死亡数排序选玩家、每次死亡一个 `CombatUnitTimelineView`、"only show CC" 过滤;好用但只是事件罗列。

**新仓的差异化机会**:analysis 包有**审计过的 death-trace**(全量审计 0/3733 违规的那条门规)——死亡回顾不该重新发明事件筛选,应复用同一谓词链。

**实现要点**:

- **数据**:main 进程新增 IPC(如 `report:deathRecap(matchId)`),内部走 `@gladlog/analysis` 的 death-trace 路径(`parser-compat` 转换已在 main 侧可用),输出结构化 recap:`{ unitId, deathT, events: [{t, kind: dmg|heal|cc|def_used|def_available, ...}], healerState, defensivesUnused }`。**不要**在 renderer 从新 parser doc 手搓一份"差不多"的筛选——那就是审计里反复出现的双谓词病。
- **入口 UI**:`Timeline.tsx` 死亡标记 onClick → 打开 recap 抽屉/卡片(新组件 `DeathRecap.tsx`);战报视图 Meters 卡下方可加一行死亡摘要 chips(死者名 + 时间,点击同源)。
- **跳转**:recap 内「回放此刻」→ 切到回放视图并 `setT(deathT - 8s)`(播放时钟已是共享 state:`t/playing/speed/selUnits`)。
- **测试**:`dev:ui` 测试台真实 fixture(`real-match-sample.json` 裁前 90s 内有死亡吗?若无,换/补一份含死亡的匿名 fixture)+ recap IPC 的单测(死者防御 CD 可用性断言)。

## 7. 对局列表富行 ✅(2026-07-17 实现 `8772f4f`:胜负/地图/时长/评分 + 双方 spec 图标;旧行回退 + DevPanel 重建索引回填)

**需求**:现在列表行是纯文本 `[kind] bracket · 时间 · result`。改成:双方**专精图标**(己方/敌方分组)、地图名、时长、场均评分 badge、胜负着色 —— 一眼扫过一晚的场次。

**旧仓对应**:`CombatStubList/rows.tsx` + `bits.tsx`(ResultBadge / RatingBadge / TeamSpecs / durationString / zoneMetadata)。

**实现要点**:

- **meta 扩展**:`src/main/matchStore.ts` 的 `StoredMatchMeta` 加可选字段:`durationS`、`zoneId`(已有)、`avgRating?`、`teams?: [{specId, classId}[], ...]`(两队专精,序列化成小数组,别塞全 roster)。索引是 JSONL 追加 + `meta.json` 兜底重建:**新字段一律 optional**,旧行渲染回退到现文本样式;或提供一次性 `rebuildIndex`(已有从 meta.json 重建的路径,加字段后跑一遍即可回填)。
- **专精图标**:渲染侧已有 `SpellIcon` 的 bridge 图标缓存机制(`b.icon.get(name)` → dataURL);spec 图标同路复用,需要 specId→icon 名映射(`report/data/gameConstants.ts` 旁新增;旧仓 `utils/images` 有对照表可抄)。
- **地图名**:旧仓 `data/zoneMetadata.ts` 有 zoneId→名字全表,直接搬(纯公开事实数据)。
- **UI**:`App.tsx` 列表 li 重排两行:上行 result 色条 + 地图 + 时长 + 评分,下行两组 spec 图标 vs 分隔。胜负染色沿用 `badge-*` 类。
- **测试**:`App.pagination.test.tsx` 旁补 meta 缺字段回退渲染的断言。

## 8. 证据链跳转 + KILL WINDOW/VULNERABLE 标注回放 ✅(2026-07-17 全部完成 `60d9707`+`b825184`:finding/strip「回放此刻」→ seek + 泳道闪金;scrubber + strip 窗口色带,金=burst 灰红=vulnerable)

**需求**:AI 分析的 findings 带经过验证的时间戳/事件 id —— 让每个时间戳**可点**:点击 → 切回放视图、seek 播放时钟到 t、GCD 泳道对应列高亮该时刻。把「信教练」变成「自己看」——这是全链路可验证方向在 UI 上的落点。顺带:把 `[KILL WINDOW]` burst 与 `[VULNERABLE]` 段画到回放 scrubber/TimelineStrip 上(2026-07-17 重设计后 span 已短而诚实,p50 14s,适合可视化)。

**实现要点**:

- **findings 时间戳解析**:`StructuredAnalysisPanel`/`FindingsList` 渲染的 findings JSON 里时间引用格式先盘点(`mm:ss` 文本 or 结构化字段);若只有文本,在 main 侧生成时补结构化 `refs: [{t, unitId?}]`(prompt 构建处有 event-id menu,数据在)。
- **跳转管线**:`MatchReport` 顶层已持有 view 状态 + 回放时钟;加一个 `seekTo(t, unitIds?)` 回调下传 AI 视图,点击 → `setView("replay")` + `setT(t)` + `setSelUnits(unitIds)`。
- **窗口标注**:main 侧对每场跑 `computeOffensiveWindows`(analysis 已依赖)→ IPC 给 renderer `{bursts, vulnSpans}`;`TimelineStrip.tsx`/回放 scrubber 画半透明色带(burst=金,vulnerable=灰红),hover 显示 target + 团伤。**常量不复制**:数据在 main 用 `KW_BURST_*`/`computeBurstSubWindows` 算好传结构,renderer 只画。
- **泳道高亮**:`GcdSwimlane` 加「t 附近 chip 高亮」态(光标已横贯,只需临时 flash 样式)。
- **测试**:seek 回调单测 + fixture 上点击 finding 跳转的集成测试(dev:ui)。

## 9. GCD 泳道 chip 技能图标 ✅(2026-07-17 实现 `b2fc00f`:genSpellIcons 挖掘表 3568 条(update-wow-data 加 6b 步)+ chip 真图标 + SpellIcon Promise memo)

**需求**:泳道 chip 现在只有技能名文本;图标扫读速度远快于文字(旧仓所有施法处都渲染 WoW 图标)。宽 chip = 图标+名,窄 chip(碰撞压缩时)= 仅图标,title 保持现状。

**实现要点**:

- `SpellIcon.tsx` 已存在(bridge 图标缓存 → dataURL,fallback 首字母),现仅 `UnitPanel` 用 —— 直接进 `GcdSwimlane.tsx` 的 chip 渲染。
- **spellId→icon 名映射**:盘点 `UnitPanel` 的 icon 名来源(derive 层哪个字段);若泳道的 cast 数据缺 icon 字段,在 `report/derive/casts.ts` 的 `deriveUnitTimeline` 补(数据源:新 parser doc 的 spell 信息或 `gameConstants` 旁新映射表)。
- **性能**:一场几百 chip,每个 SpellIcon 一次 bridge round-trip 会抖 —— bridge 侧已有缓存,renderer 侧再加内存 memo(同 icon 名只请求一次,Map<name, Promise<dataURL>>)。
- **测试**:泳道渲染测试补 icon fallback 断言(无 icon 名时仍出首字母块,不空洞)。

## 10. 数据统计视图:打断/控制/驱散表 ✅(2026-07-17 实现 `f32a4d2`:榜单第四模式「统计」,deriveStatsTable 全走 analysis 谓词;明细展开留 v2)

**需求**:每玩家一行的硬数据表:打断做/挨(次数与 /min)、被控总时长(秒和占比)、控制输出秒数、驱散/偷 buff 次数(治疗产品重点:你被控 34s / 全场 6:20 是标题级数字)。落点:战报视图 Meters 卡旁的第四张卡,或榜单模式段控加一项「统计」。

**旧仓对应**:`CombatCC/index.tsx`(53 行的表,列结构直接抄)+ `CombatDispels/index.tsx`(262 行,含驱散明细展开)。

**实现要点**:

- **数据**:analysis 包已为 prompt 计算这些(interrupts 白名单——今天刚补 7 个 id、CC 时长、dispelAnalysis)——同 #6 原则,main 算 → IPC 结构化表(`report:statsTable(matchId)`),renderer 只渲染。**不要**在 renderer 按新 parser doc 重实现 CC 判定(白名单腐烂病的第 9 个案例就会诞生在这)。
- **UI**:`Meters.tsx` 的榜单模式段控(伤害/治疗/承伤)加「统计」项,切换时整卡换成表格渲染(新组件 `StatsTable.tsx`);友敌着色沿用 `--ink`/`--ink-2`。
- **明细展开**(v2 可后置):行点开 → 该玩家的打断/被控明细(时间 + 技能),时间戳接 #8 的 seekTo。
- **测试**:IPC 表数据单测(用含打断/驱散的 fixture 断言行数值)。

## 11. 回放增强三小件 ✅(2026-07-17 实现 `c03731f`:HP 数字 + dampening 指示(同谓词逐秒序列)+ 施法闪现降级版;真读条条 = parser SPELL_CAST_START spike 单列未做)

**需求 & 旧仓对应**:(a) **dampening 追踪**(`ReplayDampeningTracker`)——回放控件条角落常显当前 dampening %;(b) **施法条**(`ReplayCastBar`)——读条中的单位脚下画进度条(开始/打断/完成事件已在 doc);(c) **单位 HP 数字**(`ReplayHpNumbers`)——血条旁小字 HP%(现在只有变色血条)。

**实现要点**:

- 全部纯 renderer 工作,数据都在新 parser doc / 现有 derive 层:dampening 从 aura 事件推(prompt 侧已有渲染逻辑可参考谓词),cast 从 `deriveCasts` 的开始/结束事件,HP 数字直接用回放插值采样值。
- 落点都在 `ReplayView.tsx`(383 行)内加子渲染;控件条布局注意别挤掉 1×/2×/4× 段控。
- (b) 有细节坑:打断 vs 完成 vs 被推 —— 谓词对齐 `matchTimeline` 的 channel 语义(2026-07-16 刚修过 "completed before CC landed" 的教训:SPELL_CAST_SUCCESS 在 channel 是开始不是完成)。

## 明确不抄清单(2026-07-17 对比结论,防止未来重提)

- **15 平铺 tab 结构**:碎片化,三视图段控更好。
- **Video/OBS 录制 tab**:需要 recorder 整包,产品方向不同。
- **云端分享 URL / 社区 / 天梯 / CharacterStats / CompetitiveStats**:gladlog 是本地优先;分享需求走 C3 导出(自包含 HTML)而不是云。
- **CombatMistakes 规则库整包**:AI + 确定性 findings 管线已取代;但 `mistakeKnowledgeBase.ts` 值得读一遍当**确定性 findings 的选题清单**(哪些规则可下沉为 analysis 侧确定性检查)。
- **CombatLogView 原始日志查看器**:开发者视图(DevPanel)已覆盖调试需求。
- **玩家装备/天赋 tab + 外站链接**(ArmoryLink/CheckPvP/Drustvar/GearStick/Seramate):nice-to-have,若做玩家 popover 时顺带,不单列。

**建议实施顺序**:#7(半天级,立刻可见)→ #6(核心价值)→ #8(差异化)→ #9 → #10 → #11。
