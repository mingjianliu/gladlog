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
3. **两臂必须真的不同(pre-flight,回复生成之前):** 被测改动动了 prompt 构建器时,diff 两臂 prompts —— 全部逐字相同 = 有一臂用错了代码,中止排查。已知陷阱(2026-07-15 实翻):**git worktree + 软链根 node_modules** —— workspace 包软链(`node_modules/@gladlog/analysis → ../../packages/analysis`)相对解析回主树源码,control 臂静默用 HEAD 构建。worktree 里必须 `npm ci` 装自己的 node_modules。
   ```bash
   diff -qr ab/<abId>/control/prompts ab/<abId>/treatment/prompts | head -3   # 应有差异;无差异=中止
   ```
4. 共享回复生成(BASE=treatment)。
5. **盲评:**

   ```bash
   AB_DIR="$GLADLOG_EVAL_HOME/ab/<abId>" npx tsx packages/eval/scripts/blindPool.ts
   ```

   > **盲评铁律(不可协商):** 在全部盲分写完之前,不读 `blind/mapping.json`——不是现在读,不是"核实一下"读,报错也不读。你实现了被测改动,知道哪件是 treatment 就毁了对比。只有 abStats 读 mapping。
   >
   > **同等铁律——盲件内容:** 编排者对 `blind/items/` 只许**列目录**拿 ITEMID,不许读任何 `prompt.txt`/`response.txt` 内容;也不许读 `blind/scores/*.json`(内容或 sha256 都能与你刚构建的两臂文件反查出臂别)。分数文件是否齐全只用文件存在性判断(`ls`),完整性校验放到解盲之后。

   对 `blind/items/` 每个目录起一个后台评分子代理(自包含,一件一代理——绝不两件进一个代理,它会认出配对):

   > You are scoring a WoW arena coaching prompt/response pair. Read
   > `$GLADLOG_EVAL_HOME/ab/<abId>/blind/items/ITEMID/prompt.txt` and `.../ITEMID/response.txt`.
   > Apply the scoring rubric from `docs/commands/eval-baseline.md` Step 3 exactly (three-pass
   > process, 1/3/5 anchors; there is no quality-report.json for this item — skip the consistency
   > rules that reference it). Do not read any other file or directory. Write ONLY the score JSON
   > (standard 7-dimension format, factAudit + provenance included) to
   > `$GLADLOG_EVAL_HOME/ab/<abId>/blind/scores/ITEMID.json`. In that JSON set `matchId` to
   > exactly `ITEMID` — the blind item id. Do not guess, invent, or go looking for a real match id.

   (matchId=ITEMID 是固定占位约定 —— 盲件按设计不带 `MATCHID:` 头,2026-07-20 那轮判官
   各自编了 `null`/`"unknown"`/`"NO_MATCHID_HEADER_FOUND"` 三种写法。abStats 解盲时会核对
   该字段:不等于盲件 id 记不合规;等于**真实** matchId 则按破盲嫌疑单独告警。后续要按
   真实 matchId 聚合的分析一律经 `blind/mapping.json` 换算。)

   全部分数写完后解盲并算配对统计:

   ```bash
   AB_DIR="$GLADLOG_EVAL_HOME/ab/<abId>" npx tsx packages/eval/scripts/abStats.ts
   ```

   输出逐维 Δ均值、SD、95% bootstrap CI、符号检验 p、verdict(improved/regressed = CI 不含 0),并写 `comparison-stats.json`。

6. **对比报告** `ab/<abId>/comparison-report.md`,两类证据:
   - **确定性指标**(sufficiency/noise/labelBias 的裁决依据):diff 两臂 `quality-report.json`——覆盖率、重复率、刷屏行、偏向词、hard failures、近似 token。
   - **盲评统计**(accuracy/outcomeAlignment/focusCalibration/inferenceScaffolding 的裁决依据):abStats 表。
     盲评表里的 sufficiency/noise 行仅供陈列,**无裁决权**——盲评者单件看 prompt、无 quality-report 锚定,看不出构建器改动加了/掉了什么(上游实证:F20 试点,实测踢断覆盖差 88 个百分点而两臂 judge sufficiency 均 4.9)。这些维度以确定性 diff 为准。
     报告结构:确定性指标表 → 目标维度逐 ordinal 表(解盲后)→ 全维盲评统计表 → Regressions(CI 全负的维度 + 明确恶化的确定性指标;inconclusive 且点估计为负的标 "(inconclusive — monitor)",不算回归)→ 新问题(treatment 盲分 ≤2 而配对 control >2 的件)→ Triage(fix now / next cycle / backlog)→ Rubric Feedback → Decision(IMPROVED/INCONCLUSIVE/REGRESSED + 建议 ADOPT/ABANDON/ITERATE;inconclusive 就明说,凭确定性理由 adopt 是用户的裁量——绝不把 inconclusive 包装成赢)。
