# 赛季 / 补丁数据刷新

流程本体是 skill / runbook `update-wow-data`(`docs/commands/update-wow-data.md`)。

## 状态与时代门

- 12.1 数据刷新到 build 69587(2026-09-04)。提到 12.1 / 新赛季 / DR 时先看代码里的当前 build,别重复拉数据。
- DR 窗口按时代区分:单谓词 `drResetMsAt(epochMs)` 16 s / 20 s,切点 2026-08-11 22:00 UTC;12.1 时代门单源 = `drAnalysis.ts` 的 `PATCH_121_GOLIVE_EPOCH_MS`(语料研究的赛季门也用它——「只看新赛季」时第一件事就是过这个门)。官方只改窗口,档位 Full → 50% → Immune 不变。

## 补丁说明审读(每个大版本都要做)

数据刷新 ≠ 补丁审读。DB2 只带基础值,机制改动(反噬、免疫、PvP 修正)只在补丁说明文字里。12.1 审读抓到 4 个真缺口(驱散反噬、免控 + 减伤、Scatter Shot 回归 3 s incap 等)。重点扫 PvP 章节 + "when dispelled / immune / in PvP combat";PvP 章节要拉原始 HTML(网页抓取镜像会截断)。**但别照补丁说明填数**:有一条 DB2 = 30%,补丁说明写的 20% 是错的。

## 控制时长读官方 DB2

用户裁(2026-09-02):「羊本身永远是 6 秒,除非有龙给的加持续时间的 debuff」。`spellEffectData.ccFullDurationSeconds` 单谓词:DB2 优先,空白才回退手工值。手工表 22 条硬控分歧里语料实测 21 条站 DB2,唯一反例(束缚射击 DB2 2 s,实测 3 s)走 `CORPUS_DURATION_PATCHES`;`test/ccFullDuration.test.ts` 拒绝新重复。

- **用户给一个 id 的事实裁决时,先量整张表。**
- `[CC ON ENEMY] … (6s)` 是实测光环寿命,不是官方表。
- 语料寿命扫描很便宜;`Math.max(...arr)` 大数组会爆栈,用 reduce。

## datagen / 刷新的坑

- `packages/analysis/scripts/datagen/lib/wagoCsv.ts` 的 `resolveBuild` 单源(CLI 参数 > `DATAGEN_BUILD` > wago 最新);`writeManifest.ts` 的清单是硬编码的,手工加的生成物不在清单里会被下次重写静默丢掉。
- 生成器模板里的头注释是字符串字面量,改生成物注释要和生成器**成对改**,否则下次重跑写回旧文。
- 验收数字漂移归因:先 rebase 再采基线,或 `git checkout HEAD~1 -- <data paths>` 在同一代码上重采刷新前数据(新增文件要手动删)。
- 「表里有没有」要连消费者一起查(某个生成表早挖到 30% 却零消费者)。
- `datagen` 的减伤生成有 `assertMinRows` 防 CSV 截断。
- BACKLOG 条目正文可能落后于代码注释 / git log 的裁决,引用「待裁」前先 grep 代码注释和 `git log -S`。
- 语料驱动的先验表按赛季与谓词变化重跑,不随 build(见 [batch-fix-workflow.md](batch-fix-workflow.md))。

相关:[db2-data-semantics.md](db2-data-semantics.md)、[whitelist-rot.md](whitelist-rot.md)
