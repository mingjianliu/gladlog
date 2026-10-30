---
name: spec-output-study
description: 分析某个职业 / 专精在 PvP 里的治疗或伤害「从哪来、各占多少」——技能与天赋占比、天赋价值、属性权重、PvP 与 PvE 指南的差异、补丁热修影响、逐跳模型与残差校准——时读这个。用户说「分析 XX 的占比」「做一份 XX 的 PvP 版指南」「XX 天赋值多少 / 属性怎么排」「换个职业照奶德那样做」时,在写任何提取或模型代码之前。也用于手法问题——「XX 技能该不该攒 / 什么时候按 / 给谁」「理想打法值多少」「急速有没有阈值」。
---

# 专精产出研究(2026-10-27/28 恢复德鲁伊一轮沉淀)

完整方法、通用事实与证据、换职业清单在私有评测仓库:
**`$GLADLOG_EVAL_HOME/specstudy/RUNBOOK.md`**(默认 `~/code/gladlog-eval-private`)——先读完它。
参考实现:`$GLADLOG_EVAL_HOME/runs/rdruid-pvp-2026-10-27/`(`FINDINGS.md` 第 1–9 版、`rerun_v*.sh`)。
通用代码:`$GLADLOG_EVAL_HOME/specstudy/`(`db2.py` / `rules.py` / `logfmt.py` / `target_talents.py`,
`python3 -I specstudy/test_rules.py` 用真实 DB2 自检)。专精自己的机制写在该专精的 run 目录,不进 specstudy。
手法分析(织雾武僧 2026-10-29 一轮,RUNBOOK §11;参考 `runs/mwmonk-pvp-2026-10-28/play_*.py`):`timeline_scan.py` /
`playtime.py`(急速、GCD、`usable_free`、`round_end`)/ `charges.py` / `hot_owners.py` 加三个探针,
`python3 -I specstudy/test_play.py` 自检。

## 开工前定下来的三件事

1. **留出集先划好、全程不碰**:只在每版收尾跑一次覆盖率,不在上面做任何拆分探针。奶德那轮在归档上提名过机制,
   归档就不再算样本外(干净证据只剩后两版的增量)。
2. **指标**:逐跳非暴击 ±5% 覆盖率,**筛后与不筛两个数一起报**;分技能残差按玩家聚类 95% 区间。
3. **每版一个 `rerun_vN.sh` + FINDINGS 一节 + codex 审查**;管线跑着时不改模型代码(反事实循环会重读它)。

## 最容易再犯的(codex 六轮约 50 条里反复出现的类型)

- 单排:**一切按时间 / 按人的索引都要带回合号 `lo`**(`t` 每回合归零;COMBATANT_INFO 每回合一份,天赋会换)。
- 单排:**长时间增益跨回合保留**,没有 REMOVED 也不重新 APPLIED——光环状态只在 END 清,START 清掉会掉 4 个百分点。
- 同一施法者重复 APPLIED 无 REMOVED = 刷新(层数和刷新历史都保留);只有 tooltip 写明可重叠的才算多实例。
- **减疗不叠乘,只取最强**;减疗数值由**施加者**的 aura 107/108 天赋决定(SpellMod op 3→#0、12→#1,同 SpellClassSet、
  class mask 覆盖);毒蛇之血这类「加深」照常相乘。直接用 `specstudy/rules.healing_received`。
- 召唤物 / 图腾:本回合第一次叠衰减之前吃开局 10%,之后不吃(`rules.damp_fill`)。
- 「别人的天赋」作用到你的数值上:查**那个人本回合**点没点。
- 反事实要把所有依赖状态的部分一起重算;检验脚本跟着模型同步(模型加进去的项,检验里别再减一次)。
- 结论措辞对齐证据:「从未拟合」「已验证」要能说出是哪份数据、谁没碰过它。

## 手法分析最容易再犯的(codex 六轮 26 条)

- 「多按一下」只能放进 `usable_free`(下一个日志动作前放得下整个 GCD),虚拟施法也占自己的 GCD,要查法力、不能抢后面真实施法的资源。
- 基线固定为日志里那串施法,不跟着策略变;三把尺子(当时缺血上界 / 到回合结束的 end-HP 下界 / 固定视野)一起报。
- 积分和寿命、分子和分母读**同一套**归属 / 人群;同一毫秒的序列化顺序不是因果顺序。
- GCD 和「就绪时按没按」都从施法开始算;按评分段分层,永远不按胜负分。
- 新专精的 HoT 先跑 `probe_silent_recast.py`(复苏之雾重放不写光环行)和 `probe_partial_tick.py` 再写归属。

## 交给 gladlog

研究挖出的游戏 / 日志事实,只要 gladlog 也读同一事实,就开 GH issue 交接(先例 #162、#163、#165);
天赋价值、属性权重这类结论不进产品。按 CLAUDE.md 的 Game-Behaviour Rule:DB2 先问、语料只用来挑,不用来提名。
