# Prompt Feature 迁移 backlog(4b A/B 环驱动)

> 这是 **backlog 不是 SDD 计划**:每个 feature 独立走一次 `/eval-ab` 周期(control=main,treatment=+feature),按本文顺序消化。原则沿 4b spec:确定性指标裁决 sufficiency/noise/labelBias,盲评统计裁决其余四维;INCONCLUSIVE 凭确定性理由 ADOPT 须记台账。

## 前置(一次性,等用户)

1. 私仓 `~/code/gladlog-eval-private/corpus/manifest.txt` 放自采日志清单。
2. `/eval-baseline` 建首个 run → `/calibrate-judge` 过 80% 检出门 → 基线台账行。
3. (可选,推荐)prompt 差异普查:旧 fork `scratch/parser-diff` 差分 harness 抽 50–200 场跑双管线 prompt diff,差异分桶(feature 缺失 / 数据值 / NEW_CORRECT / 待查),feature 桶的频率×token 占比用于校正下方优先级。

## 迁移顺序与依据

### 1. KICK / timeline 事件标注类 ✅(2026-07-11 随 timeline 变体 ADOPT 关闭)

> **结论**:timeline 变体三轮 A/B 后收编为产线默认(gladlog ed29c81)。踢断覆盖 1.3%→100%(确定性),盲评 4 维 CI-improved,accuracy 回归经 spec tag + 密度压缩两轮修复后消除。附带红利:CRLF \r bug 修复(假死误记真死,17/176 场胜负判反纠正)。台账:eval-private ledger A/B cycles 三行。

- **内容**:SPELL_INTERRUPT 的 `[KICK]` 时间轴行及同族标注。
- **旧仓证据**:F20 pilot(2026-07-04)——确定性踢断覆盖 12%→100%(+88pp,10/10 对),盲评七维全 inconclusive 无回归,+1.4% token,ADOPT。同时是"盲评对 sufficiency 无裁决权"的实证案例。
- **依赖**:无新依赖(interrupts 数据、时间轴管线均已在)。**先做差距盘点**:4a 移植版 matchTimeline 可能已带部分标注,treatment 只补缺口。
- **A/B 目标维度**:sufficiency(以 quality-report 踢断覆盖率裁决,盲评行仅陈列)。

### 2. HEALER EXPOSURE(直接搬 iter D inline 终态)✅(2026-07-11 盘点关闭:4a 已搬 inline 终态)

> **盘点结论**:ENEMY CC KIT 每场一次头 + [HEALER EXPOSURE] 时间戳行内联时间轴——iter D 终态在 4a 移植时已带入,非 append 初版。旧仓的回归维度 inferenceScaffolding 在 timeline 变体三轮盲评中连续 CI-improved(+0.79/+0.93/+0.86),等效通过了本项的 A/B 验证。无需单独周期。

- **内容**:tag 前缀 exposure 行**内联合并进时间轴**(mergeTimestampedLines)+ 每场一次 ENEMY CC KIT 头。
- **旧仓证据**:append 初版造成 inferenceScaffolding **确证回归**(−0.33,sign p=.006,week-eval 2026-07-09);iter D inline 版修复至 0.00 差且 token −66.6/场,ADOPT(0e5612d2)。
- **教训(硬约束)**:只搬 inline 终态,不搬 append 初版——时间轴同址(colocation)是回归根因所在。
- **依赖**:enemyCDs util(已搬)+ 子项目 5 法术数据(已入)。
- **A/B 目标维度**:inferenceScaffolding(修复对象)+ focusCalibration;确定性 token 计数对比。

### 3. POSITIONING(连几何扫描器一起)✅(2026-07-11 关闭:扫描器建成 + 0-violation 硬门通过)

