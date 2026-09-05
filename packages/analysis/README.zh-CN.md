# @gladlog/analysis

[English](README.md) · **中文**

gladlog 的战斗分析核心:把一场已解析的 WoW 竞技场/淘汰赛对局,转成结构化事实、AI 教练用的 prompt、群体对比数据、以及跨对局学习信号。它只有一个 workspace 依赖(`@gladlog/parser-compat`),不依赖 Electron、React 或任何 UI 框架 —— 纯 TypeScript,被 `packages/desktop`(renderer 的 `derive/` 层)和 `packages/eval`(验证门、语料构建)消费。`src/` 下(含同目录测试)约 35,000 行 / 128 个文件,是仓库里最大的包。

本文档假定你已经会写 TypeScript,只是第一次接触这个代码库。下面每条断言都能在具体文件里找到出处;有疑问就打开对应文件看。

## 这是什么,输入是什么形状

`src/index.ts` 是一个约 90 行的公开 API 桶文件(barrel)。它自己的文件头就写明了刻意的范围:「入口形状:legacy(`@gladlog/parser-compat`);类型设计允许未来原生 StoredMatch 形状 utils 并存、逐 util 迁移」—— 也就是说每一个导出函数目前都还消费 `@gladlog/parser-compat`(本包唯一的依赖)定义的**旧(legacy)形状**,原生形状的迁移是刻意留了个口子、并没有做完,不要默认它已经完成。

具体来说,顶层入口 `buildMatchContext`(`src/context/buildMatchContext.ts`)的签名是:

```ts
export function buildMatchContext(
  combat: AtomicArenaCombat,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  options: { useTimelinePrompt?: boolean; owner?: ICombatUnit } = {},
): string;
```

`ICombatUnit` 和 `AtomicArenaCombat`(`= IArenaMatch | IShuffleRound`)都定义在 `packages/parser-compat/src/types.ts` 里、从那里 import —— `src/utils/` 里大多数文件都是同一个模式。

**有一处需要纠正的地方:** 真正把原始解析 doc 转成这个旧形状的函数是 `toLegacyMatch`,由 `@gladlog/parser-compat` 导出 —— 但常被提起的名字 `toLegacySafe` **不属于**本包的依赖面。`toLegacySafe` 是桌面端本地的一个小封装(`packages/desktop/src/renderer/src/report/derive/legacySource.ts`),会在调用 `toLegacyMatch` 之前,给裁剪版测试 fixture 缺失的单位事件数组补空数组 —— 所以本分析包完全不需要知道它的存在,拿到的永远是调用方以任意方式产出的、成品状态的旧形状数据。

## 七个子目录

- **`context/`**(10 个文件)—— 顶层拼装器。`buildMatchContext.ts` 拉进几乎每一个 `utils/*` 模块和每一张相关的 `data/*` 表,渲染出面向 AI 的 prompt 字符串。`matchTimeline.ts` / `matchTimelineSections.ts` 构建 `[STATE]`/`[DMG SPIKE]`/`[CD]` 渲染时间线行 —— 这是门规谓词共享规则里「渲染值」的那一端(见下文)。`criticalMoments.ts` / `criticalWindows.ts` 决定哪些秒数要更密的采样。`matchNarrative.ts` 构建叙事文本;`resourceSnapshot.ts` 构建资源(法力/怒气等)快照;`timelineHelpers.ts` 装跨文件共用的工具函数。

- **`analysis/`**(18 个文件)—— 面向 AI 的 finding/prompt 管线,分三段:
  1. `candidateFindings.ts` —— 确定性。`extractCandidateFindings` 加约 16 个按类型分的 `xEvents` 函数,把原始分析输出转成 `CandidateEvent[]`(一个 `type`、一个确定性 `id`、一个 `facts: Record<string,string>` —— 模型唯一能引用的数值)。
  2. `buildFindingsPrompt.ts` —— 把候选菜单加一份按类型分的图例(`DPS_LEGENDS`/`CHAIN_LEGENDS`)渲染进真正发给模型的 prompt。
  3. `auditFindings.ts` —— 模型返回后的溯源审计:每条模型返回的 finding 的 `eventIds` 都必须落到一个真实候选上,每个 `{{placeholder}}` 都必须无歧义地解出值。这个文件是通用的(零按 finding 类型分支的逻辑)。

  配套:`findingCategories.ts`(把模型的自由文本类别归一化成固定的 8 值枚举:`survival, cooldowns, positioning, target-selection, cc, interrupts, dispels, offense`)、`causalLint.ts` / `spellNameZhLint.ts`(审计过程里跑的文本级 linter)、`deepDive.ts`(多轮自动追问管线,有自己的路由集合如 `OFFENSIVE_CANDIDATE_TYPES`)、`parseModelJson.ts`(容错解析模型 JSON)、`factFormat.ts`(数值事实格式化)。

