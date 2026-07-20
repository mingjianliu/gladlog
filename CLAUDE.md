# gladlog

## 门规谓词即规范(shared-predicate rule)

分析代码(`packages/analysis`)与验证门(`packages/eval` 的 positioningScan/qualityCheck/layerA 审计)对**同一个事实**(HP、距离、LoS、时间点)必须共享**同一个谓词**:同一常量、同一采样函数、同一容差,且**锚定在渲染值上**——prompt 渲染 `fmtTime`(向下取整秒),门规重新解析渲染文本,所以分析内部的小数秒/原始时刻在写入 prompt 前必须先 floor 到渲染网格再做任何门规会复算的判定。

违反此规则的历史代价:2026-07 全量审计中 5 个独立 bug 全是这一类(HP 采样半径不一致、有界 vs 无界回溯、插值 vs raw vs 非同时刻采样对 LoS、小数秒 vs 渲染秒扫描网格)。修法永远是让分析消费门规的谓词,不是反过来放松门规。共享点示例:`cooldowns.ts` 的 `HP_SAMPLE_RADIUS_MS`;`healerExposureAnalysis.ts` 的 `LOS_SWEEP_SLACK_S`/`LOS_SWEEP_GAP_MS` 必须等于 `positioningScan.ts` 的 `TIME_SLACK_SECONDS`/`POSITION_MAX_GAP_MS`。

新增任何"分析断言 X、门规验证 X"的配对时:谓词放一处 export,两边 import;做不到时写断言相等的单测,别靠注释。

## 修复要给前后数字(verification rule)

声称某个 bug「修好了」时,附**同一判据下的前后数字**(如「A 类同秒 HP 矛盾 26/50 场 → 0/50」)。
给不出就明说给不出——**读代码 + 一份有说服力的 commit message 不算验证**。

2026-07-20 的代价:`3cd5342` 按「统一 HP 采样半径」修同秒 HP 矛盾,根因写得头头是道,
进了 main;后来实测 **26/50 → 26/50,一个数没动**(半径只控制接受/拒绝,不改变取到的
样本值,真根因是查询时刻不在渲染网格)。同日 `dbe61bd` 又因**只查一个样本就外推整类**
把 D 类误判为「记号歧义」,被独立评审用反例推翻(`c820ad4`)。

配套:判据优先做成**确定性文本检查并固化进门规**(`packages/eval/src/quality/promptQualityCheck.ts`
的 `hardFailures`,现有四条:百分位单调 / 同秒 HP 一致 / 窗口时长自洽 / 冷却台账一致),
不要留一次性脚本——它随会话消失,下次回归没人挡。

## 常用

- 类型检查:`npm run typecheck`(绝不 `tsc -b`,会往 src 吐 .js)。
- desktop push 前:`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`——CI 的 tsc 含 test 文件、且有独立 Lint 步,本地测试都不覆盖(连挂过三次)。工程约定见 `.claude/skills/desktop-dev`。
- eval 工作流:`/eval-baseline`(找问题)→ `/eval-ab`(验证修复)→ `/calibrate-judge`(判分前校准)→ `/pipeline-audit`(全语料审计)。产物在 `$GLADLOG_EVAL_HOME`(默认 `~/code/gladlog-eval-private`)。
