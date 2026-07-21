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

> **盲评铁律(不可协商):** 全部分数写完之前,你(编排者)和任何评分子代理都不得读 `calibration-manifest.json`——它写着每件的植入缺陷,读了校准就废了。只有 checkCalibration 读它。编排者对 `cases/` 同样只许列目录拿 CASEID,不许读任何 case 文件内容(近重复对比即可推断扰动),也不许读 `scores/*.json`;分数齐全与否只看文件存在性。

## Step 2: 逐件盲评

对 `judge-calibration/cases/` 每个目录起一个后台子代理(执行模型同 `eval-baseline.md` Step 2,无外部 API)。每个子代理只拿到这段(代入 CASEID):

> You are scoring a WoW arena coaching prompt/response pair. Read:
> `$GLADLOG_EVAL_HOME/runs/<runId>/judge-calibration/cases/CASEID/prompt.txt` and `.../CASEID/response.txt`.
> Apply the scoring rubric from `docs/commands/eval-baseline.md` Step 3 exactly — three-pass
> process (fact audit → anchored dimension assessment → JSON) and the 1/3/5 anchors. There is no
> quality-report.json for this item — skip the consistency rules that reference it.
>
> BLIND-EVALUATION RULE — NON-NEGOTIABLE: read ONLY the two files named above plus the rubric.
> Do NOT read, grep, list, or otherwise inspect `calibration-manifest.json`, any other case
> directory, any other score file, or any directory listing under `judge-calibration/`. Your
> judgment must rest solely on the prompt and response text in front of you — never on what
> another case was scored or on whether a defect "looks planted".
>
> For `matchId`: write `"unknown"`. Do not go looking for it.
>
> Write ONLY the score JSON (standard 7-dimension format with prompt and response blocks,
> factAudit included) to
> `$GLADLOG_EVAL_HOME/runs/<runId>/judge-calibration/scores/CASEID.json`.

> **重评某件之前,必须先删掉它的旧评分文件。** 写工具普遍要求「文件已存在则先读再写」——
> 重发到同一路径时,新判官会被迫读到**上一个判官的评分**。2026-07-21 实测:补发的判官
> 读到旧分后,把自己的 `inferenceScaffolding` 由 5 改成 4,正好等于旧分。它诚实报告了,
> 但那一维已经不是独立判断。**这是工具约束造成的污染,不是判官不守规矩,靠加禁令堵不住** ——
> 只能先 `rm` 目标文件,并在 prompt 里写明「该文件不存在,若报告已存在也不要读,直接覆盖」。

> **这三段是实测换来的,别删**(2026-07-21,80 件校准):旧模板只说了「不要读其他文件」,
> 结果 **2/80 越界** —— 一个判官 grep 了 `calibration-manifest.json` 读到植入缺陷描述;
> 另一个读了兄弟评分文件、并用「兄弟件是镜像缺陷」来佐证自己的判定。根因是模板**没告诉
> 判官 `matchId` 找不到时该写什么**,于是它们为了填字段去翻目录,顺手看到了不该看的。
> 「显式给出兜底值」比「禁止某个行为」有效:堵住动机,而不只是宣布规则。
> 两件都已隔离重评。**盲评在 harness 层面守不住,只能靠模板 + 事后自述 + 隔离重评。**

全部一次并行派出。一件一代理——绝不两件进一个代理(它会认出近重复 prompt 并推断扰动)。

## Step 3: 检出率判定

```bash
npx tsx packages/eval/scripts/checkCalibration.ts --run <runId>   # PASS_THRESHOLD 默认 0.8
# 可调环境变量:MIN_PAIRS(默认 4)DELTA_FLOOR(默认 1)SPECIFICITY_TOL(默认 1,整数 rubric 适用——±1 是量化抖动不是缺陷信号;连续 rubric 可降到 0)
```

一件扰动**算检出**要同时过判别效度两关,不只是"降了分":

1. **敏感性** — 目标维度比 none 对照低至少 `DELTA_FLOOR`(阈上降幅,滤掉 judge 噪声/整数打平)。
2. **特异性** — 其余每一维都在 `SPECIFICITY_TOL` 之内不动。否则一个"凡文本变了就全维扣分"的无脑差评判官会白白过关,却对具体缺陷零信号。

写 `judge-calibration/calibration-report.md`,打印逐维检出率;任一维检出 < 80%、或可评对数 < `MIN_PAIRS`(判 INSUFFICIENT)退出码 1(FAIL)。

## 解读

- **PASS** — 这些维度的 judge 分数有信号,A/B Δ 可以当真(仍受样本量约束)。
- **某维 FAIL** — judge 看不见该缺陷类,或对该缺陷是"全维乱扣"而非定向识别:该维的 A/B Δ 不可采信。改 rubric 锚点(`eval-baseline.md`)后**不重建套件**(同种子可控对比),重评(Step 2)、重判(Step 3)。
- **某维 INSUFFICIENT** — 可评对数不足 `MIN_PAIRS`,判别不出结论:提高 `--source-count` 重建套件,或临时降 `MIN_PAIRS`(会削弱跨维合取的统计强度)。
- 每轮 verdict 记入 `$GLADLOG_EVAL_HOME/ledger.md` 的 Judge calibrations 表。

## 注意

- 套件对给定 `--seed` 确定——rubric 改动前后的重评是受控对比。
- 发现真实 judge 失误就给 `buildCalibrationSuite.ts` 加一个新扰动类(每个 judge bug 变成一个植入缺陷)。
- 校准分数是校准产物,不是 eval 结果——绝不混进 run 的 `scores/`。