- **`compare/`**(10 个文件)—— 对照 `packages/eval` 构建的参考语料做群体/百分位对比。`verifiedComparison.ts` 导出 `percentileRank`/`verdictFor`(从存好的 p10/p50/p90 锚点做分段线性百分位,截断到 [10,90])。`cellLookup.ts` 的 `assignBuildGroup` 把一场对局的天赋匹配到参考 cell。`claimChecker.ts` 掌管单源的占位符语法 `PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g`,明确注明由插值、claim 校验、深挖审计三处共用以防漂移。`buildExemplarLedPrompt.ts` 渲染「群体范例」文本块;`metricLabels.ts` 是对比维度的中英文标签单源表。

- **`learning/`**(7 个文件)—— 跨对局、确定性的「反复出现的习惯」检测,上面再叠一层 LLM 蒸馏(设计文档:`docs/superpowers/specs/2026-07-26-self-learning-rules-design.md`)。`patternScan.ts` 是确定性筛选器(`PATTERN_WINDOW_MATCHES=20`、`PATTERN_MIN_HITS=5`、`RULE_RETIRE_MAX_HITS=2` 等等),它的谓词 `findingMatchesGroup`/`matchInCondition` 被明确记为规则应用那一侧共享的单一来源。`distillRules.ts` 把稳定模式变成规则文本,遵守和 finding 一样的「不写裸数字,只用 `{{hits}}` 这类占位符」纪律。`matchRules.ts` 的 `ruleAppliesToFinding` 把学到的规则应用到新对局,是 import(而不是复制)`patternScan` 的谓词。被 `packages/desktop/src/main/learning.ts` 消费。

- **`benchmark/`**(3 个文件)—— 全语料统计,和 `compare/` 的逐场百分位查找不同。`metrics.ts` 对一批对局计算按专精的 `SpecStats`/百分位(承压窗口、HPS/DPS 样本、CD 首用时机、驱散率、死亡时递减效应;`WINDOW_SECONDS=10`、`MIN_SAMPLES_FOR_SUMMARY=5`)。`stratify.ts` 的 `stratifiedSample` 按专精×流派做确定性(前 N)分层抽样,每层设上限,用于构建均衡的评估语料。

- **`data/`** —— 其余一切读取的游戏数据底层;详见下面专门一节。

- **`utils/`**(39 个非测试文件)—— 最大、最杂的目录。大致分几类,附示例文件:
  - 冷却/CD 追踪与渲染网格谓词:`cooldowns.ts`(最大的文件 —— `HP_SAMPLE_RADIUS_MS`、`fmtTime`、`toRenderSecond`、`extractMajorCooldowns`、`cdAvailableAt`)、`enemyCDs.ts`、`dampening.ts`。
  - DR/CC 追踪:`drAnalysis.ts`、`ccTrinketAnalysis.ts`、`auraIntervals.ts`。
  - 走位/几何/视线:`losAnalysis.ts`(位置插值、`hasLineOfSight`、`distanceBetween`)、`positionSampling.ts`(门规谓词共享的单源模块 —— 见下文)、`positionAnalysis.ts`。
  - 治疗专精专属指标:`healerExposureAnalysis.ts`、`healerMetrics.ts`、`healerOffenseAnalysis.ts`、`healingGaps.ts`。
  - 爆发/伤害/进攻:`burstLedger.ts`、`dpsMetrics.ts`、`offensiveWindows.ts`、`offensiveWasteAnalysis.ts`、`killWindowTargetSelection.ts`、`counterfactual.ts`。
  - 驱散/打断:`dispelAnalysis.ts`、`kickAudit.ts`、`enemyInterrupts.ts`。
  - 死亡/结局:`deathOutcomeAnalysis.ts`、`crisisEvents.ts`(`extractRotations`)。
  - 阵容/流派分类:`archetypeInference.ts`、`archetypeInjection.ts`、`enemyCompArchetype.ts`、`matchArchetype.ts`。
  - 天赋/技能元数据帮手:`talentBehaviors.ts`(从官方 tooltip 策展而来,刻意*不*从日志推断 ——「只有理解透彻的天赋才该收进来」)、`talentModifiers.ts`、`talents.ts`、`spellDanger.ts`、`spellSchools.ts`。
  - 底层/通用:`binarySearch.ts`、`stats.ts`(`toSortedFinite` —— 有序统计的单源,避免 `NaN` 污染比较函数的 bug)、`memoize.ts`、`combatStates.ts`、`specBaselines.ts`。

