# calibrate-judge — judge 校准(合成缺陷元评测)

在信任 LLM-judge 分数之前(新 rubric、换评分模型、或 A/B 目标 Δ 很小 < 0.5 时)先校准:向真实 prompt/回复对植入**已知缺陷**,验证 judge 把每个扰动件在目标维度上打得比未扰动的同源件低。无需人工标注——缺陷是我们自己造的,ground truth 免费。

七个缺陷类覆盖七维:捏造主张(accuracy)、复制噪声行(noise)、加载严重度标签(labelBias)、打乱事件顺序(inferenceScaffolding)、删除死亡行(sufficiency)、反转赛果框架(outcomeAlignment——仅 Win/Loss 源)、琐事主导重构(focusCalibration)。

## Step 1: 构建套件

需要一次已完成的 `/eval-baseline` run(`prompts/`、`responses/`、`index.json` 齐全):

```bash
npx tsx packages/eval/scripts/buildCalibration.ts --run <runId>   # 可加 --source-count 5 --seed 42
```

产出 `runs/<runId>/judge-calibration/cases/case-NN/{prompt.txt,response.txt}`(每源最多 1 原始 + 7 扰动)+ `calibration-manifest.json`。

> 上游已知结果(2026-07-04):judge 对 accuracy/scaffolding/labelBias 缺陷检出可靠(100%),对 noise(67%)和 removed-deaths sufficiency(33%)不可靠——这两维在真实管线里由 `qualityCheck` 确定性指标裁决,它们在这里 FAIL 不阻塞目标维度为确定性指标的 A/B。gladlog 首轮校准即建立自己的基线。

> **盲评铁律(不可协商):** 全部分数写完之前,你(编排者)和任何评分子代理都不得读 `calibration-manifest.json`——它写着每件的植入缺陷,读了校准就废了。只有 checkCalibration 读它。

## Step 2: 逐件盲评

对 `judge-calibration/cases/` 每个目录起一个后台子代理(执行模型同 `eval-baseline.md` Step 2,无外部 API)。每个子代理只拿到这段(代入 CASEID):

> You are scoring a WoW arena coaching prompt/response pair. Read:
> `$GLADLOG_EVAL_HOME/runs/<runId>/judge-calibration/cases/CASEID/prompt.txt` and `.../CASEID/response.txt`.
> Apply the scoring rubric from `docs/commands/eval-baseline.md` Step 3 exactly — three-pass
> process (fact audit → anchored dimension assessment → JSON) and the 1/3/5 anchors. There is no
> quality-report.json for this item — skip the consistency rules that reference it. Do not read any
> other file, directory listing, or manifest. Write ONLY the score JSON (standard 7-dimension
> format with prompt and response blocks, factAudit included) to
> `$GLADLOG_EVAL_HOME/runs/<runId>/judge-calibration/scores/CASEID.json`.

全部一次并行派出。一件一代理——绝不两件进一个代理(它会认出近重复 prompt 并推断扰动)。

## Step 3: 检出率判定

```bash
npx tsx packages/eval/scripts/checkCalibration.ts --run <runId>   # PASS_THRESHOLD 默认 0.8
```

写 `judge-calibration/calibration-report.md`,打印逐维检出率;任一维检出 < 80% 退出码 1(FAIL)。

## 解读

- **PASS** — 这些维度的 judge 分数有信号,A/B Δ 可以当真(仍受样本量约束)。
- **某维 FAIL** — judge 看不见该缺陷类:该维的 A/B Δ 不可采信。改 rubric 锚点(`eval-baseline.md`)后**不重建套件**(同种子可控对比),重评(Step 2)、重判(Step 3)。
- 每轮 verdict 记入 `$GLADLOG_EVAL_HOME/ledger.md` 的 Judge calibrations 表。

## 注意

- 套件对给定 `--seed` 确定——rubric 改动前后的重评是受控对比。
- 发现真实 judge 失误就给 `buildCalibrationSuite.ts` 加一个新扰动类(每个 judge bug 变成一个植入缺陷)。
- 校准分数是校准产物,不是 eval 结果——绝不混进 run 的 `scores/`。
