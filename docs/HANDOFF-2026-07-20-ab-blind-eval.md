# HANDOFF 2026-07-20 — 盲评 A/B(模型侧验证)续跑

> **给新会话:** 从「立即要做的事」往下照做。所有产物都在盘上,不需要重建任何东西。
> 姊妹文档 `HANDOFF-2026-07-20-prompt-defects.md` 记录被验证的那批修复本身。

## 为什么会有这份交接

上一个会话把 8 类 prompt 缺陷全修了,并用**确定性文本判据**验证(A 26/50→0、
B 14/50→0、C 2/50→0、E/G 4/33→0、D 1/50→0、F 0→86/159 行、H/I 已修)。

但那只证明了 **prompt 内部自洽**,没证明**教练质量变好**。这轮盲评 A/B 是补
第二重证据。上一会话在**子代理配额 200/200 用尽**时停住,盲评只完成 6/100。

## 当前状态

EVAL_HOME = `/Users/mingjianliu/code/gladlog-eval-private`
abId = `2026-07-20-prompt-defects` → `$EVAL_HOME/ab/2026-07-20-prompt-defects/`

| 阶段                              | 状态                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| judge 校准                        | ✅ 40/40,**accuracy 检出 100%**(目标维度),报告见下               |
| 双臂组装 + 预检                   | ✅ fingerprint 一致 `98: be78167b..2faaf381`;98/98 prompt 有差异 |
| control 回复                      | ✅ 50/50(复用 `runs/2026-07-20-smoke`,构建于 `18d5fad`)          |
| treatment 回复                    | ✅ 50/50(构建于全部修复之后)                                     |
| ordinal↔MATCHID 完整性            | ✅ 50/50 全对齐                                                  |
| 盲评池                            | ✅ 100 件 / 50 对 已生成                                         |
| **盲评打分**                      | ⛔ **6/100**(item-01..06 已完成)                                 |
| 解盲统计 / 对比报告 / 台账        | ⬜ 未开始                                                        |
| eval-report 勘误(用户要的第 2 件) | ⬜ 未开始                                                        |

`blind/mapping.json` **从未被读过**。保持这样。

## 立即要做的事

### 0. 先确认配额够

上一会话就是死在这上面。需要 **≥94** 个子代理余量。若不够,先设
`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`(建议 300)再开工,别派到一半再撞墙。

### 1. 补齐 94 件盲评

```bash
AB=/Users/mingjianliu/code/gladlog-eval-private/ab/2026-07-20-prompt-defects
ls "$AB/blind/items"            # 拿 ITEMID(只列目录,不看内容)
ls "$AB/blind/scores"           # 看哪些已完成 —— 只补缺的,别重派 item-01..06
```

对**每个缺分数的 ITEMID** 起一个 **sonnet** 子代理(一件一代理,绝不两件合并):

> You are scoring a WoW arena coaching prompt/response pair.
>
> Read exactly these two files:
>
> - /Users/mingjianliu/code/gladlog-eval-private/ab/2026-07-20-prompt-defects/blind/items/ITEMID/prompt.txt
> - /Users/mingjianliu/code/gladlog-eval-private/ab/2026-07-20-prompt-defects/blind/items/ITEMID/response.txt
>
> Apply the scoring rubric from /Users/mingjianliu/code/gladlog/docs/commands/eval-baseline.md Step 3 exactly — the three-pass process (fact audit -> anchored dimension assessment -> JSON) and the 1/3/5 anchors. There is no quality-report.json for this item — skip the consistency rules that reference it.
>
> Do not read any other file or directory. In particular do NOT read mapping.json, any other item directory, or any scores file.
>
> Write ONLY the score JSON (standard 7-dimension format, factAudit + provenance included) to:
> /Users/mingjianliu/code/gladlog-eval-private/ab/2026-07-20-prompt-defects/blind/scores/ITEMID.json
>
> Your final message should just confirm the file was written — do not summarize the scores.

派完等齐(只用 `ls | wc -l` 判断,**不看分数内容**)。

### 2. 解盲 + 统计

```bash
AB_DIR=/Users/mingjianliu/code/gladlog-eval-private/ab/2026-07-20-prompt-defects \
  npx tsx packages/eval/scripts/abStats.ts
```

输出逐维 Δ均值、SD、95% bootstrap CI、符号检验 p、verdict。

### 3. 对比报告

写 `$AB/comparison-report.md`,结构见 `docs/commands/eval-ab.md` 第 6 步。裁决分工:

- **确定性指标裁决** sufficiency / noise / labelBias
  —— 本轮校准实测 judge 在 sufficiency 上只有 **20%** 检出(删掉整场死亡行,
  5 件里 4 件分数持平或更高),盲评分在这一维**没有裁决权**。
- **盲评统计裁决** accuracy(目标维度,校准 100%)/ outcomeAlignment /
  focusCalibration / inferenceScaffolding。