7. state 的 `treatmentRuns` +1,phase 保持 `treatment-ready`;打印摘要。

## Phase 3 — 收尾(adopt / abandon)

1. 读 state 打印摘要;`abandon` 则提醒回滚代码改动。
2. **先写台账再删产物**:向 `$GLADLOG_EVAL_HOME/ledger.md` 的 A/B cycles 表追加一行(date、commit、改动描述、目标维度、pairs n、目标 Δ 均值 (95% CI)、verdict、decision、notes——含凭确定性理由 adopt 的依据)。`ab/<abId>/` 即将删除,台账行是这轮唯一持久记录。
3. 提取 comparison-report 的 Rubric Feedback 段落留存,然后 `rm -rf "$GLADLOG_EVAL_HOME/ab/<abId>"`。
4. 打印 rubric feedback 与后续指引(adopt → 改动已上线,跑 `/eval-baseline` 立新基线;abandon → 回滚后跑 `/eval-baseline` 确认基线未动)。

## 开跑前必做:算最小可测效应(MDE)

**2026-07-20 实测:一轮 50 对、约 200 个子代理的 A/B 跑完,七维全 inconclusive ——
不是改动没用,是尺子的刻度比要测的东西还粗。** 这一节就是防止再花那个钱。

派任何子代理之前,先用下表的噪声底算 MDE:

```
MDE ≈ 1.96 × SD / √n        (n = 配对数)
```

各维逐对差值的 SD(2026-07-20,50 对,sonnet judge,七维 1–5 整数 rubric):

| 维度                 | SD       | 50 对里持平 | n=50 的 MDE |
| -------------------- | -------- | ----------- | ----------- |
| focusCalibration     | 0.14     | 49          | 0.04        |
| outcomeAlignment     | 0.25     | 47          | 0.07        |
| labelBias            | 0.43     | 41          | 0.12        |
| inferenceScaffolding | 0.55     | 41          | 0.15        |
| noise                | 0.60     | 32          | 0.17        |
| sufficiency          | 0.65     | 38          | 0.18        |
| **accuracy**         | **1.30** | **14**      | **0.36**    |

**accuracy 是异类** —— SD 是次高维的 2 倍、最低维的 9 倍,50 对里 36 对在变动。
拿它当目标维度时,`|Δ| < 0.36` 在 n=50 下根本测不出;要测出 Δ=0.2 需要 n≈331 对。

### 目标维度是 accuracy 时,改锚 factAudit

同一批数据实测,`factAudit` 的 refuted **条数**(rubric 固定每件 3 条承重主张,
两臂主张总数天然相等,无数量混淆)方差只有 accuracy 分数的 **48%**:

| 指标                   | SD    | n=50 的 MDE |
| ---------------------- | ----- | ----------- |
| accuracy(1–5 分)       | 1.298 | 0.36        |
| factAudit refuted 条数 | 0.842 | **0.23**    |

分辨率提升 36%。注意这不是「信号变强」(两者效应量 d 相当),而是**精度变高**;
代价是 0–3 的粗刻度,但观测 SD 0.84 说明它的离散度足够支撑分析。

### 写结论时不许只写标签

CI 跨 0 就是 inconclusive,但**不要只写 "inconclusive, monitor"** —— 必须带上
点估计、CI、以及该 n 下的 MDE,让读者能区分「测出没差别」和「没能力测出差别」:

> accuracy Δ = −0.30(95% CI −0.66 ~ +0.06),n=50 的 MDE = 0.36。
> CI 跨 0,不显著;点估计为负,与 factAudit refuted 率(8.7% → 14.0%,
> CI −0.024 ~ +0.131)同向。两者都在该样本量的可测门槛以下,**属于"没能力测出"
> 而非"测出没差别"**,标记 (inconclusive — monitor)。

## 注意

- 盲评评分由子代理完成;编排会话**绝不**亲自评分——它知道改了什么。
- judge 没过 `/calibrate-judge` 之前,盲评统计只是噪声——先校准。
- 小样本(10–40 对)下符号检验+bootstrap CI 是主证;不显著就是不显著。
- **确定性指标可以单独支撑 ADOPT,盲评测不出不构成否决。** 两者测的不是一回事:
  确定性检查测的是**渲染物本身是否自相矛盾**(prompt 说同一秒同一单位既 88% 又 2%
  血,这是产物的正确性属性,与有没有人注意到无关);盲评测的是**下游教练质量是否
  变好**,那是更难、更吵的问题。用一个已测出噪声底过高的仪器得到的 null,
  **不是效果不存在的证据**。跨 AI 复核在这一点上给过相反意见(主张 REJECT),
  但其论据建立在把「185 条硬失败行归零」误读成「一个行号」之上,不采纳。
