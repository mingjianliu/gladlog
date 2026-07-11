# eval-baseline — 基线评测工作流

评估 healer 竞技场 prompt 与 AI 回复质量(10–50 场),产出跨场质量报告。四步管线,全程本会话内完成(无外部 API)。

> **三条 eval 工作流,选对的用:**
>
> - **本工作流** 评估 prompt/回复质量现状,找出下一个要修的东西。
> - **`/eval-ab`**(`docs/commands/eval-ab.md`)验证某个 _prompt 构建器代码_ 改动是否真的提升了分数(同语料受控 A/B)。
> - **`/calibrate-judge`** 在信任 judge 分数之前先校准 judge。

所有产物落在私有 eval 仓(`$GLADLOG_EVAL_HOME`,默认 `~/code/gladlog-eval-private`;首次使用先跑 `npx tsx packages/eval/scripts/init.ts`)。run 目录 = `$GLADLOG_EVAL_HOME/runs/<runId>`(runId 建议 `YYYY-MM-DD-<slug>`)。

## 参数处理

- `/eval-baseline <runId>` 且该 run 目录已有 `prompts/` + `index.json` → **复用模式**:跳过 Step 1 的语料构建(用于测 rubric 漂移:同一批旧 prompt 重新评)。
- `/eval-baseline`(无参数)→ **新建模式**:runId 取 `YYYY-MM-DD-baseline`,从 Step 1 开始。

## Step 1: 构建语料(新建模式)

日志清单在 `$GLADLOG_EVAL_HOME/corpus/manifest.txt`(每行一个本地 WoWCombatLog 路径)。若不存在,中止并提示用户先准备清单。

```bash
npx tsx packages/eval/scripts/buildCorpus.ts --manifest "$GLADLOG_EVAL_HOME/corpus/manifest.txt" --run <runId>
```

非零退出即中止。完成后确认 `runs/<runId>/index.json` 存在并读取条目列表(每条:`ordinal`、`file`、`matchId`、`spec`、`result`)。构建器同时写覆盖清单 `manifests/NNN.json`。

然后跑确定性质量检查并读输出:

```bash
BASE_DIR="$GLADLOG_EVAL_HOME/runs/<runId>" npx tsx packages/eval/scripts/qualityCheck.ts
```

写出 `runs/<runId>/quality-report.json`(逐场覆盖率:友方死亡/CC/踢断/驱散/饰品;噪声比;偏向词命中)。Step 3 的 judge **必须**用这些实测数字锚定 sufficiency/noise/labelBias,不许目测。

## Step 2: 生成回复(并行子代理)

> **执行模型:** 用会话内 Agent 工具起子代理;无外部 API key、不新建脚本。没有 Agent 工具就自己逐场生成——你就是 AI,不要写调用外部 API 的包装脚本。

对 index 每条,起一个**后台子代理**(prompt 自包含,逐项代入实际值):

> You are a WoW arena coach. Your task is to produce coaching advice for a healer player based on a match log.
>
> Read the match prompt from this file:
> `$GLADLOG_EVAL_HOME/runs/<runId>/prompts/FILENAME`
>
> Produce coaching advice for the healer. Focus on:
>
> - What went wrong or right in this match
> - Specific decisions that affected the outcome
> - Concrete adjustments for next time
>
> Write your coaching response to:
> `$GLADLOG_EVAL_HOME/runs/<runId>/responses/NNN.txt`
>
> The FIRST line of the file must be exactly `MATCHID: <matchId>`, followed by a blank line, then the coaching response and nothing else — no preamble, no meta-commentary. Create the `responses/` directory if it does not exist.

全部一次并行派出。收齐完成通知后核对回复文件;缺的记下 ordinal 继续,不中止。

**Ordinal 完整性检查:** 每个回复文件的 `MATCHID:` 头必须等于同 ordinal index 条目的 matchId。不符 = 文件错位 bug(上游发生过 063/064 事故):两个 ordinal 都剔除评分并上报。给 judge 看之前剥掉头行。

## Step 3: 逐场评分(三遍法 + 锚定 rubric)

对每个有回复的条目:读 prompt、读回复(核对并剥 `MATCHID:` 头)、记下 `result`、读该场 `quality-report.json` 条目。评分写 `runs/<runId>/scores/NNN.json`。

### 三遍法(顺序强制)

**PASS 1 — 事实审计(先于任何打分):** 找出回复中最承重的 3 条主张(法术施放、时间戳、死因)。逐条找到证明或证伪它的确切 prompt 行,原文引用记入 `factAudit`。找不到支持行的主张 = 捏造。

**PASS 2 — 锚定维度评估:** 7 维每维先写一句证据,再按下方锚点选分。`quality-report.json` 有实测值的维度,分数必须与实测一致(规则内联)并引用数字。

**PASS 3 — 生成 JSON:** 只在 1–2 遍完成后写分数文件。

### Rubric(锚定 1 / 3 / 5;2、4 用于居间)

**Prompt 质量:**

- **sufficiency** — 判断胜负手所需的数据是否在场?
  - 5: CC 链带时长、dampening 进程、敌方大 CD、HP 上下文俱全。
  - 3: 恰缺一个关键块(如有 CC 无 dampening 进程)。
  - 1: 大段缺失(无 CD 使用、无 CC 时序)。
  - 一致性规则: quality-report 显示该场有友方死亡缺失 → sufficiency ≤ 2;任一覆盖类(cc/kicks/dispels)< 80% → sufficiency ≤ 3。

