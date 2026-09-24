# gladlog 可验证性路线图

[English](verifiability-roadmap.md) · **中文**

**目标:** 让 gladlog 的每一层都**可验证** —— 输出可被证明地回溯到可验证的输入,
端到端贯通:原始日志 → 解析 → 分析 → AI prompt/输出 → UI → 导出。PROMPT 这一柱
已经在强制执行这条纪律(「每条断言都锚定在真实事件上」);本路线图把同一套纪律
延伸到 LOG 与 VISION,让整个应用成为一条由可锚定、可独立复核的变换串成的链。

**两类受众 —— 不只是 CI。** 这些检查服务于两个目的,第二个和第一个一样重要:

1. **CI / 回归门** —— 抓住随时间发生的破坏。
2. **跨 agent 验证与反馈** —— 让一个 agent 能客观检查另一个 agent 的工作、并交回
   **有据可依、可执行**的反馈的基底。gladlog 本身就是这么造出来的(agy/Gemini 实现
   → Claude 用确定性门验证;Claude 写 → agy 复核;eval 工具链里的 LLM 判官本质上
   就是一个 agent 在给另一个 agent 打分)。一项检查只有满足这两点才对此有用:agent
   能**无头运行**它,并读到**可读的 diff**(「字段 X 在 Z 处与来源 Y 分叉」)——
   修复方能据此动手,复核方能据此再确认。每项检查都要按 产出 → 验证 → 反馈 这个
   环的基元来设计,而不只是一盏红绿灯。

这是一份**路线图**,不是 spec。下面每个子项目在被拾起时,各自走一遍
brainstorm → spec → plan → 实现 的循环。

## 现状(2026-07-24:除 F170 外路线图已完成)

| 支柱       | 现状                                                                                                                                                                                                        | 判定                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **PROMPT** | 3 道诚实性门(`auditFindings` 的锚定/数值/因果、`causalLint`、`claimChecker` + 模板插值)+ 12 件工具的 eval 工具链(盲 A/B、校准、provenance、`positioningScan`、`contestedContract`)                          | 强 —— 是另两柱的参照标准             |
| **LOG**    | 13 个 parser 测试文件、golden fixture 测试、log-pipeline 字节精确重建、**A1 差分预言机**(2026-07-13)、**A2 不变量**(6 个 code,全语料 0/1245 违规)+ **A3 覆盖语料**(2026-07-23)                              | 强 —— 预言机 + 内禀不变量 + 策展覆盖 |
| **VISION** | **C1 数据忠实性**(2026-07-12)+ **C2 视觉回归**(Playwright 7 场景 + axe + E2E + 性能预算,2026-07-19)+ **C3 Markdown 导出保真**(导出与渲染共享同一 derive)+ **图片导出**(离屏同 renderer 整页截图,2026-07-24) | 强 —— 三个面全部落地                 |

## 指导原则

一个变换**可验证**,当且仅当:(1) 它的输出是具名、可检视输入的纯函数;(2) 有自动
检查能证明输出与这些输入自洽;(3) 失败是可读的(说清哪里分叉、分叉在何处);
(4) 该检查**可无头运行并产出机器可读的 diff**,使得 agent —— 而不只是 CI ——
能调用它、依据结果动手,并让另一个 agent 再确认。PROMPT 通过锚定 + claim 检查
做到了这点,LOG 与 VISION 也应如此。

---

## 支柱 A —— LOG(解析)可验证性

证明 parser 把原始战斗日志变成了正确的结构化对局。

- **A1. 差分预言机** ✅ _(2026-07-13 完成)_ —— 私有仓(`~/code/gladlog-eval-private/oracle/`)
  里一道常驻、可复跑的 parity 门,在真实日志上比对旧 fork parser 与新 parser:
  Level-1 核心事实(阵容/专精/队伍/结果/死亡/伤害+治疗总量,伤害与治疗按每场总量
  对照 M4 锚定的包络检验)+ Level-2 prompt 标记类的存在性(语料级,能抓住整块分析
  被丢掉的情况 —— R1/R3 类)。用死亡签名 LCS 对齐;salvage(新侧的 shuffle/掉线
  恢复)逐条裁决。产出机器可读的 `report.json`,任何新的未裁决 diff 都以非零退出;
  `npm run verify:parser-oracle`(没有私有仓时跳过 —— 绝不进公共 CI)。洁净室:
  只有 `runOld.ts` 碰旧 fork,输出 JSON 供预言机消费。首跑:子集 3696 → 0 未裁决,
  并且真的挖出一条 finding(见 backlog:新的 `[ENEMY HARD CAST]` 比旧的窄)。
  规格 `docs/specs/2026-07-13-parser-differential-oracle-design.md`。
