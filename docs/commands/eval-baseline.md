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
> ACCURACY DISCIPLINE (mandatory): before finalizing, re-verify every specific claim you
> make — each timestamp, count, HP value, cooldown state, and causal attribution — against
> the exact line(s) of the match prompt. If you cannot point to a specific prompt line
> supporting a detail, remove or soften it. Never harden ambiguous log annotations (e.g.
> "ended early — absorbed, dispelled, or cancelled") into one specific cause. When counting
> events (stuns, casts, spikes), recount from the timeline rather than from memory.
>
> FOCUS DISCIPLINE: structure the response around the 2-3 windows that actually
> decided the match; give each secondary observation at most one line, and label
> minor items as minor. Do not let "what went right" match the decisive analysis
> in length.
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

**PASS 1 — 事实审计(先于任何打分):** 审计集**由规则确定,不由你挑**——

1. 按回复正文出现顺序,取**全部**包含 `M:SS` 形式时间戳的断言句(上限 12 条;超出则取前 12 条)。
2. 若不足 3 条,按出现顺序补入含百分比或伤害数字的断言句,凑满 3 条。
3. 纯建议句(「下次早点交」)不是断言,不入集;含时间戳的建议句按其断言部分入集。

逐条找到证明或证伪它的确切 prompt 行,原文引用记入 `factAudit`。找不到支持行的主张 = 捏造。

**`accuracy` 只按这个集合打分。** 集合外发现的问题写进 `notes`,但**不影响分数**。

> **为什么不让你自选**(2026-07-20 实测,n=10 校准套件):旧规则是「自选最承重的 3 条」。
> 同一份回复、同一份可查证内容被三个独立判官读三遍,accuracy 极差均值 1.00、最大 2,
> 10 个源里 4 个极差 ≥2。逐案查:每个给低分的判官都审计到了一条高分判官**没审计的**
> 主张,而那些错误在回复原文里本来就存在。另有判官在规定的 3 条**之外**自愿多查而扣分。
> 结果是 accuracy 测的不是「回复有多准」,而是「判官找得有多勤」——同一份回复的分数
> 取决于抽样运气,判官间方差 ±2 结构性超过特异性容差 ±1,`noise`/`labelBias` 的校准
> 失败几乎全由此而来。确定性审计集把 accuracy 从抽签变回测量。

**PASS 2 — 锚定维度评估:** 7 维每维先写一句证据,再按下方锚点选分。`quality-report.json` 有实测值的维度,分数必须与实测一致(规则内联)并引用数字。

**维度独立性(判别效度,强制):** 7 维各自独立打分,只按本维定义评判。某一维的缺陷绝不下拉其它维——具体:捏造/无支持主张只压 `accuracy`;重复/冗余行只压 `noise`;加载严重度标签只压 `labelBias`;事件乱序只压 `inferenceScaffolding`;缺失关键数据块(死亡/CD/CC)只压 `sufficiency`;与赛果矛盾的开场/收尾框架只压 `outcomeAlignment`(仅当该框架同时把某条真实事件说反才另计 `accuracy`,并在 factAudit 指名该主张);琐事挤占定胜负时刻只压 `focusCalibration`。**定稿前自检:若你压低了不止一维,必须为每一维给出各自独立、维度专属的证据;给不出专属理由的维度,回填到未扰动版本应得的分。** 整体"这份看起来更差/更好"的印象不是任何单维加减分的依据——判别效度要求每个分数只反映它自己那一维。

**accuracy 的三条操作判据(实测校准补充):** 上面那条规则说了「只压哪一维」,但没说**遇到具体情形怎么办** —— 2026-07-20 全语料校准实测,判官不是明知故犯地违反独立性,而是真以为自己发现了事实错误。三种情形逐条给判据:

1. **查证按内容,不按顺序。** 支撑某条主张的 prompt 行只要**存在于文中任何位置**,该主张即 `verified` —— 它出现在哪一行、与其它行的先后如何,一律不影响。prompt 事件乱序**永远不能**把主张判成 `refuted`;找起来费劲本身是 `inferenceScaffolding` 的缺陷,与 `accuracy` 无关。标 `refuted` 前先全文搜一遍关键词,别因为"该在的地方没有"就下结论。
2. **泛泛建议不是事实主张。** 与本场日志无关的通用教学内容(站位、按键、宏、视角)不断言这一场发生过什么,因此**不可能**构成 `accuracy` 缺陷 —— 无论它占了多大篇幅。篇幅挤占定胜负分析是 `focusCalibration` 的事。
3. **赛果框架先问「有没有指名具体事件」。** 「a well-earned victory」这类开场/收尾框架与 `Result:` 矛盾时,只压 `outcomeAlignment`。判据是:**这句话有没有断言某个具体的场内事件,而日志说的相反?** 没有指名具体事件 → 纯框架问题,`accuracy` 不动。有 → 在 `factAudit` 里指名该主张,才另计 `accuracy`。

这三条是从实测渗漏反推出来的,不是理论洁癖:该轮 10 条特异性违规里 8 条是 `accuracy 5→3`,分别来自乱序、琐事段、赛果反转三类扰动 —— 全部属于上面三种情形。

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

7 个数值分全部为 1–5 整数。`factAudit` 记录 PASS 1 **规则集的全部条目,不许截断**(合法长度 3–12,正好对应该规则的下限与上限);`verdict` ∈ `verified` / `refuted` / `unsupported`。`provenance` 每份必填:hash 用 `shasum -a 256 <prompt 文件> <response 文件>` 在**完整读过这两个文件之后**计算;绝不给不是本轮评的分数文件回填溯源。

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
