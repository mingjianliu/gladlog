# eval-ab — prompt 构建器改动 A/B 验证

验证某个 _prompt 构建器代码_ 改动(`buildMatchContext` 及其依赖)是否真提升了分数:同一批本地日志、双臂构建、盲评、配对统计。有状态——读 `$GLADLOG_EVAL_HOME/ab/<abId>/state.json` 决定跑哪个阶段。

> 找"下一个修什么"用 `/eval-baseline`;信任 judge 之前先 `/calibrate-judge`。

abId 建议 `YYYY-MM-DD-<change-slug>`。gladlog 相比上游的简化:**无需保存 raw log**——语料来自本地日志清单,matchId 是内容哈希,同一清单双臂重建即天然配对(ordinal 由 corpus 构建器决定,构建器代码不属于被测面时 ordinal 跨臂稳定;若你的改动动了 corpus 构建器本身,先停下——那不是本工作流能测的)。

## 参数处理

- 无参数 → 按 state 自动判段:无 state → Phase 1(Control);`control-ready`/`treatment-ready` → Phase 2(Treatment)
- `adopt` / `abandon` → Phase 3(收尾)

## 共享:回复生成(两臂通用)

对臂目录 `BASE`(Phase 1 = `ab/<abId>/control`,Phase 2 = `ab/<abId>/treatment`)执行 `eval-baseline.md` Step 2(含 `MATCHID:` 头与 ordinal 完整性检查),回复写 `BASE/responses/NNN.txt`;然后跑确定性质量检查:

```bash
BASE_DIR="<BASE>" npx tsx packages/eval/scripts/qualityCheck.ts
```

**任何一臂都不单独评分。** 全部 rubric 评分只在 Phase 2 Step 2.4 盲评做一次——知道臂别(或实现了被测改动)再评分 = 偏置删除,禁止。

## Phase 1 — Control

1. **问用户两件事**(一条消息):测什么改动?目标提升哪个维度?等回答。
2. **在 control 代码上**(通常 = main,未含被测改动)构建 control 臂:
   ```bash
   npx tsx packages/eval/scripts/buildCorpus.ts --manifest "$GLADLOG_EVAL_HOME/corpus/manifest.txt" --run <临时>  # 或直接
   BASE_DIR 版:构建器不支持任意目录时,先 --run 再整体移动到 ab/<abId>/control/
   ```
   实操:`buildCorpus --manifest … --run ab-<abId>-control` 后 `mv "$GLADLOG_EVAL_HOME/runs/ab-<abId>-control" "$GLADLOG_EVAL_HOME/ab/<abId>/control"`。
3. 共享回复生成(BASE=control)。**不评分。**
4. 写 `ab/<abId>/state.json`:
   ```json
   {
     "phase": "control-ready",
     "manifest": "<所用日志清单路径>",
     "fingerprint": "<control fingerprint.txt 内容>",
     "controlRunDate": "YYYY-MM-DD",
     "controlCommit": "<git rev-parse --short HEAD>",
     "treatmentRuns": 0,
     "targetDimension": "<维度>",
     "changeDescription": "<改动描述>"
   }
   ```
5. 汇报:control 就绪(N 场,未评分),提示用户实现改动后再跑 `/eval-ab`。

## Phase 2 — Treatment