- **内容**:POSITIONING 段、missed-trinket 距离/LoS 提示、位置图例。
- **旧仓证据**:B124 判 INCONCLUSIVE(control 天花板 5.00)→ 以事实正确性 ADOPT:100 场扫描 POSITIONING 全净;假 "LoS blocked" 142→~0(守卫+几何重校准后);不可能 CC 距离 3→0。
- **依赖**:arenaGeometry(4a 已搬,校准后版本)、坐标(compat 已供)、**几何 grounding 扫描器(未搬——本项的先行子任务,含变异测试)**。
- **硬门**:扫描器重建后先对全语料跑 0-violation 验证,再进 A/B;违规非零不许开旗。
- **关闭证据(2026-07-11,gladlog f004d74)**:POSITIONING 段/LoS 提示等内容 4a 已随 timeline 变体入册并经三轮盲评;扫描器(`packages/eval/scripts/positioningScan.ts`,5 类几何主张 × 真实采样时刻复算 × 合成夹具变异单测)全语料 2490 主张 0-violation。扫描器抓出并修复两个真管线缺陷:跨采样空窗插值幻觉位置(近战 Cheap Shot 标 17-21yd;gap 守卫 8s→1.5s)、TRAINED closest 距离与具名 trainer 张冠李戴(改 per-trainer min)。
- **A/B 目标维度**:inferenceScaffolding / accuracy;确定性 = 扫描器违规计数。

### 4. CONTESTED(healer offense V2)✅(2026-07-11 关闭:契约断言全净 + rubric 条款入册)

> **盘点结论**:V2_CONTESTED_TRADES 已启用,[CONTESTED] 行在 34/176 场语料出现,含 F193 安全措辞("EV question, not a verdict"、70–85% 带、DR Full、enemy interrupts ready)。**关闭证据**:`packages/eval/scripts/contestedContract.ts` 全语料(176 场)断言通过——45 条 [CONTESTED] / 34 场,0 unanchored / 0 sub-70% 带 / 0 缺 EV 措辞 / 0 超上限 / 0 块外;F193 rubric 条款(锚定 ≤Medium 换血讨论不算捏造)已入 eval-baseline.md accuracy 维。

- **内容**:`[CONTESTED]` 争夺型换血事实(70–85% 带 + Full DR 时 CC ready + enemyInterruptsReady)+ 允许 ≤Medium 置信度锚定 trade findings 的 rubric 条款。
- **旧仓证据**:F193(2026-07-09)——18 例受控校准(12 分层 + 6 相同 prompt 阴性对照),accuracy/labelBias CI 无回归,确定性安全契约 100%(0 unanchored / 0 above-Medium / 0 sub-70% / 阴性对照全净),ADOPT。
- **依赖**:healerOffenseAnalysis、drAnalysis、enemyInterrupts(均已搬)。
- **注意**:rubric 文本改动 A/B 盖不住(prompt 不内嵌 system prompt)——照旧仓做法 per-arm 角色扮演覆盖,rubric 条款随 feature 一起进 `eval-baseline.md`。
- **A/B 目标维度**:focusCalibration;确定性安全契约逐条复刻为断言。

### 5. 机会项:驱散覆盖 ✅(2026-07-11 关闭:A/B ADOPT,覆盖 40.3%→70.9%)

4b e2e 冒烟首跑即测得 3v3 真实场次 **dispel 覆盖 0%**(4 次驱散不在 prompt 文本)——大概率是首轮 `/eval-baseline` 的 Top issue。修复属 prompt 构建器改动,同样走 `/eval-ab`,目标维度 sufficiency(确定性驱散覆盖率)。

> **关闭证据(2026-07-11,gladlog 154d38c,A/B 台账 dispel-visibility 行)**:[CLEANSE] 具名驱散法术、队友 [PURGE]/[ENEMY PURGE] 行、[MINOR DISPELS] 折叠、manifest 剔除 12 个位移/变形破根伪驱散。确定性:覆盖 40.3%→70.9%(+30.6pp),token +1.3%;盲评 14 对七维全 inconclusive 零回归 → 凭确定性 ADOPT(F20 同构第二例)。

---

## 完成状态(2026-07-11)

**五项全部关闭**:#1 KICK(timeline 变体 ADOPT)、#2 EXPOSURE inline(盘点已在)、#3 POSITIONING(扫描器 + 0-violation 门)、#4 CONTESTED(契约断言 + rubric 条款)、#5 驱散覆盖(A/B ADOPT)。本 backlog 待归档进 docs/reports/。剩余机会项:token 压缩迭代(timeline 变体 +76% vs 稀疏,旧仓 iter A-D 同题)——独立于本 backlog。

## 记账规则

每个周期收官:台账 A/B cycles 行(照 4b 规程)+ 本文对应条目打钩并附结论一行。全部完成后本 backlog 归档进 docs/reports/。