## `src/data/`:生成产物 vs 人工策展

动手改这个目录之前,先把这条线分清楚很重要。

**生成产物**(由脚本产出,带「生成文件」/「Generated at:」一类标记 —— 具体措辞每个文件不完全一样,但意图一致:别手改):

| 文件                                       | 由谁产出                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `spellClassMapGenerated.ts`                | `scripts/datagen/genSpellClassMap.ts`                                                 |
| `spellEffectGenerated.ts` + `.json` 旁文件 | `scripts/datagen/genSpellEffects.ts`                                                  |
| `spellIconsGenerated.ts` + `.json` 旁文件  | `scripts/datagen/genSpellIcons.ts`                                                    |
| `spellNamesZhGenerated.json`               | `scripts/datagen/genSpellNamesZh.ts`                                                  |
| `drCategoriesGenerated.ts`                 | `scripts/datagen/genDrCategories.ts`                                                  |
| `offGcdGenerated.ts`                       | `scripts/datagen/genOffGcd.ts`                                                        |
| `pvpTalentReplacesGenerated.ts`            | `scripts/datagen/genPvpTalentReplaces.ts`                                             |
| `specIconsGenerated.ts`                    | `scripts/datagen/genSpecIcons.ts`                                                     |
| `mitigationGenerated.json`                 | `scripts/datagen/genMitigation.ts`                                                    |
| `talentIdMap.json`                         | `scripts/datagen/fetchTalents.ts`                                                     |
| `spellNames.json`                          | `scripts/datagen/genSpellNames.ts`                                                    |
| `talentModifiers.json`                     | `scripts/datagen/genTalentModifiers.ts`                                               |
| `trinketItemIds.json`                      | `scripts/datagen/genTrinketItemIds.ts`                                                |
| `dispelObservedGenerated.ts`               | **不在** `scripts/datagen` —— `packages/eval/scripts/confidenceAudit.ts --emit-table` |
| `observedSpellIdsGenerated.json`           | **不在** `scripts/datagen` —— `packages/eval/scripts/observedSpellIds.ts`             |

动这张表之前有两点要知道:有些 JSON 旁文件完全没有文件头(JSON 没法写注释),只能靠文件名约定或者 body 内嵌的 `"generatedAt"` 字段辨认(比如 `trinketItemIds.json`);另外两个生成文件 —— `dispelObservedGenerated.ts`、`observedSpellIdsGenerated.json` —— 来自 `packages/eval` 的**语料挖矿**脚本,不是本包自己的 `scripts/datagen`,因为它们记录的是「真实日志里实际观测到解除/驱散过什么」,只有 eval 的语料工具才摸得到这份数据。

**人工策展**(体现人的判断,不带生成标记):`classSpells.ts`、`spellCategories.ts`、`spellIdLists.ts`、`zoneMetadata.ts`(四个文件的文件头几乎一样,都注明是给「上游+自有混改」的旧文件做的最小化手写替代 —— 一次数据合规重写);`spellEffectOverrides.ts`(叠在 `spellEffectGenerated` 之上的手选修正);`talentBehaviors.ts`(刻意来自 tooltip,不是从日志推断);`spellNameStopwords.ts` / `spellNameZhLintStopwords.ts`(中文那份明确是一份*已证实*误报的黑名单,不是「候补名单」);`spellNameZhLintTable.ts`(来自一次具体的生产事故);`discoveryRules.ts`、`dispelFeatureFlags.ts`、`arenaGeometry.ts`、`spellTags.ts`、`spellTypes.ts`(明确注明是本仓库原创定义,不是从上游派生)、`talentNames.ts`、`talentStrings.ts`、`spellNameLookup.ts`、`spellEffectData.ts`、`ensure.ts`。