1. 读 state,打印改动/目标维度/control 信息。
2. **在含被测改动的代码上**用**同一份 manifest** 重建 treatment 臂(方法同 Phase 1 第 2 步,目录 `ab/<abId>/treatment`)。核对 treatment 的 `fingerprint.txt` 与 state 里的 control fingerprint 一致——**不一致 = 语料不同,拒绝对比,中止**。
3. 共享回复生成(BASE=treatment)。
4. **盲评:**

   ```bash
   AB_DIR="$GLADLOG_EVAL_HOME/ab/<abId>" npx tsx packages/eval/scripts/blindPool.ts
   ```

   > **盲评铁律(不可协商):** 在全部盲分写完之前,不读 `blind/mapping.json`——不是现在读,不是"核实一下"读,报错也不读。你实现了被测改动,知道哪件是 treatment 就毁了对比。只有 abStats 读 mapping。

   对 `blind/items/` 每个目录起一个后台评分子代理(自包含,一件一代理——绝不两件进一个代理,它会认出配对):

   > You are scoring a WoW arena coaching prompt/response pair. Read
   > `$GLADLOG_EVAL_HOME/ab/<abId>/blind/items/ITEMID/prompt.txt` and `.../ITEMID/response.txt`.
   > Apply the scoring rubric from `docs/commands/eval-baseline.md` Step 3 exactly (three-pass
   > process, 1/3/5 anchors; there is no quality-report.json for this item — skip the consistency
   > rules that reference it). Do not read any other file or directory. Write ONLY the score JSON
   > (standard 7-dimension format, factAudit + provenance included) to
   > `$GLADLOG_EVAL_HOME/ab/<abId>/blind/scores/ITEMID.json`.

   全部分数写完后解盲并算配对统计:

   ```bash
   AB_DIR="$GLADLOG_EVAL_HOME/ab/<abId>" npx tsx packages/eval/scripts/abStats.ts
   ```

   输出逐维 Δ均值、SD、95% bootstrap CI、符号检验 p、verdict(improved/regressed = CI 不含 0),并写 `comparison-stats.json`。

5. **对比报告** `ab/<abId>/comparison-report.md`,两类证据:
   - **确定性指标**(sufficiency/noise/labelBias 的裁决依据):diff 两臂 `quality-report.json`——覆盖率、重复率、刷屏行、偏向词、hard failures、近似 token。
   - **盲评统计**(accuracy/outcomeAlignment/focusCalibration/inferenceScaffolding 的裁决依据):abStats 表。
     盲评表里的 sufficiency/noise 行仅供陈列,**无裁决权**——盲评者单件看 prompt、无 quality-report 锚定,看不出构建器改动加了/掉了什么(上游实证:F20 试点,实测踢断覆盖差 88 个百分点而两臂 judge sufficiency 均 4.9)。这些维度以确定性 diff 为准。
     报告结构:确定性指标表 → 目标维度逐 ordinal 表(解盲后)→ 全维盲评统计表 → Regressions(CI 全负的维度 + 明确恶化的确定性指标;inconclusive 且点估计为负的标 "(inconclusive — monitor)",不算回归)→ 新问题(treatment 盲分 ≤2 而配对 control >2 的件)→ Triage(fix now / next cycle / backlog)→ Rubric Feedback → Decision(IMPROVED/INCONCLUSIVE/REGRESSED + 建议 ADOPT/ABANDON/ITERATE;inconclusive 就明说,凭确定性理由 adopt 是用户的裁量——绝不把 inconclusive 包装成赢)。
6. state 的 `treatmentRuns` +1,phase 保持 `treatment-ready`;打印摘要。

## Phase 3 — 收尾(adopt / abandon)

1. 读 state 打印摘要;`abandon` 则提醒回滚代码改动。
2. **先写台账再删产物**:向 `$GLADLOG_EVAL_HOME/ledger.md` 的 A/B cycles 表追加一行(date、commit、改动描述、目标维度、pairs n、目标 Δ 均值 (95% CI)、verdict、decision、notes——含凭确定性理由 adopt 的依据)。`ab/<abId>/` 即将删除,台账行是这轮唯一持久记录。
3. 提取 comparison-report 的 Rubric Feedback 段落留存,然后 `rm -rf "$GLADLOG_EVAL_HOME/ab/<abId>"`。
4. 打印 rubric feedback 与后续指引(adopt → 改动已上线,跑 `/eval-baseline` 立新基线;abandon → 回滚后跑 `/eval-baseline` 确认基线未动)。

## 注意

- 盲评评分由子代理完成;编排会话**绝不**亲自评分——它知道改了什么。
- judge 没过 `/calibrate-judge` 之前,盲评统计只是噪声——先校准。
- 小样本(10–40 对)下符号检验+bootstrap CI 是主证;不显著就是不显著。