- **noise** — 冗余行是否稀释注意力?
  - 5: 无重复状态/触发刷屏;每行都是状态变化。
  - 3: 约 10–30% 行为重复/未变状态。
  - 1: 时间轴 >50% 是刷屏或重复。
  - 一致性规则: 按该场实测 `exactDuplicateRatio` / `resReadySpamLines` 打分并在证据句引用数字,不许凭印象。

- **labelBias** — 标签是否在推理前就带节奏?
  - 5: 中性标题;严重度标记只出现在数据支持处(真实的 25% 以下 HP 骤降)。
  - 3: 轻度引导(普通 50% HP 下探被标 "spike")。
  - 1: 普通事件挂加载语言("disastrous"、小换血挂 `[CRITICAL]`)。
  - 一致性规则: 实测偏向词命中为 0 → labelBias ≥ 4,除非能引用词典漏掉的具体偏向表述。

- **inferenceScaffolding** — 因果能否从结构直接读出?
  - 5: 时序正确;死亡/饰品与触发它的伤害/CC 同址。
  - 3: 时序正确但触发与反应被填充行隔开。
  - 1: 事件乱序或触发与结果脱节。

**回复质量:**

- **accuracy** — 回复是否只引用 prompt 里存在的事件?
  - 5: PASS-1 主张全部验证;零事实错误。
  - 3: 1–2 处小错(时间戳差几秒、次要触发认错名)。
  - 1: 捏造法术/窗口/死亡,或给已死/不在场玩家提建议。
  - F193 条款:锚定 `[CONTESTED]` 行、保持试探措辞(≤Medium 置信,不下断言)的换血权衡讨论**不算**捏造或 unsupported——该行本身就是 prompt 事实;只有当回复把它硬化成结论("你当时就该 CC")或脱离锚点自造场景时才扣分。

- **outcomeAlignment** — 教练意见是否解释了实际赛果?
  - 5: 指出决定比赛的因果序列。
  - 3: 提到结果但归因于泛泛之谈。
  - 1: 无视或反着说结果。(result=Unknown:按是否抓住关键转折点评。)

- **focusCalibration** — 是否优先最高杠杆时刻?
  - 5: 2–3 个定胜负窗口主导全文。
  - 3: 找对时刻但琐事平分篇幅。
  - 1: 无视定胜负时刻、纠缠细枝末节。

### 分数文件格式(score 契约,校验器强制)

```json
{
  "ordinal": 1,
  "matchId": "abc12345",
  "spec": "Holy Priest",
  "result": "Loss",
  "factAudit": [
    {
      "claim": "回复中承重主张的原文引用。",
      "verdict": "verified",
      "evidence": "证明/证伪它的确切 prompt 行(含时间戳);找不到写 'no supporting line found'。"
    }
  ],
  "prompt": {
    "sufficiency": 3,
    "noise": 4,
    "labelBias": 2,
    "inferenceScaffolding": 3,
    "notes": "一句话点出关键 prompt 质量问题,能引用 quality-report 数字就引用。"
  },
  "response": {
    "accuracy": 5,
    "outcomeAlignment": 2,
    "focusCalibration": 3,
    "notes": "一句话点出关键回复质量问题。"
  },
  "provenance": {
    "judgeModel": "<实际评分模型>",
    "judgedAt": "<ISO 时间戳>",
    "promptSha256": "…",
    "responseSha256": "…"
  }
}
```

7 个数值分全部为 1–5 整数。`factAudit` 恰 3 条,`verdict` ∈ `verified` / `refuted` / `unsupported`。`provenance` 每份必填:hash 用 `shasum -a 256 <prompt 文件> <response 文件>` 在**完整读过这两个文件之后**计算;绝不给不是本轮评的分数文件回填溯源。

评分全部写完后跑严格校验(任一文件不合格 = 整个 run 作废,修复后重评):

```bash
BASE_DIR="$GLADLOG_EVAL_HOME/runs/<runId>" npx tsx packages/eval/scripts/checkProvenance.ts
```

## Step 4: 汇总报告

读全部 `scores/*.json`,写 `runs/<runId>/eval-report.md`:

```markdown
# Healer Eval Report

**Run date:** YYYY-MM-DD
**Run:** <runId> | **Corpus fingerprint:** <fingerprint.txt 内容>
**Matches evaluated:** N
**Spec distribution:** …

## Aggregate Scores

| Dimension  | Min | Max | Avg | % ≤ 2 (flagged) |
| ---------- | --- | --- | --- | --------------- |
| (7 维逐行) |

## Flagged Matches(任一维 ≤ 2)

### NNN — Spec Win|Loss (matchId)

- **[dimension]**: score — (notes 一句话)

## Cross-Spec Patterns

各 healer spec(≥2 场)逐维均分;某 spec 某维 ≤ 2.5 高亮。

## Top 3 Issues

按 (维度 ≤2 的场数) × (5 − 均分) 排序,各附共性模式描述。

## Recommendations

对 Top 3 各给一条具体建议:该查/该改 `buildMatchContext`(`packages/analysis/src/context/`)或哪个分析 util 的哪个段落。
```

写完报告,向 `$GLADLOG_EVAL_HOME/ledger.md` 的 Baseline evals 表**追加一行**(date、gladlog commit、corpus fingerprint、7 维 mean±SD、hard-failure 数、notes)。分数文件会被覆盖——台账行是这次 run 唯一的持久记录,绝不跳过。

## 注意

- 全管线无外部依赖、无 API key;不新建 `.ts`/`.js` 文件、不改源码。
- index 超 50 条只评前 50。
- 分数文件可覆盖旧 run 产物。