- 置信区间跨 0 就写 **inconclusive**,不许包装成赢。

### 4. 台账

向 `$EVAL_HOME/ledger.md` 的 A/B cycles 表追加一行(date、commit、改动描述、
目标维度、pairs n、目标 Δ 均值 (95% CI)、verdict、decision)。

### 5. 然后做用户要的第 2 件:eval-report 勘误

`$EVAL_HOME/runs/2026-07-20-smoke/eval-report.md` 里的数字已被推翻,加勘误段:

- A 类:judge 报 31/50,确定性判据实测 **26/50**
- B 类:judge 报 11/50,实测 **14/50**(judge 漏报 3 场)
- 它给出的修复建议**已全部执行**,commit:
  `0e13264`(A+B) `f42fca1`(C) `cd60380`(E/G+H) `be36279`(F) `23de9f5`(I)
  `dbe61bd`(删两档半径) `8f48174`(裸秒时间戳) `c820ad4`(D)
- 附本轮校准结论,尤其 sufficiency 20% 盲区

## 铁律(不可协商)

1. **不读 `blind/mapping.json`** —— 在全部分数写完之前不读,报错也不读,
   「核实一下」也不读。只有 `abStats` 读它。
2. **不读盲件内容、不读 `blind/scores/*.json`** —— 齐全与否只用 `ls` 判断。
3. **编排会话绝不亲自评分。** 若你就是实现这批修复的那个会话,你看一眼 prompt
   就能认出属于哪一臂(A 类同秒 HP、B 类倒置基线、F 类 DR 标注都是显眼特征),
   你打的分是自评不是评测。
4. **不得基于子代理返回的摘要选择性重派或剔除任何一件。** 完成通知里带评分摘要,
   这是唯一能让编排者无意中污染对比的通道 —— 只按「文件在不在」补派。
5. **判分模型固定 sonnet,不要换 agy。** 本轮校准是对 sonnet 做的,换模型则
   校准结论失效;且已落盘的 6 件是 sonnet 打的,混判会毁掉配对统计。
   agy 的位置在**报告写完之后做跨 AI 复核**,那只需一两次调用。

## 本会话踩过的坑

- **子代理配额是硬墙**(200/200),撞上就只能换会话或提配额 —— 开工前先确认。
- **派子代理时 NNN/ITEMID 写错没有任何东西当场挡住**。本会话早些时候把 041 派成
  031,靠事后完整性检查才发现。派完必做核对。
- **聚合前先确认没有在飞的子代理**。本会话早些时候在 judge 还在跑时就发布了数字,
  后到的结果改变了两维均值,只能补勘误。
- **私有仓有非本会话产生的未提交改动**(`runs/tail-recheck/*` 等)——
  **不要 commit 它们**。上一会话曾把用户的本地 commit 卷进 PR 出过事。
- 复合命令里绝不 `cd`;门禁链里绝不加管道(退出码会变成 tail 的)。

## 背景:今天最重要的一条教训

A 类的第一版修复(`3cd5342`)带着一份很有说服力的 commit message 进了 main,
**实测 26/50 → 26/50,一个数都没改**。原因是 `getUnitHpAtTimestamp` 先取最近样本
再用半径决定接受与否,改半径只能把值变成 null,永远不会改变数值;真根因是查询
时刻不在同一渲染网格。是后来建的确定性判据把它抓出来的。

同类事情当天发生了第二次:D 类我判定「非数据不一致,只改图例」,**也是错的** ——
被 A/B 轮次里一个 responder 子代理用反例推翻(见 `c820ad4`)。

> 两条都指向同一件事:**自己实现、自己验证的闭环会漏掉整类错误。**
> 独立判据(确定性检查)和独立评审(盲评子代理)各抓回一个,这就是这轮 A/B
> 值得跑完的理由 —— 即使最后结论是 inconclusive。

## 确定性判据在哪

已固化为常驻门规(`packages/eval/src/quality/promptQualityCheck.ts`,接在
`hardFailures` 上,有单测):

- `checkPercentileMonotonicity` —— 同行百分位必须单调不减(B 类)
- `checkSameSecondHpConsistency` —— 同秒同单位 HP 必须一致,容忍 3pp(A + C 类)
- `checkWindowSpanConsistency` —— 标注时长必须等于显示起止之差(E/G 类)

D 类的检测器(MISSED OPTIONS 声称可用 vs 台账列在 cd:)**尚未固化**,上一会话
只写在 scratchpad 里,已随会话失效。若要防回归,值得照上面三条的样子补一个。

复现任意判据的方法:

```bash
npx tsx packages/eval/scripts/buildCorpus.ts \
  --manifest <50 条日志清单> --run <runId>
# 然后对 runs/<runId>/prompts 跑判据
```