有些文件不是纯粹的二选一,而是**双层合并**:`spellEffectData.ts` 和 `mitigationData.ts` 都是生成底层 + 策展覆盖层恒赢(「生成底 + 策展覆盖恒赢」)。`spellEffectData.ts` 还记着一条真实的性能教训:12MB 的 `spellNames.json` 加载被刻意放到后台、不用顶层 await,这样从不查技能名的对局列表首屏才不会被它卡住 —— 但构建 prompt 的路径*必须* `await ensureSpellNames()`(在 `data/ensure.ts` 里),因为那条路径容不下降级用的兜底名字。

**`datagen-manifest.json`**(由 `scripts/datagen/writeManifest.ts` 写出)是一份构建戳/溯源摘要:DB2 的 `build` 字符串、一个 `generatedAt` 时间戳,以及上面大多数(不是全部)文件的体积/条目数,外加一个不在本包内的产物(`parser-compat/enumsGenerated.ts`)—— 纯粹是为了让 `/update-wow-data` 工作流知道也要重新生成它。它只被 datagen 脚本自己读取,从不被本包对外的运行时 API 消费;存在的目的是让那个工作流靠对比 `build` 字段判断新的游戏版本是否需要刷新数据。

**没有一个脚本能端到端跑完整套 datagen** —— 本包和根 `package.json` 都没有 `datagen` 脚本。管线是 `docs/commands/update-wow-data.md` 里记录的一串按顺序执行的 `npx tsx scripts/datagen/*.ts` 调用(天赋先跑,因为技能特效生成要读天赋候选集;图标要在中文名之前;`writeManifest.ts` 放最后),跑完还要过 `validateCatalogs.ts`(策展目录校验门)和全量测试。

## 新增一个分析谓词:文件改动清单

用一个真实例子(`juked-kick` finding 类型)顺藤摸瓜出来的:

1. **纯检测函数** —— 写在 `src/utils/<name>.ts`。例:`src/utils/kickAudit.ts` 里的 `analyzeKickAudit`。
2. **转成一个 `CandidateEvent`**,在 `src/analysis/candidateFindings.ts` —— 定一个新的、唯一的 `type: "..."` 字符串,一个确定性 `id`(模式:`` `${type}:${owner.id}:${Math.round(t)}` ``),和一个 `facts: Record<string,string>`(只放模型能引用的值)。这里已经有 17 个 `type` 值了(`cd-waste`、`death`、`missed-cleanse`、`missed-purge`、`cc-locked`、`kick-eaten`、`wasted-trinket`、`death-setup`、`death-unused-defensive`、`external-unused`、`questionable-external`、`unconverted-burst`、`burst-into-immunity`、`off-target-in-window`、`juked-kick`、`dr-clipped-cc`、`crisis-no-response`)—— 照着这些的样子写。
3. **加一行图例**,在 `src/analysis/buildFindingsPrompt.ts` —— 新 `type` 需要在 `DPS_LEGENDS` 或 `CHAIN_LEGENDS` 里加一条(两者都以 `type` 字符串本身为键),告诉模型这个事件是什么意思。漏掉这步不会造成机制上的错误,但模型会看到一个没解释过的事件。
4. **`findingCategories.ts` 通常不用改** —— 它的 8 值枚举很粗,由模型自己赋值;新 finding 类型只要能合理归进某个既有类别就行。
5. **`auditFindings.ts` 不需要按类型改** —— 它的溯源/占位符/lint 逻辑对所有候选类型都是通用的。
6. **可选:`deepDive.ts` 路由** —— 如果新类型该参与自动多轮追问,加进相关集合(比如 `OFFENSIVE_CANDIDATE_TYPES`);有些类型是根据 A/B 结果刻意排除在外的,不要默认全加。
7. **测试** —— 检测函数的单测放 `candidateFindings.test.ts` 或 `test/ported/<name>.test.ts`;如果图例/菜单逻辑改了,`buildFindingsPrompt.test.ts` 也要补覆盖。
8. **数据(如果需要)** —— 在 `src/data/` 里扩展一个策展文件(比如 CC 分类用 `spellCategories.ts`/`spellTags.ts`),或者如果是语料观测类事实,走上面的 datagen 管线。

## 本包里的门规谓词共享规则

仓库的 `CLAUDE.md` 定了一条硬规矩:分析代码与 `packages/eval` 的验证门对同一个事实必须共享同一个谓词 —— 同一常量、同一采样函数、同一容差 —— 且锚定在**渲染值**上。本包里有两个具体案例,展示了两种不同(但都合规)的落实方式:

