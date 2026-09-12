---
name: analysis-dev
description: 改 packages/analysis 的任何东西之前读这个 —— 谓词、候选、上下文行、spellCategories / MITIGATION_TABLE 之类的手工表、生成数据、时长 / 冷却 / 控制的数值。也用于用户给出一条游戏事实裁决(「X 永远是 6 秒」「Y 应该算控制」)要落进数据层的时候。与 desktop-dev 对称。
---

# analysis 开发约定(2026-09-01 至 09-03 二十余个提交沉淀)

## 改之前:五件事先量

0. **用户给的 id 先查活没活**:`grep -c '\b<id>\b' packages/analysis/src/data/observedSpellIdsGenerated.json`
   和 `$GLADLOG_EVAL_HOME/corpus/observedSpellIds-S2-archive-*.json`。零出现 = 改号或已删(GH #23 形状),
   先按名字在原始日志里找现行 id,找不到就问;登记一个死 id 看起来权威,永远不触发。
   09-04 两个独立计划都把 Shining Force 204263 查成零出现 —— 经验玩家给的 id 也会过期。
1. **树是不是共享的**:`git status --short && git log -1 --oneline`。「脏」= `packages/*` 下有不认识的改动;
   只有 docs / `.claude` 脏 → 照常干,但显式路径模式。基线必须在 `packages/*` 干净时采
   (missed-cleanse +17 差点被误归因给自己)。细则见 `parallel-sessions`。
2. **基线先采**:`npx tsx packages/eval/scripts/acceptanceCapture.ts --manifest
   $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt --every 30 --needle "<关键字>"`
   (当前语料 = 新赛季归档,`--every 30` ≈ 605 场,09-02 六轮验收全用它;findings 哈希 + context 哈希 +
   healer:/dps: 逐类计数 + 关键字行)或 `acceptanceHash.ts`(本机库,只看治疗 findings)。
   改完再采一份,diff。基线数字**同时写进对话和提交信息**,scratchpad 会随会话消失。
3. **一个事实的所有消费者**:`grep -rn <符号>` 到 packages/analysis、desktop、eval 三处。
   `ccSpellIds` 有 15 个 analysis 消费者 + 3 个 eval 门规消费者,而且**混着两种语义**:「被控中」
   ([CC] 行、被控覆盖、coverage 门)与「不能施法」(crisis 豁免、`cannotCastIntervals`、healer-offense
   「没放控制」)—— 击退 / 减速这种「被控但能施法」的东西直接 `cc()` 会发 3 秒施法豁免、
   把 dispel `getPriority` 的 `case "cc"` 抬成 Critical、还会进 DR 链。`SPELL_CATEGORIES.type`
   这三个暗读者(`isCastBlockingAuraType` / dispel 优先级 / DR 路径)每次都要过一遍。
   只看候选计数会漏掉上下文行的变化。查「表里有没有」要连消费者一起查:
   `talentMitigationGenerated.json` 早就有 473909 = 30%,零消费者,等于没有。
4. **用户给一条 id 事实时,先拉整张表**:手工值 vs DB2(`spellEffectGenerated.json`)vs 语料实测三列。
   「羊 6 秒」一句话拉出来是 22 条分歧 21 条手工错。语料寿命 / 锁定扫描很便宜
   (`ccLifetimeScan.ts`、`kickLockoutScan.ts`,605 场一分钟)。**官方表也要实测**:束缚射击 DB2 2 s、
   实测 3.0 s ×1084,进 `CORPUS_DURATION_PATCHES` 而不是回填手工表。

## 改的时候

- **谓词单源**:同一事实在 analysis 与 eval 门规之间、以及 analysis 内部两个消费者之间,import 同一个函数/常量。
  查 `docs/predicate-index.md`;新配对登记进去(中英两份),`packages/eval/test/predicateIndex.test.ts` 会钉住符号名。
- **新增手工 id 表 → 登记 `packages/analysis/src/data/curatedIdRegistry.ts`**(62 张),否则 rotScan /
  gapScan 看不见它。往已登记的表(`SPELL_CATEGORIES`、`MITIGATION_TABLE`…)里加条目不用再登记,
  从它们派生的集合(`ccSpellIds`、`rootSpellIds`)也已覆盖 —— 先 `grep` 注册表再决定。
  删掉的手工时长要有测试拒绝回填(`test/ccFullDuration.test.ts` 的形状)。
- **数值先算方向再叫「保守」**:踢锁定偏短 = 少豁免 = 多冤枉,注释写的「conservative 3 s」是反的。
- **改共享谓词必须重生成参照表**,1–2 小时,渲染整数几乎不变也得跑(`update-wow-data.md` 6b-pre 段有跑法)。
  触发对照:`crisisDecisionPoints` / 应对分类 → `behaviorPriorGenerated`;`burstWindowDecisionPoints` /
  进攻 CD 表 → burst-window 参照;`enemyHealerCcWindows` / 控制集 → sync-window 参照;`cdAvailableAt` 容差
  → 三张都动。`emit-table > 同名 json` 会先截断脚本自己 import 的文件,先写临时文件再 cp。
- **`PROMPT_VERSION`**(`packages/desktop/src/shared/promptVersion.ts`):prompt 文本或候选菜单变了就 bump,
  一批改动 bump 一次。
- 读生成物先确认形状:`observedSpellIdsGenerated.json` 是数组,`Object.keys` 拿到的是下标,曾造出「只有 1 个 observed」的假象。
- 门规:渲染出来的数字(参照率、时刻、时长)加 `promptQualityCheck.ts` 的 hardFailure 一类,而不是靠 A/B 发现矛盾。

## 改完:验收与归因

- 同一 manifest 前后两份采集 diff:哈希不动 = 逐字节不变;动了则逐类计数指认候选层落点、关键字行指认上下文层落点,
  **每个非零 delta 解释到机制**。
- 两项改动混在一批:临时禁用一项(`?? undefined` 那种一行改),再采一份,三份两两相减归因;恢复后 grep 确认。
- 台账 / 候选 / 死亡行三方比对:同 manifest `buildCorpus` 建前后两个 run,跑 `qualityCheck.ts`,逐 prompt diff,
  只允许目标类失败数和 approxTokens 动。
- **新测试文件默认隔离运行**(本地混合隔离,fail-closed):不改模块 / 全局 / 进程状态的测试,顺手把路径加进 `packages/<pkg>/vitest.shared.json`(保持排序),本地 presubmit 才会变快;用了 `vi.mock` / `spyOn` / 写 `process.env` 的别加,加了也会被检测器否决。改 `*_FLAGS` 开关单例必须 `const savedFlags = { ...X }` + `finally { Object.assign(X, savedFlags) }`,写死值还原会被守卫判红。只在本地红的失败先 `GLADLOG_TEST_ISOLATE=all` 重跑区分状态泄漏。
- `npm run presubmit`;跑单包测试用 `npx vitest run --root packages/analysis <子串>`(`cd` 进去反而 "no tests",
  zsh glob 不匹配整条命令失败,`grep --include=*.ts` 也要加引号);scratchpad 脚本用 `npx tsx` 从仓库根跑、绝对路径 import。
- 提交信息:前后数字、哪些 delta 不是自己的、用户裁决原话和日期。