- **A2. 不变量 / 属性测试** ✅ _(2026-07-23 完成,release/0.1)_ ——
  `packages/parser/src/invariants.ts` 的 `checkParserInvariants`:六个 code
  (time-bounds / monotonic / hp-range / death-has-damage / pet-owner-resolves /
  start-before-end),边界**先实测再锁定**,基准是 1245 场语料(第一轮扫描用朴素
  边界得到 1021/1245 违规 → 实测真实分布:单调性最大回退 2084 ms → 容差 5 s;
  hp/maxHp 最大 1.582 → 上界 1.75×;shuffle 轮尾部 ≤34.1 s → 宽限 60 s)→
  **复扫 0/1245**。对合成生成器做了单测(不变量自己就抓到它撒谎:受害者死亡时
  damageIn 为零 —— 生成器已修)+ 语料扫描门 `packages/eval/scripts/parserInvariants.ts`
  (有任何违规即 exit 1)。
- **A3. Fixture 覆盖语料** ✅ _(2026-07-23 完成,release/0.1)_ ——
  `packages/eval/scripts/coverageCorpus.ts`:对覆盖事实(7 个治疗专精 × 3 个赛制 ×
  crlf/宠物/shuffle/濒死 等边角)做贪心集覆盖,从 1245 场语料里挑出最小清单;写出
  eval-private 的 `corpus/manifest-coverage.txt` + `coverage-report.json`;
  `--check` 模式检测漂移(哪些事实不再被覆盖),供常驻复跑。

## 支柱 B —— PROMPT(LLM)可验证性

本来就强;把已知的洞补上。

- **B1. LLM 判官因果审计(SP-A.1)** ✅ _(2026-07-23 完成,release/0.1)_ ——
  新增校准扰动类 **causal-hardening**(`buildCalibrationSuite.ts` 的 `hardenCausation`:
  从回复里取两个真实时刻,焊成一条无支撑的「直接导致……没有其他因素参与」的因果链)。
  在 20 对上做受控 v1→v2 测量(10 对被硬化),sonnet 判官,provenance 已验证
  (20/20 的 prompt+response 哈希与未改动输入一致),报告哈希双跑稳定:
  **v1 检出 5/10 = 50% FAIL** → 两处修复 ——(1)
  `COUPLED_BY_CONSTRUCTION["causal-hardening"]=["outcomeAlignment"]`(注入的那句
  本身就是一个结果判词;判官的备注点了名,逐例证据在 `checkCalibration.ts` 里),
  (2) `docs/commands/eval-baseline.md` 里 rubric PASS-1 的第 5 条(带因果连接词的
  断言必须进审计集;时间上相邻 ≠ 因果支撑;没有日志支撑的「没有其他因素」排他性
  = 无支撑)→ **v2 检出 8/10 = 80% PASS**(阈值 0.8;剩下 2 个漏检纯属灵敏度噪声:
  一个 2→2 无变化,一个 3→4 反向)。产物:eval-private 的 `runs/2026-07-23-causal/`
  (v1 报告归档为 `calibration-report-v1.md`)。
- **B2. 完整 provenance 追溯** ✅ _(2026-07-23 完成,release/0.1 —— 事件级)_ ——
  应用内的 finding → 候选事件 → 原始事件深链:FindingsList 的「⛏ 原始事件」锚定在
  最早的证据事件上,并驱动 EventsPanel 进入 ±窗口 + 单位过滤(`inspectReq` prop,
  nonce 消费式);事件视图为任意 finding 渲染其底层的已解析事件。导出(C3)把同一条
  链带进 Markdown。**原始行级(2026-07-24 补齐):** 分段器给每条 ParsedLine 记
  `lineIndex`(records/rawLines 同步推进的唯一对齐点),L3 事件与 compat `ILogLine`
  透传,doc 原样携带;`matchStore.rawLine` 按 shuffle 前序轮 linesTotal 累加偏移读
  raw.txt;事件视图逐行「㏒」展开原始日志行。门规:A2 新增 `line-resolves` 不变量
  (事件必带 lineIndex 且重解析后 eventName/timestamp 一致),全语料 **0/1245**。
  旧档无 lineIndex → UI 降级隐藏。
- **B3. 容错解析 + eval 覆盖** ✅ _(2026-07-24 完成,release/0.1)_ ——
  容错解析半边 2026-07-20 已单源落地(`parseModelJsonArray`,eval 三个审计脚本与
  产品 `analysis.ts` 同谓词);eval 覆盖半边:`/eval-baseline` Step 1 改为**优先消费
  A3 覆盖清单** `corpus/manifest-coverage.txt`(贪心集覆盖保证 7 治疗专精 × 3 个赛制 ×
  4 边角在场,先 `coverageCorpus.ts --check` 验漂移),`manifest.txt` 仅作复现旧口径
  的回退。

## 支柱 C —— VISION(UI)可验证性 _(用户拍板:三个面全做)_

最弱的一柱;把 UI 做到和 LLM 输出一样诚实。