**`LOS_SWEEP_SLACK_S` / `LOS_SWEEP_GAP_MS` —— 字面意义的单一 export,两边都 import。** 定义在 `src/utils/positionSampling.ts` 里,只有一份:

```ts
export const LOS_SWEEP_SLACK_S = 2;
export const LOS_SWEEP_GAP_MS = 3_000;
```

这个模块自己的文件头解释了为什么要独立成一个文件:这些常量以前是四处分散的私有声明,只靠一句「必须和 positioningScan.ts 保持一致」的注释耦合 —— 正是这条规则明令禁止的形态 —— 直到 2026-07 全量审计发现 5 个这一类的独立 bug,才被合并到这里做成真正的单源。`healerExposureAnalysis.ts` 直接 import 并使用它们;它们从 `src/index.ts` 重新导出;`packages/eval/src/quality/positioningScan.ts` 直接从 `@gladlog/analysis` import 同样这两个常量,再本地起别名(`const TIME_SLACK_SECONDS = LOS_SWEEP_SLACK_S`、`const POSITION_MAX_GAP_MS = LOS_SWEEP_GAP_MS`)。同一个文件里第三个常量 `INTERP_MAX_GAP_MS = 1_500`,是刻意取了*不同*的值服务不同目的(单点位置插值的 grounding 守卫,比 LoS 扫描严得多)——文件注释警告不要把两者混为一谈,因为历史上两者都曾字面意义上叫做 `POSITION_MAX_GAP_MS`、只是取值不同(1500 vs 3000),很容易被一眼看成「同一个东西」。有一个单测(`positionSampling.test.ts`)断言了两者的确切数值,还断言 `INTERP_MAX_GAP_MS !== LOS_SWEEP_GAP_MS`,专门防这段历史混淆重演。

**`HP_SAMPLE_RADIUS_MS` —— eval 侧没有对应常量,因为那一类 bug 的修法根本放弃了「常量对齐」这条路。** 只在 `src/utils/cooldowns.ts` 定义一份(`export const HP_SAMPLE_RADIUS_MS = 3_000`),在本包内到处复用(`matchTimeline.ts`、`matchTimelineSections.ts`、`candidateFindings.ts`、`killWindowTargetSelection.ts`、`burstLedger.ts`、`enemyCDs.ts`、`counterfactual.ts`),这样构建同一份 prompt 的不同调用点才不会在「该用哪个 HP 采样」上打架。`packages/eval` 里**没有**同名常量,也没有取值相同的副本。取而代之的是,`packages/eval/src/quality/promptQualityCheck.ts` 的 `checkSameSecondHpConsistency`——该文件里正好四条 `hardFailures` 检查之一(百分位单调、同秒 HP 一致、窗口时长自洽、冷却台账一致)——重新解析**已经渲染好的 prompt 文本**,找同一个单位在同一个渲染出来的 `m:ss` 秒上是否有两处独立提及(一条 `[STATE]` 行 vs 一条 `[DMG SPIKE]` 或行内嵌提及),断言两者在 `HP_AGREEMENT_TOLERANCE_PP = 3` 个百分点以内一致。它完全不重新采样原始战斗日志数据。

这不是疏漏 —— 是一条被记录下来的教训。`cooldowns.ts` 留着一段事后复盘注释,记着一个更紧的第二常量(`HP_SAMPLE_RADIUS_CRITICAL_MS = 1500`)在 2026-07-20 的一次修复尝试后被删掉:「实测 26/50 → 26/50,一个数都没动」(修前 26/50 场对局有矛盾,修后还是 26/50 —— 半径只控制接受/拒绝,永远不会改变*取到哪个*样本;真根因是查询时刻没落在和显示秒相同的渲染网格上)。`promptQualityCheck.ts` 在门规这一侧留着对称的记录,前后数字一致(修前 26/50 场、33 处矛盾,中位 7pp / 最大 25pp)。**这条教训可以推广:** 新增一个会被门规复查的分析谓词时,先想清楚门规应该用同一常量从原始数据重新推导同一个值(LOS_SWEEP 这种情形),还是应该转而复算渲染出来的 prompt 文本本身的内部一致性(HP 这种情形)—— 如果你声称一个修复生效了,拿出本包自己这段历史用来抓回自己两次犯同一个错的、同一判据下的前后数字。
