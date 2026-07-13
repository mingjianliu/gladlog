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
