# 接管指令 —— 2026-07-21

**给接手这份工作的会话。** 从这里开始你全权接管,不用回来问我上一轮做了什么。
读完这份 + 它引用的两份文档就够了,**别去翻旧会话记录**。

---

## 0. 先做三件事(不做会踩坑)

1. **确认子代理额度生效**:`echo $CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` 应输出 `2000`。
   已写进 `~/.claude/settings.json` 的 `env` 块,但**只在新会话生效**。若输出为空,
   说明你还在旧进程里,重开会话。上一轮就是撞满 200 才停的。
2. **读 `CLAUDE.md`** —— 两条铁律(门规谓词即规范、修复要给前后数字)不是建议,
   是这个项目付过代价换来的。下面的任务全部按这两条验收。
3. **`git log --oneline -8`** 看一眼,`main` 是干净的,直接 commit + push 到 main,
   不建分支不开 PR(见 memory `gladlog-commit-workflow`)。

---

## 1. ~~唯一的硬待办:测第三轮 rubric 改动~~ ✅ 已做完(2026-07-21)

> **结果在 `docs/reports/2026-07-21-judge-variance-v3.md`(提交 `277e80d`)。**
> 30 件补齐,判据固化成 `packages/eval/scripts/judgeVariance.ts`(`4ded221`)。
> 一句话:登记判据 accuracy 极差 1.00 → 0.80 → **0.50**,但赢的不是「判官更一致」——
> 锚点应用噪声清零(30/30 确定映射)、查证检出三倍(6 → 11 → **21**),
> 而判官实质分歧(errCount 极差)0.50 → 0.30 → **0.50**,回到 v1。
> 附带:noise 维 60% FAIL → **90% PASS**,证实它的 FAIL 是 accuracy 方差的投影。
> **下一步待拍板**:另五维的 50 件没在 v3 下重评,5/7 目前是假设不是测量,
> Layer B 还不能开跑。报告 §6 有建议。
>
> 下面是原始任务描述,留档。

**这是上一轮唯一没做完的事,卡在子代理额度,现在额度有了。**

完整背景在 **`docs/HANDOFF-2026-07-20-judge-variance.md`**,那份文档是准确的,照做即可。
浓缩版:

- Layer B 判分要求 7 维里 5 维通过,现在 **4/7**。
- 两个真阻塞:accuracy 判官间方差 ±2(把 noise/labelBias 的特异性一起拖挂),
  以及 sufficiency 真盲区(删光死亡行判官不扣分,三次独立测量都复现)。
- 已落地但**未验证**的改动是 `3d92ba3`(accuracy 锚点改查表 + 含数字的主张必须写
  `回复:X | prompt:Y`)。
- **怎么测**:重评 30 件(10 源 × `{none, severity-labels, duplicated-noise}`)到
  `scores-det2/`,**已有 5 件**(case-01/06/08/13/14),补完剩下 25 件。
- **判据已预先登记,不许改**:每源三件的 accuracy 极差,取均值/最大/≥2 的源数。
  基线 v1 = 1.00,v2 = 0.80。

### ⚠ 读数陷阱(必看,不看会得出错误结论)

查表锚点把「恰 1 处小错」从 3 分改成 4 分。**极差下降不等于方差下降** —— 已回来的
5 件里四件从 3 变 4,纯粹是映射上移,判官的实质分歧一点没变。

**所以主判据应该是「判官找到的错误集合是否一致」**(`factAudit` 里 verdict ∈
refuted/unsupported 的条目),极差降为辅助判据。`HANDOFF-2026-07-20` §3 有详细拆解,
以及已经做完的机制拆分((a) 查证漏检 vs (b) 锚点映射,主因是 (a))。

### 还有两条流程铁律

- **子代理写完文件后还会校验重写**。必须**连跑两次 `checkCalibration` 拿到相同哈希**
  再用数字,否则你会读到半成品(上一轮第一次判 v2 时三次输出各不相同)。
- **改判官流程时,凡有脚本在校验该流程产物的,必须同一提交里一起改**。上一轮改了
  PASS 1 审计集大小却没同步 `checkScoreProvenance.ts` 的长度约定,自伤一次。

---

## 2. 等我拍板的两个产品决定(**别自己定**)

上一轮做证据缺口普查,五项里三项修完/结案,**两项卡在产品判断上,我没醒着,
所以刻意没动**。你也别动,除非我明确说了怎么办。完整数字在
**`docs/reports/2026-07-21-evidence-gap-survey.md` §6.5**。

### 决定一:敌方 trinket「没观察到使用」该不该推成「可用」

友方路径把「没用过」当可用,敌方路径判成「未知」—— 同一个不对称。竞技场开局冷却
重置,按理该推成可用。但:

```
[OPPORTUNITY] 共 1491 行
  靠「状态未知」支撑的  1424 行 = 95.5%
```

**修了会删掉这一整段的 95%**,方向跟我「证据太少」的抱怨相反。反过来说,如果推断
成立,那 1424 行是在暗示一个不存在的机会 —— 比缺证据更糟。`[CONTESTED]` 同根。

**这题的关键不是代码,是「竞技场开局饰品是否一定就绪」这个游戏事实。** 我来定。

### 决定二:常驻增益(HoT / 护盾)要不要纳入漏驱散

实测放开这一类:**103 → 892 行(8.7×)**,其中 59% 是 Wild Growth 201、
Enveloping Mist 112、回春 82、激流 80、生命绽放 52 这种一直挂着的。跟一个治疗说
201 次「你没驱散对面的回春」是噪声,不是证据。

但有几条**离散主动 CD** 明显该进而没进:Blessing of Sanctuary、Innervate、
Nether Ward、Time Stop、Tip the Scales、Nature's Swiftness、Spiritwalker's Grace。
这几条跟已在白名单里的(Power Infusion、Combustion、Alter Time)是同一类。

**我倾向只加离散主动 CD、不加常驻增益,但要我确认过再动。**

---

## 3. 已经结案的,别重做

| 项                            | 状态                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| 敌方大冷却 `none tracked` 65% | ✅ `bf17ccf`,805/1245 → 1/1245,0 丢失 +15073 新增                                |
| 漏驱散白名单 9 条 7 条是死的  | ✅ `2f1954c`,822 → 2251 行,门规全量绿                                            |
| `[KILL WINDOW]` 上限 6        | ❌ 不用改,595 个省略窗口全有 rollup 兜底                                         |
| POSITIONING 缺 34%            | ❌ 不是 bug,`CLOSE_RANGE_YARDS=12` 只分类开场贴脸的 owner;治疗拉开距离是正确打法 |
| Layer A 全语料审计            | ✅ 三道门全绿 @ `92f96d2`,后续每次改动都复跑过                                   |
| v0.0.16                       | ✅ 已发布,四资产齐                                                               |

**`docs/reports/2026-07-21-evidence-gap-survey.md` §4 有一张「看起来坏了其实没坏」的表**,
五条,全是我差点误报的。开工前扫一眼,能省你几个小时。

---

## 4. 这个项目会咬人的地方

- **别按记忆猜段落表头字符串去量覆盖率。** 上一轮五次里错了五次(`KILL SEQUENCE`
  实际有 250/1245,我加了方括号搜成 0)。**要么核对 emitter 源码字面量,要么从语料反向提取。**
- **别从一例确认外推整类。** 上一轮在 ord 181 确认了一例真矛盾就说「8 场全真」,
  逐条核归属后发现 **6/9 是门规自己错**。先怀疑 checker。
- **修完只看 headline 数字会带着隐形回归上线。** P1 首版把 `972 → 1` 修得很漂亮,
  逐条对**内容**才发现丢了 1418 条进攻 CD(替换而非并集)。**每次都要做「丢了什么」的守恒检查。**
- **`npm test --workspace=packages/analysis`**,不要在根目录 `npx vitest run packages/analysis`
  —— globals 配置不生效,58 个文件全报 `describe is not defined`,是假失败。
- **类型检查用 `npm run typecheck`**,绝不 `tsc -b`(会往 src 吐 .js)。
- **`ls` 大目录会刷屏**(runs/*/manifests 有 1245 个文件),用 `| wc -l`。

## 5. 常用命令

```bash
# 建语料(10 日志 ≈ 211 场,约 1 分钟;全量 70 日志 = 1245 场,约 15 分钟,建议后台跑)
npx tsx packages/eval/scripts/buildCorpus.ts --manifest <manifest> --run <runId>

# Layer A 三道门(每次改分析代码后全跑)
node "$GLADLOG_EVAL_HOME/audit/layerAAudit.mjs" "$GLADLOG_EVAL_HOME/runs/<runId>"
BASE_DIR=$GLADLOG_EVAL_HOME/runs/<runId> MANIFEST=<manifest> npx tsx packages/eval/scripts/positioningScan.ts
npx tsx packages/eval/scripts/qualityCheck.ts --run <runId>
```

`$GLADLOG_EVAL_HOME` 默认 `~/code/gladlog-eval-private`,全量 manifest 在
`$GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt`。

---

## 6. 你的优先级

1. **§1 的判官方差验证** —— 这是唯一挡着 Layer B 的东西,额度也是为它提的。
2. 做完等我对 §2 两个决定拍板。
3. 中间**别开新战线**。普查已经把该查的查完了,§3 那张表就是边界。