- **C1. 数据忠实性(UI 不能撒谎)** ✅ _(2026-07-12 完成)_ —— 最切题的内核。渲染
  数学被抽成纯的、有测试的 selector(`report/derive/meterRows`、`timelineMarks`、
  `cohortDims`;时间线色带与 `timelineMarks` 已于 2026-09-24 作为死代码删除);
  meters/cohort/timeline 组件退化成哑渲染器。
  `report/derive/faithfulness.ts` 的 `checkFaithful(kind, root, selectorOutput)`
  遍历渲染出的 DOM,对以下两类产出 `Divergence[]`:(A) 视图忠实性不匹配(渲染值 ≠
  selector 值,含 tooltip 与非百分比单位),(B) 非循环的结构不变量(meter 的
  值域/单调/max-100/格式往返;cohort 百分位与 p10/p90 的次序自洽;timeline 的
  边界/leftpct/能映射回事件)。它**刻意不**重算聚合与百分位(会在宠物上误报 /
  会变成循环论证 —— agy 辩论结论)。每项检查都有一个证明其有牙齿的测试;
  `npm run verify:vision` 无头运行、打印 JSON diff、非零退出。规格
  `docs/specs/2026-07-12-vision-data-faithfulness-design.md`,方案
  `docs/superpowers/plans/2026-07-12-vision-data-faithfulness.md`。
- **C2. 视觉回归** ✅ _(2026-07-19 完成)_ —— Playwright 截图 7 个 URL 可直达的场景
  (战报/回放/AI/对比/仪表盘/设置/列表),基线是 **linux 单源**、由 CI 生成与判定、
  由人审后提交;同一批加载顺带跑 axe(WCAG 2.1 AA,违规必须 ⊆ 显式豁免清单)。
  附带落地:`_electron` 驱动的 E2E 三条核心链路(导入→报告 / 证据链跳转 /
  教练闭环+重启持久化),以及 measure-then-lock 的三项性能预算(解析/首渲/冷启动)。
  规格 `docs/superpowers/specs/2026-07-19-frontend-qa-design.md`。
- **C3. 导出保真** ✅ _(2026-07-23 完成,release/0.1 —— Markdown)_ ——
  `report/derive/exportReport.ts` 的 `buildReportMarkdown` 用**与 UI 渲染所用的同一批
  derive 函数**(kickDash / dispelDash / auraUptime / mistakes / statsTable …)构建
  「复制 Markdown」,所以导出的数字 == 渲染的数字是构造保证(共享谓词规则,不是
  比对);往返测试在真实 fixture 上断言导出值与 derive 输出一致。**图片(2026-07-24
  补齐):**「导出图片」= 主进程离屏窗口加载**同一个 renderer**(hash 路由
  `#export-report=<id>`,`ExportReportPage` 渲染同一 MatchReport),页面自报就绪后
  按全文高度 `capturePage` 整页 PNG —— 像素同源是构造保证,无第二条绘制路径;
  E2E 链路 4 锁管线(PNG 魔数 / IHDR 尺寸 = 全文高度)。

---

## 横切 —— 信任链

收官之作:一个端到端测试,把一份真实日志走完**每一跳** —— 解析 → 分析 →
findings/对照 → UI 渲染 → 导出 —— 并断言每一阶段的输出都锚定在前一阶段之上。
这是唯一一件能宣称「从原始字节到分享出去的截图之间,没有任何东西是捏造的」的产物。

✅ _(2026-07-24 完成,release/0.1)_ —— `packages/desktop/test/trustchain.test.tsx`:
合成日志走 raw → parse(A2 零违规,含 line-resolves 回源)→ doc(matchStore
落盘形态)→ derive(事件行全部回源到 raw 行、单位名全真、聚合独立重加)→
render(C1 checkFaithful 零分歧)→ export(Markdown 每个数字/名字逐字来自
derive、时间戳全在时长内)。真实日志侧由 eval-private 的 parserInvariants
sweep(1245 场)覆盖 parse 跳。

## 建议顺序

1. ~~**C1(数据忠实性)**~~ —— ✅ 2026-07-12 完成。
2. ~~**A1(差分预言机)**~~ —— ✅ 2026-07-13 完成(挖出真实的 F170 缺口,见 backlog)。
3. ~~**C2(视觉回归)**~~ —— ✅ 2026-07-19 完成。
4. ~~**C3(导出)** / **B1/B2(因果判官 + provenance)** / **A2/A3**~~ ——
   ✅ 全部于 2026-07-23 在 `release/0.1` 上完成。
5. ~~**B3**~~ —— ✅ 2026-07-24 完成(容错解析 + A3 覆盖清单接入 eval-baseline)。
6. ~~**信任链**~~ —— ✅ 2026-07-24 完成(trustchain.test.tsx,五跳全断言)。

### 剩余 backlog

**2026-07-24:B3 / 信任链 / C3 图片 / B2 原始行 全部收口 —— 本路线图除下条外无余项。**

- **F170 `[ENEMY HARD CAST]` 比旧的窄** —— A1 挖出来的那条具体 gladlog finding;
  在 `docs/BACKLOG.md` 里。修掉或确认无碍,然后在预言机里撤销白名单。

## 非目标

- 不是重写 —— 复用现有的门、eval 工具、selector 与 fixture。
- 不是只在云上/CI 里跑 —— 检查先在本地跑(`npm run typecheck`/vitest),CI 是加法。
  每项也都**可被 agent 调用**并产出结构化 diff,因此同时充当跨 agent 验证/反馈的
  基元(见「两类受众」)。
- 私有的差分/eval 预言机保持私有(合规),就像 `~/code/gladlog-eval-private` 一样。
